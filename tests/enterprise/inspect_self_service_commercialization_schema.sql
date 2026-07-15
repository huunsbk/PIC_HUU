SELECT
  c.table_name,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN (
    'accounts',
    'audit_logs',
    'invoices',
    'roles',
    'subscription_plans',
    'tenant_subscriptions',
    'tenants'
  )
ORDER BY c.table_name, c.ordinal_position;
