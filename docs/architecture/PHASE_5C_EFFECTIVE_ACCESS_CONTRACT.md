# Phase 5C - Effective Access Contract

## Muc tieu

Chuan hoa quyen dang co thanh hop dong doc duy nhat ma khong tao bang
`access_grants` va khong thay doi nguon quyen production.

## Nguon du lieu

- `accounts` va `roles` cho danh tinh, vai tro va tenant.
- `account_event_permissions` cho quyen chi tiet theo event.
- Trang thai active cua tenant, tournament va event la dieu kien bat buoc.

## Hop dong moi

- `list_my_effective_access_grants_v1()` tra ve cac grant hieu luc cua chinh
  tai khoan dang dang nhap.
- `can_access_workspace_v1(p_slug)` quyet dinh quyen vao workspace tai backend.

Moi grant co cac thanh phan: subject, action, resource, scope, condition,
time, source va result. `SUPER_ADMIN` co scope system, `TENANT_ADMIN` co scope
tenant, cac vai tro con lai chi nhan grant event dang active.

## Bao mat

- Hai RPC la `SECURITY DEFINER` voi `search_path` co dinh.
- Chi `authenticated` co quyen execute.
- Nguoi dung chi doc quyen cua chinh minh.
- Ket qua tu choi workspace khong tiet lo workspace ton tai hay khong.

## Tuong thich

Phase nay khong tao schema quyen song song. `account_event_permissions` van la
source of truth. Frontend hien tai co the chuyen dan sang hop dong moi trong PR
nho ma khong can thay doi du lieu.

## Rollback

Rollback bang cach drop hai RPC moi. Khong co du lieu nghiep vu nao bi thay doi.
