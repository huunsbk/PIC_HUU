-- Lấy danh sách cấu trúc bảng login_logs
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'login_logs';

-- Kiểm tra các foreign keys và constraints khác
SELECT conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE conrelid = 'public.login_logs'::regclass;

-- Xem xét các quyền RLS (Policies) đang áp dụng trên bảng login_logs
SELECT polname, polcmd, polroles, polqual, polwithcheck
FROM pg_policy
WHERE polrelid = 'public.login_logs'::regclass;
