WITH expected_functions(signature) AS (
  VALUES
    ('resolve_post_login_destination_v2()'::text),
    ('resolve_accessible_workspace_by_slug_v2(text)'::text)
)
SELECT
  expected.signature,
  to_regprocedure('public.' || expected.signature) IS NOT NULL AS exists
FROM expected_functions expected
ORDER BY expected.signature;

SELECT
  p.oid::regprocedure::text AS signature,
  p.prosecdef AS security_definer,
  p.proconfig AS function_config,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'resolve_post_login_destination_v2',
    'resolve_accessible_workspace_by_slug_v2'
  )
ORDER BY signature;

SELECT
  p.proname,
  position('ten.slug = p_slug' IN p.prosrc) = 0 AS does_not_accept_tenant_slug,
  position('ten.id::text = p_slug' IN p.prosrc) = 0 AS does_not_accept_tenant_id,
  position('t.id = p_slug' IN p.prosrc) = 0 AS does_not_accept_tournament_id,
  position('business_access_active_v1' IN p.prosrc) > 0 AS checks_commercial_access
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'resolve_accessible_workspace_by_slug_v2';
