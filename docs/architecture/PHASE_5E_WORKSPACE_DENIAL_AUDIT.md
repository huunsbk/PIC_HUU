# Phase 5E - Workspace Denial Audit

## Muc tieu

Ghi nhan quyet dinh tu choi workspace ngay tai backend guard. Client khong duoc
tu ghi hoac gia mao security audit.

## Su kien

`WORKSPACE_ACCESS_DENIED` duoc ghi voi actor, tenant cua actor, workspace slug,
result `deny` va mot trong cac reason:

- `invalid_workspace_slug`
- `workspace_not_available`
- `permission_denied`

## Kiem soat dung luong

Cung actor, workspace va reason chi duoc ghi mot lan trong cua so 5 phut.
Truy cap thanh cong khong bi log lap lai moi lan vao route.

## Bao mat

- `record_security_audit_v1` la helper noi bo, authenticated khong co EXECUTE.
- Ket qua tra ve client van dung reason chung `WORKSPACE_NOT_AVAILABLE`.
- Payload di qua sanitizer cua migration 045.

## Rollback

Khoi phuc `can_access_workspace_v1` tu migration 044. Giu log da ghi de bao
toan bang chung audit.
