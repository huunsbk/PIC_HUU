-- Gỡ bỏ cảnh báo giới hạn (Quota Limit) để bạn có thể tạo số lượng tài khoản tùy ý

-- 1. Xóa function kiểm tra (nó sẽ tự động xóa các trigger đang gọi function này ở bảng accounts)
DROP FUNCTION IF EXISTS public.trg_check_user_quota() CASCADE;

-- (Dự phòng) Nếu nó tự tạo lại, bạn có thể chạy thêm lệnh vô hiệu hóa trực tiếp trigger
-- ALTER TABLE public.accounts DISABLE TRIGGER ALL; -- Chỉ dùng nếu bạn muốn tắt hẳn mọi trigger
