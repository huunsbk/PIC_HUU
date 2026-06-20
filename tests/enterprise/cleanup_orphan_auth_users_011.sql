BEGIN;

DELETE FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1
  FROM public.accounts a
  WHERE a.user_id = au.id
);

COMMIT;
