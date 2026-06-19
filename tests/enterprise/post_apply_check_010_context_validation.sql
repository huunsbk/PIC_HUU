WITH auth_ctx AS (
  SELECT
    set_config('request.jwt.claim.sub', '652b872b-e3a9-4d48-8388-1f0ea1289be6', true) AS auth_sub,
    set_config('role', 'authenticated', true) AS auth_role
),
expected_functions(function_name, identity_args) AS (
  VALUES
    ('p10_validate_event_context_v1', 'p_event_id text'),
    ('p10_require_event_admin_v1', 'p_event_id text, p_permission text, p_rpc_name text'),
    ('p10_require_match_score_context_v1', 'p_match_id text, p_rpc_name text'),
    ('p10_has_event_permission_v1', 'p_event_id text, p_permission text'),
    ('p06_require_event_admin_v1', 'p_event_id text, p_permission text, p_rpc_name text'),
    ('p10_core_update_match_score_v1', 'p_match_id text, p_score_a integer, p_score_b integer'),
    ('p10_core_update_match_set_score_v1', 'p_match_id text, p_set_number integer, p_score_a integer, p_score_b integer'),
    ('p10_core_reset_match_score_v1', 'p_match_id text'),
    ('update_match_score_v1', 'p_match_id text, p_score_a integer, p_score_b integer'),
    ('update_match_set_score_v1', 'p_match_id text, p_set_number integer, p_score_a integer, p_score_b integer'),
    ('reset_match_score_v1', 'p_match_id text')
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
demo_event AS (
  SELECT e.id
  FROM public.events e
  JOIN public.tournament t ON t.id = e.tournament_id
  WHERE t.slug = 'thang-oanh'
    AND e.name = 'Đôi Nam'
    AND e.deleted_at IS NULL
  LIMIT 1
),
context_check AS (
  SELECT public.p10_validate_event_context_v1((SELECT id FROM demo_event)) AS ctx
  FROM auth_ctx
),
safety AS (
  SELECT
    (SELECT count(*) FROM auth.users) AS auth_users_count,
    (
      SELECT count(*)
      FROM public.accounts a
      JOIN public.roles r ON r.id = a.role_id
      WHERE r.name = 'SUPER_ADMIN'
        AND a.status = 'active'
        AND a.deleted_at IS NULL
    ) AS active_super_admin_count,
    (SELECT id FROM demo_event) AS demo_event_id,
    (SELECT ctx->>'event_id' FROM context_check) AS validated_event_id,
    (SELECT ctx->>'role_name' FROM context_check) AS validated_role_name
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
  NULL::text AS demo_event_id,
  NULL::text AS validated_event_id,
  NULL::text AS validated_role_name
FROM function_checks
UNION ALL
SELECT
  'safety' AS check_type,
  'context_validation_state' AS name,
  NULL AS identity_args,
  true AS exists,
  NULL AS authenticated_execute,
  NULL AS anon_execute,
  auth_users_count,
  active_super_admin_count,
  demo_event_id,
  validated_event_id,
  validated_role_name
FROM safety
ORDER BY check_type, name;
