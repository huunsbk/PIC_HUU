# Giai đoạn 5B - SaaS Quota Enforcement

## Contract

Quota được kiểm tra tại database boundary cho `accounts`, `events` và `teams` khi:

- tạo bản ghi active mới;
- khôi phục bản ghi archived;
- chuyển bản ghi sang tenant khác.

Mỗi tenant/resource dùng advisory transaction lock để hai request đồng thời không vượt quota.

## Quy tắc

- Tenant phải active.
- Subscription phải active/trial và chưa hết hạn.
- Plan phải active.
- Archived data không tiêu thụ quota.
- Mọi role, kể cả SUPER_ADMIN, tuân theo quota của tenant đích.
- Helper và trigger function không được browser role gọi trực tiếp.

## An toàn

Migration không thay đổi plan, subscription hoặc dữ liệu nghiệp vụ hiện có. Account API tiếp tục xóa Auth user vừa tạo nếu insert account bị trigger từ chối.

