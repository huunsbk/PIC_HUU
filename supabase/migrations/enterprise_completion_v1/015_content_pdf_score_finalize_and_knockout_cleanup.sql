-- Content PDF follow-up: set-save score entry, explicit match finalization, and bracket cleanup.
BEGIN;

UPDATE public.matches
SET status = 'playing'
WHERE status = 'in_progress'
  AND deleted_at IS NULL;

UPDATE public.event_knockout_selections eks
SET seed_label = COALESCE(
      NULLIF(eks.seed_label, ''),
      public.p12_knockout_seed_label_v1(
        eks.source,
        (
          SELECT g.name
          FROM public.groups g
          WHERE g.id = eks.source_group_id
            AND g.event_id = eks.event_id
            AND g.tenant_id = eks.tenant_id
            AND g.deleted_at IS NULL
          LIMIT 1
        ),
        eks.group_rank,
        eks.seed
      )
    ),
    seed_source = CASE
      WHEN COALESCE(eks.seed_source, '{}'::jsonb) = '{}'::jsonb THEN jsonb_build_object(
        'source_type', COALESCE(eks.source, 'admin'),
        'group_id', eks.source_group_id,
        'rank', eks.group_rank,
        'third_best_index', CASE WHEN eks.source = 'best_third' THEN eks.seed ELSE NULL END
      )
      ELSE eks.seed_source
    END,
    resolved_team_id = COALESCE(eks.resolved_team_id, eks.team_id),
    updated_at = now()
WHERE eks.deleted_at IS NULL
  AND (
    eks.seed_label IS NULL
    OR eks.seed_label = ''
    OR eks.resolved_team_id IS NULL
    OR COALESCE(eks.seed_source, '{}'::jsonb) = '{}'::jsonb
  );

UPDATE public.matches m
SET placeholder_a = COALESCE(NULLIF(eks.seed_label, ''), m.placeholder_a),
    metadata = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(m.metadata, '{}'::jsonb),
          '{seed_label_a}',
          to_jsonb(COALESCE(NULLIF(eks.seed_label, ''), m.placeholder_a, 'Seed')),
          true
        ),
        '{seed_source_a}',
        COALESCE(eks.seed_source, '{}'::jsonb),
        true
      ),
      '{resolved_team_id_a}',
      to_jsonb(COALESCE(eks.resolved_team_id, eks.team_id)),
      true
    )
FROM public.event_knockout_selections eks
WHERE m.group_id = 'knockout'
  AND m.round = 1
  AND m.deleted_at IS NULL
  AND eks.deleted_at IS NULL
  AND m.event_id = eks.event_id
  AND m.tenant_id = eks.tenant_id
  AND m.team_a_id = COALESCE(eks.resolved_team_id, eks.team_id);

UPDATE public.matches m
SET placeholder_b = COALESCE(NULLIF(eks.seed_label, ''), m.placeholder_b),
    metadata = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(m.metadata, '{}'::jsonb),
          '{seed_label_b}',
          to_jsonb(COALESCE(NULLIF(eks.seed_label, ''), m.placeholder_b, 'Seed')),
          true
        ),
        '{seed_source_b}',
        COALESCE(eks.seed_source, '{}'::jsonb),
        true
      ),
      '{resolved_team_id_b}',
      to_jsonb(COALESCE(eks.resolved_team_id, eks.team_id)),
      true
    )
FROM public.event_knockout_selections eks
WHERE m.group_id = 'knockout'
  AND m.round = 1
  AND m.deleted_at IS NULL
  AND eks.deleted_at IS NULL
  AND m.event_id = eks.event_id
  AND m.tenant_id = eks.tenant_id
  AND m.team_b_id = COALESCE(eks.resolved_team_id, eks.team_id);

