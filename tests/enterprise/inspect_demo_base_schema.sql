SELECT
  'accounts_columns' AS section,
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('accounts', 'tenants', 'tenant_subscriptions', 'tournament')
UNION ALL
SELECT
  'function_definition' AS section,
  p.proname AS table_name,
  pg_get_function_identity_arguments(p.oid) AS column_name,
  pg_get_functiondef(p.oid) AS data_type,
  NULL AS udt_name,
  NULL AS is_nullable
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('current_account_id', 'current_tenant_id', 'current_role_name')
ORDER BY section, table_name, column_name;
