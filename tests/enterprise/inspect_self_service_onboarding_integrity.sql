SELECT
  (SELECT count(*) FROM (
    SELECT user_id
    FROM public.accounts
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    HAVING count(*) > 1
  ) duplicate_users) AS duplicate_account_user_ids,
  (SELECT count(*) FROM public.roles WHERE name = 'EVENT_ADMIN') AS event_admin_roles,
  (SELECT count(*) FROM public.tenants WHERE slug IS NULL OR btrim(slug) = '') AS tenants_without_slug;