CREATE OR REPLACE FUNCTION public.update_match_set_score_v1(
  p_match_id text,
  p_set_number integer,
  p_score_a integer,
  p_score_b integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_match record;
  v_event record;
  v_config jsonb;
  v_mode text;
  v_number_of_sets integer;
  v_max_score integer;
  v_cap_score integer;
  v_win_by_two boolean;
  v_allow_draw boolean;
  v_set_winner_id text;
  v_winner_score integer;
  v_loser_score integer;
  v_sets_a integer;
  v_sets_b integer;
  v_saved_sets integer;
  v_match_status text;
BEGIN
  v_ctx := public.p10_require_match_score_context_v1(p_match_id, 'update_match_set_score_v1');

  SELECT m.*
    INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND';
  END IF;

  IF v_match.status = 'finished' THEN
    RAISE EXCEPTION 'Match is already finished; reset before editing scores';
  END IF;

  IF v_match.team_a_id IS NULL OR v_match.team_b_id IS NULL THEN
    RAISE EXCEPTION 'Match participants are not resolved';
  END IF;

  SELECT e.*
    INTO v_event
  FROM public.events e
  WHERE e.id = v_match.event_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND';
  END IF;

  v_config := CASE
    WHEN COALESCE(v_event.scoring_config, '{}'::jsonb) = '{}'::jsonb THEN (
      SELECT default_settings
      FROM public.sports
      WHERE id = COALESCE(v_event.sport_id, 'sport_pickleball')
    )
    ELSE v_event.scoring_config
  END;

  v_mode := COALESCE(v_config->>'matchSetMode', 'single');
  v_number_of_sets := CASE WHEN v_mode = 'best_of_3' THEN 3 ELSE 1 END;

  IF p_set_number < 1 OR p_set_number > v_number_of_sets THEN
    RAISE EXCEPTION 'p_set_number is outside configured match set range';
  END IF;

  IF v_mode = 'best_of_3' AND p_set_number = 3 THEN
    SELECT
      count(*) FILTER (WHERE winner_id = v_match.team_a_id),
      count(*) FILTER (WHERE winner_id = v_match.team_b_id)
      INTO v_sets_a, v_sets_b
    FROM public.match_sets
    WHERE match_id = p_match_id
      AND set_number IN (1, 2)
      AND deleted_at IS NULL
      AND status = 'finished';

    IF v_sets_a >= 2 OR v_sets_b >= 2 THEN
      RAISE EXCEPTION 'Set 3 is not allowed after a 2-0 result';
    END IF;
  END IF;

  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Scores must be non-negative integers';
  END IF;

  v_max_score := COALESCE((v_config->>'maxScore')::integer, 15);
  v_cap_score := COALESCE((v_config->>'capScore')::integer, v_max_score);
  v_win_by_two := COALESCE((v_config->>'winByTwo')::boolean, true);
  v_allow_draw := COALESCE((v_config->>'allowDraw')::boolean, false);

  IF p_score_a > v_cap_score OR p_score_b > v_cap_score THEN
    RAISE EXCEPTION 'Score exceeds capScore';
  END IF;

  IF p_score_a = p_score_b AND NOT v_allow_draw THEN
    RAISE EXCEPTION 'Draw is not allowed for this event';
  END IF;

  IF p_score_a > p_score_b THEN
    v_set_winner_id := v_match.team_a_id;
    v_winner_score := p_score_a;
    v_loser_score := p_score_b;
  ELSIF p_score_b > p_score_a THEN
    v_set_winner_id := v_match.team_b_id;
    v_winner_score := p_score_b;
    v_loser_score := p_score_a;
  ELSE
    v_set_winner_id := NULL;
    v_winner_score := p_score_a;
    v_loser_score := p_score_b;
  END IF;

  IF v_set_winner_id IS NULL AND NOT v_allow_draw THEN
    RAISE EXCEPTION 'Set winner could not be determined';
  END IF;

  IF v_set_winner_id IS NOT NULL THEN
    IF v_winner_score < v_max_score THEN
      RAISE EXCEPTION 'Winner score must reach maxScore';
    END IF;

    IF v_win_by_two THEN
      IF v_winner_score < v_cap_score AND (v_winner_score - v_loser_score) < 2 THEN
        RAISE EXCEPTION 'Winner must lead by two before capScore';
      END IF;

      IF v_winner_score = v_cap_score AND (v_winner_score - v_loser_score) < 1 THEN
        RAISE EXCEPTION 'Winner must lead at capScore';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.match_sets (
    match_id,
    tenant_id,
    event_id,
    set_number,
    score_a,
    score_b,
    winner_id,
    status,
    updated_at,
    deleted_at
  )
  VALUES (
    p_match_id,
    v_match.tenant_id,
    v_match.event_id,
    p_set_number,
    p_score_a,
    p_score_b,
    v_set_winner_id,
    'finished',
    now(),
    NULL
  )
  ON CONFLICT (match_id, set_number) DO UPDATE
  SET score_a = EXCLUDED.score_a,
      score_b = EXCLUDED.score_b,
      winner_id = EXCLUDED.winner_id,
      status = 'finished',
      updated_at = now(),
      deleted_at = NULL;

  IF v_mode = 'best_of_3' AND p_set_number IN (1, 2) THEN
    SELECT
      count(*) FILTER (WHERE winner_id = v_match.team_a_id),
      count(*) FILTER (WHERE winner_id = v_match.team_b_id)
      INTO v_sets_a, v_sets_b
    FROM public.match_sets
    WHERE match_id = p_match_id
      AND set_number IN (1, 2)
      AND deleted_at IS NULL
      AND status = 'finished';

    IF v_sets_a >= 2 OR v_sets_b >= 2 THEN
      UPDATE public.match_sets
      SET deleted_at = now(),
          status = 'pending',
          updated_at = now()
      WHERE match_id = p_match_id
        AND set_number = 3
        AND deleted_at IS NULL;
    END IF;
  END IF;

  SELECT
    count(*) FILTER (WHERE winner_id = v_match.team_a_id),
    count(*) FILTER (WHERE winner_id = v_match.team_b_id),
    count(*)
    INTO v_sets_a, v_sets_b, v_saved_sets
  FROM public.match_sets
  WHERE match_id = p_match_id
    AND deleted_at IS NULL
    AND status = 'finished';

  v_match_status := CASE WHEN v_saved_sets > 0 THEN 'playing' ELSE 'pending' END;

  UPDATE public.matches
  SET score_a = v_sets_a,
      score_b = v_sets_b,
      winner_id = NULL,
      status = v_match_status
  WHERE id = p_match_id;

  PERFORM public.log_audit_event_v1(
    'SAVE_MATCH_SET_SCORE',
    'match',
    p_match_id,
    jsonb_build_object(
      'event_id', v_match.event_id,
      'set_number', p_set_number,
      'score_a', p_score_a,
      'score_b', p_score_b,
      'set_winner_id', v_set_winner_id,
      'match_status', v_match_status,
      'matchSetMode', v_mode
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'match_id', p_match_id,
    'set_number', p_set_number,
    'match_status', v_match_status,
    'winner_id', NULL,
    'score_a', v_sets_a,
    'score_b', v_sets_b
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_match_score_v1(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_match record;
  v_event record;
  v_config jsonb;
  v_mode text;
  v_sets_to_win integer;
  v_sets_a integer;
  v_sets_b integer;
  v_saved_sets integer;
  v_match_winner_id text;
BEGIN
  v_ctx := public.p10_require_match_score_context_v1(p_match_id, 'finalize_match_score_v1');

  SELECT m.*
    INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND';
  END IF;

  IF v_match.team_a_id IS NULL OR v_match.team_b_id IS NULL THEN
    RAISE EXCEPTION 'Match participants are not resolved';
  END IF;

  SELECT e.*
    INTO v_event
  FROM public.events e
  WHERE e.id = v_match.event_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND';
  END IF;

  v_config := CASE
    WHEN COALESCE(v_event.scoring_config, '{}'::jsonb) = '{}'::jsonb THEN (
      SELECT default_settings
      FROM public.sports
      WHERE id = COALESCE(v_event.sport_id, 'sport_pickleball')
    )
    ELSE v_event.scoring_config
  END;

  v_mode := COALESCE(v_config->>'matchSetMode', 'single');
  v_sets_to_win := COALESCE((v_config->>'setsToWin')::integer, CASE WHEN v_mode = 'best_of_3' THEN 2 ELSE 1 END);

  SELECT
    count(*) FILTER (WHERE winner_id = v_match.team_a_id),
    count(*) FILTER (WHERE winner_id = v_match.team_b_id),
    count(*)
    INTO v_sets_a, v_sets_b, v_saved_sets
  FROM public.match_sets
  WHERE match_id = p_match_id
    AND deleted_at IS NULL
    AND status = 'finished';

  IF v_saved_sets = 0 THEN
    RAISE EXCEPTION 'No saved set score found for this match';
  END IF;

  IF v_sets_a >= v_sets_to_win AND v_sets_a > v_sets_b THEN
    v_match_winner_id := v_match.team_a_id;
  ELSIF v_sets_b >= v_sets_to_win AND v_sets_b > v_sets_a THEN
    v_match_winner_id := v_match.team_b_id;
  ELSE
    RAISE EXCEPTION 'Match is not ready to finalize';
  END IF;

  UPDATE public.matches
  SET score_a = v_sets_a,
      score_b = v_sets_b,
      winner_id = v_match_winner_id,
      status = 'finished'
  WHERE id = p_match_id;

  PERFORM public.p12_propagate_knockout_winner_v1(p_match_id);

  PERFORM public.log_audit_event_v1(
    'FINALIZE_MATCH_SCORE',
    'match',
    p_match_id,
    jsonb_build_object(
      'event_id', v_match.event_id,
      'winner_id', v_match_winner_id,
      'score_a', v_sets_a,
      'score_b', v_sets_b,
      'matchSetMode', v_mode
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'match_id', p_match_id,
    'winner_id', v_match_winner_id,
    'score_a', v_sets_a,
    'score_b', v_sets_b,
    'status', 'finished'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_knockout_bracket_v1(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_match_count integer := 0;
  v_set_count integer := 0;
BEGIN
  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_matches', 'clear_knockout_bracket_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;

  UPDATE public.match_sets ms
  SET deleted_at = now(),
      status = 'pending',
      updated_at = now()
  FROM public.matches m
  WHERE ms.match_id = m.id
    AND m.event_id = p_event_id
    AND m.tenant_id = v_tenant_id
    AND m.group_id = 'knockout'
    AND m.deleted_at IS NULL
    AND ms.deleted_at IS NULL;
  GET DIAGNOSTICS v_set_count = ROW_COUNT;

  UPDATE public.matches
  SET deleted_at = now(),
      score_a = NULL,
      score_b = NULL,
      winner_id = NULL,
      status = 'pending'
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND group_id = 'knockout'
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_match_count = ROW_COUNT;

  PERFORM public.log_audit_event_v1(
    'CLEAR_KNOCKOUT_BRACKET',
    'event',
    p_event_id,
    jsonb_build_object('deleted_matches', v_match_count, 'deleted_match_sets', v_set_count)
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'deleted_matches', v_match_count,
    'deleted_match_sets', v_set_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_knockout_candidates_v1(
  p_event_id text,
  p_top_per_group integer DEFAULT 2,
  p_best_third_count integer DEFAULT 0,
  p_exclude_bottom_results boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_format text;
  v_candidates jsonb;
  v_group_status jsonb;
  v_incomplete_groups integer;
BEGIN
  IF COALESCE(p_top_per_group, 0) < 0 THEN
    RAISE EXCEPTION 'p_top_per_group must be >= 0';
  END IF;

  IF COALESCE(p_best_third_count, 0) < 0 THEN
    RAISE EXCEPTION 'p_best_third_count must be >= 0';
  END IF;

  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_matches', 'prepare_knockout_candidates_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_format := COALESCE(v_ctx->>'format_type', 'group_then_knockout');

  IF v_format <> 'group_then_knockout' THEN
    RAISE EXCEPTION 'prepare_knockout_candidates_v1 applies only to group_then_knockout events';
  END IF;

  WITH group_status AS (
    SELECT
      g.id AS group_id,
      g.name AS group_name,
      count(m.id)::integer AS match_count,
      count(m.id) FILTER (WHERE m.status = 'finished')::integer AS finished_count,
      (count(m.id) > 0 AND count(m.id) = count(m.id) FILTER (WHERE m.status = 'finished')) AS is_completed
    FROM public.groups g
    LEFT JOIN public.matches m ON m.group_id = g.id
      AND m.event_id = g.event_id
      AND m.tenant_id = g.tenant_id
      AND m.deleted_at IS NULL
    WHERE g.event_id = p_event_id
      AND g.tenant_id = v_tenant_id
      AND g.deleted_at IS NULL
    GROUP BY g.id, g.name
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'group_id', group_id,
      'group_name', group_name,
      'match_count', match_count,
      'finished_count', finished_count,
      'group_finished', is_completed,
      'is_completed', is_completed
    ) ORDER BY group_name), '[]'::jsonb),
    count(*) FILTER (WHERE NOT is_completed)::integer
    INTO v_group_status, v_incomplete_groups
  FROM group_status;

  IF jsonb_array_length(v_group_status) = 0 THEN
    RAISE EXCEPTION 'No groups found for knockout preparation';
  END IF;

  IF COALESCE(v_incomplete_groups, 0) > 0 THEN
    RAISE EXCEPTION 'GROUP_STAGE_INCOMPLETE';
  END IF;

  WITH base AS (
    SELECT
      g.id AS group_id,
      g.name AS group_name,
      t.id AS team_id,
      t.name AS team_name,
      count(m.id) FILTER (WHERE m.status = 'finished')::integer AS matches_played,
      count(m.id) FILTER (WHERE m.status = 'finished' AND m.winner_id = t.id)::integer AS wins,
      count(m.id) FILTER (WHERE m.status = 'finished' AND m.winner_id IS NOT NULL AND m.winner_id <> t.id)::integer AS losses,
      count(m.id) FILTER (WHERE m.status = 'finished' AND m.winner_id IS NULL)::integer AS draws,
      COALESCE(sum(
        CASE
          WHEN m.status <> 'finished' THEN 0
          WHEN m.team_a_id = t.id THEN COALESCE(m.score_a, 0) - COALESCE(m.score_b, 0)
          WHEN m.team_b_id = t.id THEN COALESCE(m.score_b, 0) - COALESCE(m.score_a, 0)
          ELSE 0
        END
      ), 0)::integer AS set_diff,
      COALESCE(sum(
        CASE
          WHEN m.status <> 'finished' THEN 0
          WHEN m.team_a_id = t.id THEN COALESCE(ms.score_a, m.score_a, 0) - COALESCE(ms.score_b, m.score_b, 0)
          WHEN m.team_b_id = t.id THEN COALESCE(ms.score_b, m.score_b, 0) - COALESCE(ms.score_a, m.score_a, 0)
          ELSE 0
        END
      ), 0)::integer AS point_diff
    FROM public.groups g
    JOIN public.teams t ON t.group_id = g.id
      AND t.event_id = g.event_id
      AND t.tenant_id = g.tenant_id
      AND t.deleted_at IS NULL
    LEFT JOIN public.matches m ON m.group_id = g.id
      AND m.event_id = g.event_id
      AND m.tenant_id = g.tenant_id
      AND m.deleted_at IS NULL
      AND (m.team_a_id = t.id OR m.team_b_id = t.id)
    LEFT JOIN LATERAL (
      SELECT sum(score_a)::integer AS score_a, sum(score_b)::integer AS score_b
      FROM public.match_sets
      WHERE match_id = m.id
        AND deleted_at IS NULL
    ) ms ON true
    WHERE g.event_id = p_event_id
      AND g.tenant_id = v_tenant_id
      AND g.deleted_at IS NULL
    GROUP BY g.id, g.name, t.id, t.name
  ),
  ranked AS (
    SELECT
      *,
      (wins * 3 + draws)::integer AS points,
      row_number() OVER (PARTITION BY group_id ORDER BY (wins * 3 + draws) DESC, set_diff DESC, point_diff DESC, lower(team_name), team_id) AS group_rank,
      count(*) OVER (PARTITION BY group_id) AS group_size
    FROM base
  ),
  bottom AS (
    SELECT group_id, team_id AS bottom_team_id
    FROM ranked
    WHERE group_rank = group_size
  ),
  thirds AS (
    SELECT
      r.*,
      CASE WHEN p_exclude_bottom_results THEN COALESCE(adj.points_delta, 0) ELSE 0 END AS points_delta,
      CASE WHEN p_exclude_bottom_results THEN COALESCE(adj.set_delta, 0) ELSE 0 END AS set_delta,
      CASE WHEN p_exclude_bottom_results THEN COALESCE(adj.point_delta, 0) ELSE 0 END AS point_delta
    FROM ranked r
    JOIN bottom b ON b.group_id = r.group_id
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN m.winner_id = r.team_id THEN -3
          WHEN m.winner_id IS NULL THEN -1
          ELSE 0
        END AS points_delta,
        -CASE
          WHEN m.team_a_id = r.team_id THEN COALESCE(m.score_a, 0) - COALESCE(m.score_b, 0)
          ELSE COALESCE(m.score_b, 0) - COALESCE(m.score_a, 0)
        END AS set_delta,
        -CASE
          WHEN m.team_a_id = r.team_id THEN COALESCE(ms.score_a, m.score_a, 0) - COALESCE(ms.score_b, m.score_b, 0)
          ELSE COALESCE(ms.score_b, m.score_b, 0) - COALESCE(ms.score_a, m.score_a, 0)
        END AS point_delta
      FROM public.matches m
      LEFT JOIN LATERAL (
        SELECT sum(score_a)::integer AS score_a, sum(score_b)::integer AS score_b
        FROM public.match_sets
        WHERE match_id = m.id
          AND deleted_at IS NULL
      ) ms ON true
      WHERE m.event_id = p_event_id
        AND m.tenant_id = v_tenant_id
        AND m.deleted_at IS NULL
        AND m.status = 'finished'
        AND m.group_id = r.group_id
        AND ((m.team_a_id = r.team_id AND m.team_b_id = b.bottom_team_id) OR (m.team_b_id = r.team_id AND m.team_a_id = b.bottom_team_id))
      LIMIT 1
    ) adj ON true
    WHERE r.group_rank = 3
  ),
  best_thirds_limited AS (
    SELECT
      team_id,
      team_name,
      group_id,
      group_name,
      matches_played,
      wins,
      losses,
      draws,
      (points + points_delta)::integer AS points,
      (set_diff + set_delta)::integer AS set_diff,
      (point_diff + point_delta)::integer AS point_diff,
      group_rank,
      group_size,
      'best_third'::text AS source,
      3 AS source_order
    FROM thirds
    ORDER BY (points + points_delta) DESC, (set_diff + set_delta) DESC, (point_diff + point_delta) DESC, lower(team_name), team_id
    LIMIT COALESCE(p_best_third_count, 0)
  ),
  selected AS (
    SELECT
      group_id,
      group_name,
      team_id,
      team_name,
      matches_played,
      wins,
      losses,
      draws,
      points,
      set_diff,
      point_diff,
      group_rank,
      group_size,
      'group_rank'::text AS source,
      group_rank AS source_order
    FROM ranked
    WHERE group_rank <= COALESCE(p_top_per_group, 2)
    UNION ALL
    SELECT
      group_id,
      group_name,
      team_id,
      team_name,
      matches_played,
      wins,
      losses,
      draws,
      points,
      set_diff,
      point_diff,
      group_rank,
      group_size,
      source,
      source_order
    FROM best_thirds_limited
  ),
  numbered AS (
    SELECT
      *,
      row_number() OVER (ORDER BY source_order, group_name, group_rank, points DESC, set_diff DESC, point_diff DESC, lower(team_name), team_id) AS suggested_seed
    FROM selected
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id', team_id,
    'team_name', team_name,
    'group_id', group_id,
    'group_name', group_name,
    'group_rank', group_rank,
    'points', points,
    'score_diff', set_diff,
    'set_diff', set_diff,
    'point_diff', point_diff,
    'source', source,
    'seed_label', public.p12_knockout_seed_label_v1(source, group_name, group_rank, suggested_seed),
    'seed_source', jsonb_build_object(
      'source_type', source,
      'group_id', group_id,
      'rank', group_rank,
      'third_best_index', CASE WHEN source = 'best_third' THEN suggested_seed ELSE NULL END
    ),
    'suggested_seed', suggested_seed
  ) ORDER BY suggested_seed), '[]'::jsonb)
  INTO v_candidates
  FROM numbered;

  PERFORM public.log_audit_event_v1(
    'PREPARE_KNOCKOUT_CANDIDATES',
    'event',
    p_event_id,
    jsonb_build_object('top_per_group', p_top_per_group, 'best_third_count', p_best_third_count, 'exclude_bottom_results', p_exclude_bottom_results, 'candidate_count', jsonb_array_length(v_candidates), 'group_status', v_group_status)
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'candidates', v_candidates,
    'candidate_count', jsonb_array_length(v_candidates),
    'exclude_bottom_results', p_exclude_bottom_results,
    'group_status', v_group_status,
    'all_groups_finished', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_match_set_score_v1(text, integer, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_match_score_v1(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_knockout_bracket_v1(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prepare_knockout_candidates_v1(text, integer, integer, boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.update_match_set_score_v1(text, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_match_score_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_knockout_bracket_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_knockout_candidates_v1(text, integer, integer, boolean) TO authenticated;

COMMIT;
