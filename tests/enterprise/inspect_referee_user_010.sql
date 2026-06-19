SELECT
  a.id AS account_id,
  a.user_id,
  a.username,
  a.tenant_id,
  r.name AS role_name,
  a.status,
  a.deleted_at IS NULL AS active_row
FROM public.accounts a
JOIN public.roles r ON r.id = a.role_id
WHERE r.name = 'REFEREE'
ORDER BY a.username;
