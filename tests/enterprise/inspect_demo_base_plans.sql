WITH plan_tables AS (
  SELECT table_schema, table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND (
      table_name ILIKE '%plan%'
      OR table_name ILIKE '%subscription%'
    )
),
fk_constraints AS (
  SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
   AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name = 'tenant_subscriptions'
),
super_admin AS (
  SELECT
    a.id AS account_id,
    a.user_id,
    a.tenant_id,
    a.username,
    a.display_name,
    r.name AS role_name
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  WHERE r.name = 'SUPER_ADMIN'
    AND a.status = 'active'
  ORDER BY a.created_at
  LIMIT 1
)
SELECT 'plan_tables' AS section, table_schema, table_name, NULL AS column_name, NULL AS extra
FROM plan_tables
UNION ALL
SELECT 'tenant_subscription_fk' AS section, 'public', table_name, column_name, foreign_table_name || '.' || foreign_column_name
FROM fk_constraints
UNION ALL
SELECT 'super_admin' AS section, 'public', 'accounts', username, jsonb_build_object('account_id', account_id, 'user_id', user_id, 'tenant_id', tenant_id, 'display_name', display_name, 'role_name', role_name)::text
FROM super_admin
ORDER BY section, table_name;
