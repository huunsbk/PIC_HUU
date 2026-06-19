WITH expected_functions(function_name) AS (
  VALUES
    ('get_workspace_context_v1'),
    ('list_tenants_v1'),
    ('create_tenant_v1'),
    ('update_tenant_v1'),
    ('archive_tenant_v1'),
    ('restore_tenant_v1'),
    ('list_tournaments_v1'),
    ('create_tournament_v1'),
    ('update_tournament_v1'),
    ('archive_tournament_v1'),
    ('restore_tournament_v1')
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
auth_checks AS (
  SELECT
    (SELECT count(*) FROM auth.users) AS auth_users_count,
    (
      SELECT count(*)
      FROM public.accounts a
      JOIN public.roles r ON r.id = a.role_id
      WHERE r.name = 'SUPER_ADMIN'
        AND a.status = 'active'
    ) AS active_super_admin_count
)
SELECT
  'function' AS check_type,
  function_name AS name,
  identity_args,
  exists,
  authenticated_execute,
  anon_execute,
  NULL::bigint AS auth_users_count,
  NULL::bigint AS active_super_admin_count
FROM function_checks
UNION ALL
SELECT
  'auth' AS check_type,
  'auth_and_super_admin' AS name,
  NULL AS identity_args,
  true AS exists,
  NULL AS authenticated_execute,
  NULL AS anon_execute,
  auth_users_count,
  active_super_admin_count
FROM auth_checks
ORDER BY check_type, name;
