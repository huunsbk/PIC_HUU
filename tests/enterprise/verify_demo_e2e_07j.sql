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
    count(DISTINCT m.id) FILTER (WHERE m.deleted_at IS NULL AND m.status = 'finished' AND COALESCE(m.group_id, '') <> 'knockout') AS finished_group_matches,
    count(DISTINCT eks.id) FILTER (WHERE eks.deleted_at IS NULL) AS confirmed_knockout_teams
  FROM ctx
  JOIN public.events e ON e.id IN (ctx.doi_nam_event_id, ctx.doi_nu_event_id, ctx.doi_nam_nu_event_id)
  LEFT JOIN public.teams tm ON tm.event_id = e.id AND tm.tenant_id = ctx.tenant_id
  LEFT JOIN public.groups g ON g.event_id = e.id AND g.tenant_id = ctx.tenant_id
  LEFT JOIN public.matches m ON m.event_id = e.id AND m.tenant_id = ctx.tenant_id
  LEFT JOIN public.event_knockout_selections eks ON eks.event_id = e.id AND eks.tenant_id = ctx.tenant_id
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
    count(DISTINCT a.id) FILTER (WHERE r.name = 'REFEREE' AND a.status = 'active' AND a.deleted_at IS NULL AND a.tenant_id = ctx.tenant_id) AS active_demo_referee_count,
    count(DISTINCT aep.id) FILTER (
      WHERE r.name = 'REFEREE'
        AND a.status = 'active'
        AND a.deleted_at IS NULL
        AND a.tenant_id = ctx.tenant_id
        AND aep.event_id = ctx.doi_nam_event_id
        AND aep.deleted_at IS NULL
        AND COALESCE(aep.permission, 'enter_scores') = 'enter_scores'
    ) AS doi_nam_referee_grants,
    count(DISTINCT aep.id) FILTER (
      WHERE r.name = 'REFEREE'
        AND a.tenant_id <> ctx.tenant_id
        AND aep.event_id = ctx.doi_nam_event_id
        AND aep.deleted_at IS NULL
    ) AS cross_tenant_referee_grants
  FROM ctx
  LEFT JOIN public.accounts a ON true
  LEFT JOIN public.roles r ON r.id = a.role_id
  LEFT JOIN public.account_event_permissions aep ON aep.account_id = a.id
),
id_shape AS (
  SELECT
    (SELECT doi_nam_event_id FROM ctx) LIKE 'evt_%' AS doi_nam_is_evt_id,
    (SELECT doi_nu_event_id FROM ctx) LIKE 'evt_%' AS doi_nu_is_evt_id,
    (SELECT doi_nam_nu_event_id FROM ctx) LIKE 'evt_%' AS doi_nam_nu_is_evt_id,
    (SELECT tournament_id FROM ctx) NOT LIKE 'evt_%' AS tournament_is_not_event_id,
    (SELECT tenant_id::text FROM ctx) NOT LIKE 'evt_%' AS tenant_is_not_event_id
)
SELECT jsonb_pretty(jsonb_build_object(
  'success', true,
  'tenant_id', (SELECT tenant_id FROM ctx),
  'tournament_id', (SELECT tournament_id FROM ctx),
  'events', jsonb_build_object(
    'doi_nam', (SELECT doi_nam_event_id FROM ctx),
    'doi_nu', (SELECT doi_nu_event_id FROM ctx),
    'doi_nam_nu', (SELECT doi_nam_nu_event_id FROM ctx)
  ),
  'event_counts', (SELECT jsonb_agg(to_jsonb(event_counts) ORDER BY event_name) FROM event_counts),
  'isolation', (SELECT to_jsonb(isolation) FROM isolation),
  'selected_event_id_shape', (SELECT to_jsonb(id_shape) FROM id_shape),
  'referee', (SELECT to_jsonb(referee_state) FROM referee_state)
)) AS prompt_07j_verify_report;
