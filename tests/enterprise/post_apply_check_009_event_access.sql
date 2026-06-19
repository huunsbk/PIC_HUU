WITH expected_functions(function_name, identity_args) AS (
  VALUES
    ('list_event_access_v1', 'p_event_id text'),
    ('grant_event_access_v1', 'p_event_id text, p_account_id text, p_permission text'),
    ('revoke_event_access_v1', 'p_event_id text, p_account_id text, p_permission text')
),
function_checks AS (
  SELECT
    ef.function_name,
    ef.identity_args,
    p.oid IS NOT NULL AS exists,
    CASE WHEN p.oid IS NULL THEN false ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS authenticated_execute,
    CASE WHEN p.oid IS NULL THEN false ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_execute
  FROM expected_functions ef
  LEFT JOIN pg_proc p
    ON p.proname = ef.function_name
   AND pg_get_function_identity_arguments(p.oid) = ef.identity_args
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
      FROM public.accounts a
      JOIN public.roles r ON r.id = a.role_id
      JOIN public.tenants ten ON ten.id = a.tenant_id
      WHERE r.name = 'REFEREE'
        AND a.status = 'active'
        AND a.deleted_at IS NULL
        AND ten.slug = 'clb-thang-oanh'
    ) AS eligible_demo_referee_count,
    (
      SELECT count(*)
      FROM public.account_event_permissions aep
      JOIN public.accounts a ON a.id = aep.account_id
      JOIN public.roles r ON r.id = a.role_id
      JOIN public.events e ON e.id = aep.event_id
      JOIN public.tournament t ON t.id = e.tournament_id
      WHERE t.slug = 'thang-oanh'
        AND e.name = 'Đôi Nam'
        AND r.name = 'REFEREE'
        AND COALESCE(aep.permission, 'enter_scores') = 'enter_scores'
        AND aep.deleted_at IS NULL
    ) AS doi_nam_referee_grant_count,
    (
      SELECT count(*)
      FROM public.account_event_permissions aep
      JOIN public.accounts a ON a.id = aep.account_id
      JOIN public.roles r ON r.id = a.role_id
      JOIN public.events e ON e.id = aep.event_id
      JOIN public.tournament t ON t.id = e.tournament_id
      WHERE t.slug = 'thang-oanh'
        AND e.name = 'Đôi Nữ'
        AND r.name = 'REFEREE'
        AND COALESCE(aep.permission, 'enter_scores') = 'enter_scores'
        AND aep.deleted_at IS NULL
    ) AS doi_nu_referee_grant_count,
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'event_name', e.name,
          'account_id', a.id,
          'username', a.username,
          'role_name', r.name,
          'permission', COALESCE(aep.permission, 'enter_scores')
        )
        ORDER BY e.name, a.username
      )
      FROM public.account_event_permissions aep
      JOIN public.accounts a ON a.id = aep.account_id
      JOIN public.roles r ON r.id = a.role_id
      JOIN public.events e ON e.id = aep.event_id
      JOIN public.tournament t ON t.id = e.tournament_id
      WHERE t.slug = 'thang-oanh'
        AND aep.deleted_at IS NULL
    ) AS grants
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
  NULL::bigint AS eligible_demo_referee_count,
  NULL::bigint AS doi_nam_referee_grant_count,
  NULL::bigint AS doi_nu_referee_grant_count,
  NULL::jsonb AS grants
FROM function_checks
UNION ALL
SELECT
  'demo' AS check_type,
  'referee_access_state' AS name,
  NULL AS identity_args,
  true AS exists,
  NULL AS authenticated_execute,
  NULL AS anon_execute,
  auth_users_count,
  active_super_admin_count,
  eligible_demo_referee_count,
  doi_nam_referee_grant_count,
  doi_nu_referee_grant_count,
  COALESCE(grants, '[]'::jsonb)
FROM demo
ORDER BY check_type, name;
