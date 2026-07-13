# Giai đoạn 5A - SaaS Entitlements Contract

## Mục tiêu

Chuẩn hóa contract đọc cho chuỗi:

`Tenant -> Subscription -> Plan -> Usage -> Remaining quota -> Can create`

Không tạo bảng `access_grants`, không đổi plan của tenant và không tự động xóa dữ liệu khi vượt quota.

## Vấn đề trước khi sửa

- `tenant_usage` tính cả account, event và team đã archived.
- Frontend/service cũ dùng nhiều tên quota không tồn tại như `max_storage_gb` hoặc `storage_gb`.
- Chưa có RPC duy nhất để đọc plan, subscription và usage theo scope của user hiện tại.
- Chưa có constraint ngăn một tenant có nhiều subscription `active/trial` đồng thời.

## Contract

`get_tenant_entitlements_v1(p_tenant_id uuid default null)` trả về:

- tenant;
- subscription hiện hành;
- plan và giới hạn chuẩn;
- usage chưa archived;
- quota còn lại;
- `can_create` cho accounts, events và teams.

SUPER_ADMIN có thể đọc tenant được chỉ định. Các role khác chỉ được đọc tenant của chính mình.

## Migration

`supabase/migrations/enterprise_completion_v1/042_saas_entitlements_contract.sql`

## Rollback

Rollback riêng RPC, unique partial index và view definition nếu phát hiện contract không tương thích. Không thay đổi dữ liệu subscription hiện tại trong migration này.

