SELECT
  au.id,
  au.email,
  au.created_at,
  au.last_sign_in_at,
  au.raw_user_meta_data
FROM auth.users au
LEFT JOIN public.accounts a ON a.user_id = au.id
WHERE a.id IS NULL
ORDER BY au.created_at DESC;
