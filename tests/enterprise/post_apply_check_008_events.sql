WITH expected_functions(function_name) AS (
  VALUES
    ('list_events_by_tournament_v1'),
    ('create_event_v1'),
    ('update_event_v1'),
    ('archive_event_v1'),
    ('restore_event_v1')
),
function_checks AS (
  SELECT
    ef.function_name,
    p.oid IS NOT NULL AS exists,
    pg_get_function_identity_arguments(p.oid) AS identity_args,
    CASE WHEN p.oid IS NULL THEN false ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS authenticated_execute,
    CASE WHEN p.oid IS NULL THEN false ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_execute
  FROM expected_functions ef
  LEFT JOIN pg_proc p ON p.proname = ef.function_name
  LEFT JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
),
demo AS (
  SELECT
    (SELECT count(*) FROM auth.users) AS auth_users_count,
    (
      SELECT count(*)
      FROM public.accounts a
      JOIN public.roles r ON r.id = a.role_id
      WHERE r.name = 'SUPER_ADMIN'
        AND a.status = 'active'
    ) AS active_super_admin_count,
    (
      SELECT count(*)
      FROM public.events e
      JOIN public.tournament t ON t.id = e.tournament_id
      WHERE t.slug = 'thang-oanh'
        AND e.deleted_at IS NULL
        AND e.name IN ('Đôi Nam', 'Đôi Nữ', 'Đôi Nam Nữ')
    ) AS demo_event_count,
    (
      SELECT count(DISTINCT e.tournament_id)
      FROM public.events e
      JOIN public.tournament t ON t.id = e.tournament_id
      WHERE t.slug = 'thang-oanh'
        AND e.deleted_at IS NULL
        AND e.name IN ('Đôi Nam', 'Đôi Nữ', 'Đôi Nam Nữ')
    ) AS demo_event_tournament_count,
    (SELECT count(*) FROM public.teams) AS teams_count,
    (SELECT count(*) FROM public.groups) AS groups_count,
    (SELECT count(*) FROM public.matches) AS matches_count,
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'name', e.name,
          'tournament_id', e.tournament_id,
          'tenant_id', e.tenant_id,
          'competition_type', e.competition_type,
          'format_type', e.format_type,
          'scoring_config', e.scoring_config,
          'ranking_config', e.ranking_config
        )
        ORDER BY e.name
      )
      FROM public.events e
      JOIN public.tournament t ON t.id = e.tournament_id
      WHERE t.slug = 'thang-oanh'
        AND e.deleted_at IS NULL
    ) AS demo_events
)
SELECT
  'function' AS check_type,
  function_name AS name,
  identity_args,
  exists,
  authenticated_execute,
  anon_execute,
  NULL::bigint AS auth_users_count,
  NULL::bigint AS active_super_admin_count,
  NULL::bigint AS demo_event_count,
  NULL::bigint AS demo_event_tournament_count,
  NULL::bigint AS teams_count,
  NULL::bigint AS groups_count,
  NULL::bigint AS matches_count,
  NULL::jsonb AS demo_events
FROM function_checks
UNION ALL
SELECT
  'demo' AS check_type,
  'demo_event_state' AS name,
  NULL AS identity_args,
  true AS exists,
  NULL AS authenticated_execute,
  NULL AS anon_execute,
  auth_users_count,
  active_super_admin_count,
  demo_event_count,
  demo_event_tournament_count,
  teams_count,
  groups_count,
  matches_count,
  demo_events
FROM demo
ORDER BY check_type, name;
