BEGIN;

CREATE TEMP TABLE prompt07j_write_guard(ok boolean) ON COMMIT DROP;

SELECT
  set_config('request.jwt.claim.sub', '652b872b-e3a9-4d48-8388-1f0ea1289be6', true) AS auth_sub,
  set_config('role', 'authenticated', true) AS auth_role;

DO $$
DECLARE
  v_tenant_id uuid;
  v_tournament_id text;
  v_doi_nam text;
  v_doi_nu text;
  v_doi_nam_nu text;
  v_event_id text;
  v_match record;
  v_candidate_payload jsonb;
  v_existing_knockout_count integer;
  v_referee_account_id uuid;
BEGIN
  SELECT
    ten.id,
    t.id,
    max(e.id) FILTER (WHERE e.name = 'Đôi Nam'),
    max(e.id) FILTER (WHERE e.name = 'Đôi Nữ'),
    max(e.id) FILTER (WHERE e.name = 'Đôi Nam Nữ')
  INTO v_tenant_id, v_tournament_id, v_doi_nam, v_doi_nu, v_doi_nam_nu
  FROM public.tenants ten
  JOIN public.tournament t ON t.tenant_id = ten.id
  JOIN public.events e ON e.tournament_id = t.id
  WHERE ten.slug = 'clb-thang-oanh'
    AND t.slug = 'thang-oanh'
    AND t.deleted_at IS NULL
    AND e.deleted_at IS NULL
  GROUP BY ten.id, t.id;

  IF v_tenant_id IS NULL OR v_tournament_id IS NULL OR v_doi_nam IS NULL OR v_doi_nu IS NULL OR v_doi_nam_nu IS NULL THEN
    RAISE EXCEPTION 'Demo context is incomplete for thang-oanh';
  END IF;

  -- Scoped demo cleanup only for the three demo events in tournament thang-oanh.
  UPDATE public.account_event_permissions
  SET deleted_at = now()
  WHERE event_id IN (v_doi_nam, v_doi_nu, v_doi_nam_nu)
    AND deleted_at IS NULL;

  FOR v_match IN
    SELECT id AS match_id
    FROM public.matches
    WHERE event_id IN (v_doi_nam, v_doi_nu, v_doi_nam_nu)
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL
  LOOP
    PERFORM public.reset_match_score_v1(v_match.match_id);
  END LOOP;

  UPDATE public.matches
  SET deleted_at = now()
  WHERE event_id IN (v_doi_nam, v_doi_nu, v_doi_nam_nu)
    AND deleted_at IS NULL;

  UPDATE public.groups
  SET deleted_at = now()
  WHERE event_id IN (v_doi_nam, v_doi_nu, v_doi_nam_nu)
    AND deleted_at IS NULL;

  UPDATE public.teams
  SET deleted_at = now()
  WHERE event_id IN (v_doi_nam, v_doi_nu, v_doi_nam_nu)
    AND deleted_at IS NULL;

  FOREACH v_event_id IN ARRAY ARRAY[v_doi_nam, v_doi_nu, v_doi_nam_nu]
  LOOP
    PERFORM public.update_event_config_v1(
      v_event_id,
      'sport_pickleball',
      'doubles',
      'group_then_knockout',
      jsonb_build_object(
        'matchSetMode', 'single',
        'numberOfSets', 1,
        'setsToWin', 1,
        'maxScore', 15,
        'capScore', 17,
        'winByTwo', true
      ),
      jsonb_build_object(
        'rankingMethod', 'points_then_diff',
        'groupCount', CASE WHEN v_event_id = v_doi_nam THEN 4 ELSE 2 END,
        'pointsWin', 3,
        'pointsDraw', 1,
        'pointsLoss', 0
      )
    );
  END LOOP;

  PERFORM public.import_teams_v1(
    v_doi_nam,
    (
      SELECT jsonb_agg(jsonb_build_object('name', 'Đôi Nam Demo ' || lpad(i::text, 2, '0'), 'seed', i::text) ORDER BY i)
      FROM generate_series(1, 16) AS i
    )
  );
  PERFORM public.setup_groups_v4(v_doi_nam, 4, 'balanced');
  PERFORM public.generate_schedule_v1(v_doi_nam);

  PERFORM public.import_teams_v1(
    v_doi_nu,
    (
      SELECT jsonb_agg(jsonb_build_object('name', 'Đôi Nữ Demo ' || lpad(i::text, 2, '0'), 'seed', i::text) ORDER BY i)
      FROM generate_series(1, 8) AS i
    )
  );
  PERFORM public.setup_groups_v4(v_doi_nu, 2, 'balanced');
  PERFORM public.generate_schedule_v1(v_doi_nu);

  PERFORM public.import_teams_v1(
    v_doi_nam_nu,
    (
      SELECT jsonb_agg(jsonb_build_object('name', 'Nam Nữ Demo ' || lpad(i::text, 2, '0'), 'seed', i::text) ORDER BY i)
      FROM generate_series(1, 8) AS i
    )
  );
  PERFORM public.setup_groups_v4(v_doi_nam_nu, 2, 'balanced');
  PERFORM public.generate_schedule_v1(v_doi_nam_nu);

  -- Complete all Đôi Nam group-stage matches so top 2 per group is meaningful.
  FOR v_match IN
    WITH ranked_teams AS (
      SELECT
        t.id,
        t.group_id,
        row_number() OVER (PARTITION BY t.group_id ORDER BY lower(t.name), t.id) AS group_seed
      FROM public.teams t
      WHERE t.event_id = v_doi_nam
        AND t.tenant_id = v_tenant_id
        AND t.deleted_at IS NULL
    )
    SELECT
      m.id AS match_id,
      ta.group_seed AS team_a_seed,
      tb.group_seed AS team_b_seed
    FROM public.matches m
    JOIN ranked_teams ta ON ta.id = m.team_a_id
    JOIN ranked_teams tb ON tb.id = m.team_b_id
    WHERE m.event_id = v_doi_nam
      AND m.tenant_id = v_tenant_id
      AND m.deleted_at IS NULL
      AND COALESCE(m.group_id, '') <> 'knockout'
    ORDER BY m.group_id, m.round, m.id
  LOOP
    IF v_match.team_a_seed < v_match.team_b_seed THEN
      PERFORM public.update_match_score_v1(v_match.match_id, 15, (7 + LEAST(v_match.team_b_seed, 4))::integer);
    ELSE
      PERFORM public.update_match_score_v1(v_match.match_id, (7 + LEAST(v_match.team_a_seed, 4))::integer, 15);
    END IF;
  END LOOP;

  -- Add partial scores for Đôi Nữ only.
  FOR v_match IN
    WITH ranked_matches AS (
      SELECT
        m.id AS match_id,
        row_number() OVER (PARTITION BY m.group_id ORDER BY m.round, m.id) AS rn
      FROM public.matches m
      WHERE m.event_id = v_doi_nu
        AND m.tenant_id = v_tenant_id
        AND m.deleted_at IS NULL
        AND COALESCE(m.group_id, '') <> 'knockout'
    )
    SELECT match_id, rn
    FROM ranked_matches
    WHERE rn <= 2
    ORDER BY match_id
  LOOP
    PERFORM public.update_match_score_v1(v_match.match_id, 15, (10 + (v_match.rn % 2))::integer);
  END LOOP;

  -- Prepare and generate Đôi Nam knockout top 2 from each group, bracket size 8.
  SELECT jsonb_agg(jsonb_build_object(
    'team_id', c->>'team_id',
    'seed', (c->>'suggested_seed')::integer,
    'source', c->>'source',
    'source_group_id', c->>'group_id',
    'group_rank', (c->>'group_rank')::integer
  ) ORDER BY (c->>'suggested_seed')::integer)
  INTO v_candidate_payload
  FROM jsonb_array_elements((public.prepare_knockout_candidates_v1(v_doi_nam, 2, 0, false))->'candidates') AS c;

  PERFORM public.confirm_knockout_teams_v1(v_doi_nam, v_candidate_payload, 8, 'Prompt 07-J demo top 2 per group');

  SELECT count(*)::integer
  INTO v_existing_knockout_count
  FROM public.matches
  WHERE event_id = v_doi_nam
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
    AND group_id = 'knockout';

  IF v_existing_knockout_count = 0 THEN
    PERFORM public.generate_knockout_bracket_v1(v_doi_nam);
  END IF;

  SELECT a.id
  INTO v_referee_account_id
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  WHERE a.tenant_id = v_tenant_id
    AND a.status = 'active'
    AND a.deleted_at IS NULL
    AND r.name = 'REFEREE'
  ORDER BY a.created_at NULLS LAST, a.id
  LIMIT 1;

  IF v_referee_account_id IS NOT NULL THEN
    PERFORM public.grant_event_access_v1(v_doi_nam, v_referee_account_id::text, 'enter_scores');
  END IF;
