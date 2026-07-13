# Giai đoạn 6B - UI môn thể thao động

## Phạm vi

- Catalog môn lấy từ `list_active_sports_v1`, không hard-code danh sách trong modal.
- Tạo/chỉnh nội dung chỉ hiển thị loại nội dung và số séc được ruleset của môn hỗ trợ.
- Cầu lông mặc định best-of-3, 21 điểm, cap 30.
- Bóng bàn mặc định best-of-3, 11 điểm, cap 21.
- Pickleball tiếp tục kế thừa cấu hình chung của giải để không đổi hành vi production hiện tại.
- Màn quản lý nội dung và TV hiển thị tên môn; public chỉ đọc metadata catalog không nhạy cảm.

## Database

- Migration `048_public_sport_catalog.sql` chỉ cấp `anon` quyền gọi RPC đọc catalog.
- Không cấp quyền ghi bảng `sports`, không đổi tenant/RLS/account/session.
- Catalog công khai không chứa dữ liệu tenant, tài khoản hay quyền.

## Kiểm thử

- `npm run build`: PASS.
- `npm run lint`: PASS.
- `git diff --check`: PASS.
- DB verification: `anon=true`, `authenticated=true`, 3 môn active.
- HTTP anon RPC: 200, đủ Pickleball/Cầu lông/Bóng bàn.
- Browser local SUPER_ADMIN: modal tải đủ 3 môn, đổi môn cập nhật đúng mode/điểm, không lỗi console.
- Public TV cần xác nhận trên Vercel Preview vì local Express không phục vụ Vercel Function `/api/public/tournament/:slug`.

## Rollback

- Revoke `EXECUTE` của `anon` trên `list_active_sports_v1` để quay lại catalog chỉ dành cho authenticated.
- Revert UI về nhánh trước; không cần phục hồi dữ liệu giải.
