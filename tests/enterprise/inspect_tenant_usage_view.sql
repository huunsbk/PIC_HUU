SELECT
  c.table_schema,
  c.table_name,
  c.table_type,
  v.view_definition
FROM information_schema.tables c
LEFT JOIN information_schema.views v
  ON v.table_schema = c.table_schema
 AND v.table_name = c.table_name
WHERE c.table_schema = 'public'
  AND c.table_name IN ('tenant_usage', 'tenant_metrics', 'tenant_subscriptions', 'subscription_plans');
