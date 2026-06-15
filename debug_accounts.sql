-- Xem cấu trúc bảng accounts và tenants
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('accounts', 'tenants');