END $$;

WITH ctx AS (
  SELECT
    ten.id AS tenant_id,
    t.id AS tournament_id,
    max(e.id) FILTER (WHERE e.name = 'Đôi Nam') AS doi_nam_event_id,
    max(e.id) FILTER (WHERE e.name = 'Đôi Nữ') AS doi_nu_event_id,
    max(e.id) FILTER (WHERE e.name = 'Đôi Nam Nữ') AS doi_nam_nu_event_id
  FROM public.tenants ten
  JOIN public.tournament t ON t.tenant_id = ten.id
  JOIN public.events e ON e.tournament_id = t.id
  WHERE ten.slug = 'clb-thang-oanh'
    AND t.slug = 'thang-oanh'
    AND t.deleted_at IS NULL
    AND e.deleted_at IS NULL
  GROUP BY ten.id, t.id
),
event_counts AS (
  SELECT
    e.name AS event_name,
    e.id AS event_id,
    count(DISTINCT tm.id) FILTER (WHERE tm.deleted_at IS NULL) AS teams,
    count(DISTINCT g.id) FILTER (WHERE g.deleted_at IS NULL) AS groups,
    count(DISTINCT m.id) FILTER (WHERE m.deleted_at IS NULL AND COALESCE(m.group_id, '') <> 'knockout') AS group_matches,
    count(DISTINCT m.id) FILTER (WHERE m.deleted_at IS NULL AND COALESCE(m.group_id, '') = 'knockout') AS knockout_matches,
    count(DISTINCT m.id) FILTER (WHERE m.deleted_at IS NULL AND m.status = 'finished' AND COALESCE(m.group_id, '') <> 'knockout') AS finished_group_matches
  FROM ctx
  JOIN public.events e ON e.id IN (ctx.doi_nam_event_id, ctx.doi_nu_event_id, ctx.doi_nam_nu_event_id)
  LEFT JOIN public.teams tm ON tm.event_id = e.id AND tm.tenant_id = ctx.tenant_id
  LEFT JOIN public.groups g ON g.event_id = e.id AND g.tenant_id = ctx.tenant_id
  LEFT JOIN public.matches m ON m.event_id = e.id AND m.tenant_id = ctx.tenant_id
  GROUP BY e.name, e.id
),
isolation AS (
  SELECT
    (
      SELECT count(*)
      FROM public.teams t
      WHERE t.event_id = (SELECT doi_nam_event_id FROM ctx)
        AND t.deleted_at IS NULL
        AND t.name LIKE 'Đôi Nữ Demo%'
    ) AS doi_nam_has_doi_nu_teams,
    (
      SELECT count(*)
      FROM public.teams t
      WHERE t.event_id = (SELECT doi_nu_event_id FROM ctx)
        AND t.deleted_at IS NULL
        AND t.name LIKE 'Đôi Nam Demo%'
    ) AS doi_nu_has_doi_nam_teams,
    (
      SELECT count(*)
      FROM public.matches m
      JOIN public.teams ta ON ta.id = m.team_a_id
      JOIN public.teams tb ON tb.id = m.team_b_id
      WHERE m.event_id IN ((SELECT doi_nam_event_id FROM ctx), (SELECT doi_nu_event_id FROM ctx), (SELECT doi_nam_nu_event_id FROM ctx))
        AND m.deleted_at IS NULL
        AND (ta.event_id <> m.event_id OR tb.event_id <> m.event_id)
    ) AS cross_event_match_team_count
),
referee_state AS (
  SELECT
    count(*) FILTER (WHERE r.name = 'REFEREE' AND a.status = 'active' AND a.deleted_at IS NULL AND a.tenant_id = ctx.tenant_id) AS active_demo_referee_count,
    count(*) FILTER (
      WHERE r.name = 'REFEREE'
        AND a.status = 'active'
        AND a.deleted_at IS NULL
        AND a.tenant_id = ctx.tenant_id
        AND aep.event_id = ctx.doi_nam_event_id
        AND aep.deleted_at IS NULL
        AND COALESCE(aep.permission, 'enter_scores') = 'enter_scores'
    ) AS doi_nam_referee_grants
  FROM ctx
  LEFT JOIN public.accounts a ON a.tenant_id = ctx.tenant_id
  LEFT JOIN public.roles r ON r.id = a.role_id
  LEFT JOIN public.account_event_permissions aep ON aep.account_id = a.id
)
SELECT jsonb_pretty(jsonb_build_object(
  'success', true,
  'tenant_id', (SELECT tenant_id FROM ctx),
  'tournament_id', (SELECT tournament_id FROM ctx),
  'event_counts', (SELECT jsonb_agg(to_jsonb(event_counts) ORDER BY event_name) FROM event_counts),
  'isolation', (SELECT to_jsonb(isolation) FROM isolation),
  'referee', (SELECT to_jsonb(referee_state) FROM referee_state),
  'negative_rpc_checks', jsonb_build_object(
    'tournament_id_as_event_id', 'see companion negative SQL tests; direct exception would abort this transaction',
    'tenant_id_as_event_id', 'see companion negative SQL tests; direct exception would abort this transaction'
  )
)) AS prompt_07j_report;

COMMIT;
