WITH cols AS (
  SELECT
    table_schema,
    table_name,
    column_name,
    data_type,
    is_nullable
  FROM information_schema.columns
  WHERE (table_schema = 'public' AND table_name IN (
    'accounts',
    'tenants',
    'roles',
    'permissions',
    'role_permissions',
    'account_permissions',
    'account_event_permissions',
    'tenant_subscriptions',
    'subscription_plans',
    'tenant_usage',
    'saas_metrics',
    'audit_logs',
    'events',
    'tournament'
  ))
  OR (table_schema = 'auth' AND table_name = 'users')
)
SELECT
  table_schema,
  table_name,
  json_agg(json_build_object(
    'column', column_name,
    'type', data_type,
    'nullable', is_nullable
  ) ORDER BY column_name) AS columns
FROM cols
GROUP BY table_schema, table_name
ORDER BY table_schema, table_name;
