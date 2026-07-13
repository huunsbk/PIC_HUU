# Giai đoạn 4 - Báo cáo hoàn tất bảo mật

Ngày: 2026-07-13

## Phạm vi đã hoàn tất

- Khóa quyền ghi trực tiếp của `anon` và `authenticated` trên toàn bộ bảng public.
- Giữ mutation nghiệp vụ qua RPC/API có kiểm tra actor, role và tenant/event scope.
- Thu hồi quyền gọi trực tiếp các helper `SECURITY DEFINER` nội bộ.
- Giữ `get_public_tournament_snapshot_v1(text)` cho public tournament API.
- Giữ `record_login_session_v1()` cho tài khoản đã xác thực.
- RLS đang bật trên toàn bộ bảng public.
- Schema `public` không cho `anon` hoặc `authenticated` tạo object.

## Migration

- `038_harden_anon_grants_and_legacy_rpc.sql`
- `039_revoke_public_legacy_rpc_execute.sql`
- `040_harden_authenticated_direct_writes.sql`
- `041_harden_internal_rpc_and_saas_writes.sql`

Migration `041` đã apply vào Supabase production ngày 2026-07-13.

## Kết quả xác minh live

- Quyền ghi bảng còn lại của `anon/authenticated`: `0`.
- Bảng public chưa bật RLS: `0`.
- Mutation `SECURITY DEFINER`: `49`.
- Mutation được client execute: `40`.
- Mutation client-executable thiếu actor/scope guard: `0`.
- Gọi trực tiếp `invalidate_account_sessions_v1(uuid)`: bị chặn.
- SUPER_ADMIN gọi RPC và cập nhật đội trong transaction: thành công, sau đó rollback.
- REFEREE cập nhật đội: bị chặn.
- SUPER_ADMIN production đăng nhập, tải profile, gọi list/session RPC và đăng xuất: PASS.
- SUPER_ADMIN production ghi trực tiếp bảng và gọi helper nội bộ: bị chặn.
- Public tournament snapshot: HTTP 200 và trả dữ liệu thật.
- Root, workspace direct route và public tournament route: HTTP 200.
- `npm run build`: PASS.
- `npm run lint`: PASS.
- `git diff --check`: PASS.

## Audit và session

Live audit có dữ liệu cho login, account create/update/archive/restore, grant/revoke event access, score update/finalize/reset, team/group/schedule và knockout. Việc thu quyền hoặc khóa tài khoản tiếp tục xóa `active_sessions`; RPC nghiệp vụ luôn kiểm tra quyền hiện tại nên token cũ không thể tiếp tục mutation sau khi bị thu quyền.

## Giới hạn còn lại

- `login_failed` không thể được ghi bởi RPC sau một lần Supabase Auth thất bại; cần telemetry phía auth gateway nếu sau này yêu cầu theo dõi thất bại tập trung.
- Quyền SELECT trực tiếp hiện được giữ để tránh ảnh hưởng các query đọc hiện hành. RLS vẫn là ranh giới cô lập dữ liệu.
- Thay đổi schema quyền tổng quát hoặc bảng `access_grants` thuộc Giai đoạn 5, không nằm trong Giai đoạn 4.

## Rollback

Nếu một luồng hợp lệ bị chặn, chỉ grant lại đúng bảng hoặc helper bị ảnh hưởng sau khi xác định call site. Không cấp lại `ALL`, không tắt RLS và không rollback các migration bảo mật trước đó.

## Kết luận

Giai đoạn 4 đạt tiêu chí hoàn tất cho production hiện tại. Hệ thống có thể chuyển sang Giai đoạn 5 - chuẩn hóa mô hình doanh nghiệp SaaS.
