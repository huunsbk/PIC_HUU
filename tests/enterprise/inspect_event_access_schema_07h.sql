SELECT
  'account_event_permissions_columns' AS section,
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'account_event_permissions'
UNION ALL
SELECT
  'account_roles' AS section,
  'accounts',
  a.username,
  r.name,
  a.id::text,
  a.status,
  a.tenant_id::text
FROM public.accounts a
JOIN public.roles r ON r.id = a.role_id
WHERE a.deleted_at IS NULL
ORDER BY section, table_name, column_name;
