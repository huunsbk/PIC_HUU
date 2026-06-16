-- Xem cấu trúc bảng accounts
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'accounts';

-- Xem cấu trúc bảng roles (chứa thông tin role)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'roles';

-- Xem cấu trúc bảng tenants (đơn vị)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tenants';

-- Xem danh sách role có sẵn
SELECT * FROM public.roles;

-- Kiểm tra Row Level Security (RLS) của bảng accounts
SELECT polname, polcmd, polroles, polqual, polwithcheck
FROM pg_policy
WHERE polrelid = 'public.accounts'::regclass;

-- (Chỉ dành cho SuperAdmin trên SQL Editor) Xem danh sách user từ auth.users của Supabase
-- SELECT id, email, created_at, raw_user_meta_data FROM auth.users LIMIT 10;
