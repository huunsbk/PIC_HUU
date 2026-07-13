# Báo cáo hoàn thành Giai đoạn 5 - Mô hình SaaS doanh nghiệp

Ngày xác nhận: 13/07/2026  
Production: https://picvn.vercel.app  
Baseline `main`: `69e3c1d`

## Kết luận

Giai đoạn 5 đã hoàn thành theo mô hình tương thích production hiện tại. Hệ
thống đã có hợp đồng entitlement, enforcement quota tại database, hợp đồng
quyền hiệu lực, workspace guard phía backend và audit có cấu trúc.

Không tạo bảng `access_grants`. `account_event_permissions` tiếp tục là source
of truth theo quyết định kiến trúc; hợp đồng mới cho phép chuyển đổi sau này mà
không làm lại frontend.

## Phạm vi đã triển khai

| Phần | PR | Migration | Kết quả |
|---|---:|---:|---|
| Tenant - Subscription - Plan - Usage entitlement | #41 | 042 | PASS |
| Enforcement quota account/event/team | #42 | 043 | PASS |
| Effective access và backend workspace guard | #43 | 044 | PASS |
| Structured audit và loại bỏ secret | #44 | 045 | PASS |
| Audit workspace bị từ chối, chống ghi trùng | #45 | 046 | PASS |

## Kiểm thử production

- Đăng nhập SUPER_ADMIN thật: PASS.
- `get_tenant_entitlements_v1`: PASS.
- `list_my_effective_access_grants_v1`: PASS.
- `can_access_workspace_v1('pic-cocdan')`: PASS.
- Chrome headless mở trực tiếp `/admin/workspace/pic-cocdan`: PASS.
- Không redirect sai, không trắng trang, không runtime error: PASS.
- Root, direct workspace và public tournament trả HTTP 200: PASS.
- Workspace không tồn tại trả lý do chung và ghi audit `deny`: PASS.
- Hai denial giống nhau trong 5 phút chỉ ghi một row: PASS.
- Audit production ghi đủ actor, role, category, entity, result và JSON: PASS.
- Payload audit loại bỏ password/token/secret lồng nhau: PASS.
- Quota đủ điều kiện cho phép tạo; vượt quota và subscription inactive bị chặn
  trong transaction test rồi rollback: PASS.
- `npm run build`, `npm run lint`, `git diff --check`: PASS ở từng PR.

## An toàn dữ liệu

- Không reset database.
- Không xóa hoặc sửa dữ liệu giải đấu để kiểm thử.
- Không xóa `auth.users`.
- Các probe quota/quyền dùng transaction rollback.
- Không ghi password, token, service role key hoặc secret vào source/report/log.

## Ranh giới đã chấp nhận

- `LOGIN_FAILED` thuộc log của Supabase Auth; database nghiệp vụ không có phiên
  xác thực để ghi actor đáng tin cậy.
- Một RPC ném exception không thể commit audit denial trong cùng transaction.
  Workspace guard trả kết quả thay vì ném lỗi nên denial của cửa vào đã được ghi
  bền vững. Telemetry ngoài transaction cho các RPC bị từ chối là hạng mục vận
  hành/observability của Giai đoạn 7.
- Chưa tạo physical `access_grants`; chỉ thực hiện khi có nhu cầu scope mới như
  match, public dashboard hoặc grant có thời hạn.

## Trạng thái bàn giao

Giai đoạn 5 đủ điều kiện đóng. Bước tiếp theo là Giai đoạn 6 - mở rộng đa môn
thể thao, triển khai theo adapter/ruleset từng môn và không thay đổi lại cổng
đăng nhập, entitlement, workspace guard hoặc audit contract vừa chốt.
