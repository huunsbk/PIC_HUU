-- 1. Đảm bảo bảng accounts có ràng buộc UNIQUE trên user_id để dùng được lệnh (onConflict: 'user_id')
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_constraint 
    WHERE conname = 'accounts_user_id_key'
  ) THEN
    ALTER TABLE public.accounts ADD CONSTRAINT accounts_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- 2. Đồng bộ các user đã được tạo bên auth.users nhưng bị thiếu bên bảng accounts
INSERT INTO public.accounts (user_id, tenant_id, role_id, username, display_name, status)
SELECT 
    au.id as user_id,
    (au.raw_user_meta_data->>'tenant_id')::uuid as tenant_id,
    (SELECT id FROM public.roles WHERE name = COALESCE(au.raw_user_meta_data->>'role', 'VIEWER') LIMIT 1) as role_id,
    COALESCE(au.raw_user_meta_data->>'username', split_part(au.email, '@', 1)) as username,
    COALESCE(au.raw_user_meta_data->>'display_name', 'Người dùng mới') as display_name,
    'active' as status
FROM auth.users au
LEFT JOIN public.accounts a ON a.user_id = au.id
WHERE a.id IS NULL
  AND au.raw_user_meta_data->>'tenant_id' IS NOT NULL;
