-- Lấy danh sách cấu trúc bảng active_sessions
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'active_sessions';

-- Kiểm tra xem index/constraint nào gây ra lỗi (active_sessions_account_id_key)
SELECT conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE conrelid = 'public.active_sessions'::regclass;

-- Xem xét các quyền RLS (Policies) đang áp dụng trên bảng active_sessions
SELECT polname, polcmd, polroles, polqual, polwithcheck
FROM pg_policy
WHERE polrelid = 'public.active_sessions'::regclass;

-- Kiểm tra các phiên đăng nhập đang bị kẹt của tài khoản admin (id: 33333333-...)
SELECT * FROM public.active_sessions;
