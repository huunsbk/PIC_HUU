# PR-SEC-04A / PR-SEC-04C - Anon Grants Hardening

Ngay: 2026-07-10

Pham vi:

- Thu hep quyen ghi truc tiep cua `anon` tren cac bang loi.
- Revoke `anon EXECUTE` khoi mot so RPC legacy/mutation/admin.
- Giu public read RPC `get_public_tournament_snapshot_v1(text)` de `/tournament/:slug` van hoat dong.

## Migration

`supabase/migrations/enterprise_completion_v1/038_harden_anon_grants_and_legacy_rpc.sql`

Follow-up verification showed some RPCs remained executable by `anon` through `PUBLIC` function privileges. Added:

`supabase/migrations/enterprise_completion_v1/039_revoke_public_legacy_rpc_execute.sql`

## Khong Lam Trong PR Nay

- Khong revoke helper RPC nhu `current_account_id`, `current_role_name`, `has_permission`.
- Khong revoke authenticated direct writes trong PR dau tien.
- Khong thay doi RLS policies.
- Khong sua source runtime.
- Khong reset database.

## Ly Do Chon Pham Vi Nay

Live baseline Phase 4 cho thay RLS dang bat tren bang loi, nhung grants cua `anon` qua rong. Neu mot policy RLS bi loose trong tuong lai, grants rong co the bien thanh loi ghi/xoa du lieu. Buoc dau tien nen cat surface `anon` truoc, vi user chua dang nhap khong can ghi truc tiep bang loi.

## RPC Anon Revoke

Revoke `anon EXECUTE` khoi cac RPC legacy/mutation/admin:

- `archive_tournament_workspace_v6(text)`
- `create_tournament_workspace_v6(text,text,text,uuid)`
- `transfer_tournament_owner_v6(text,uuid)`
- `create_event_admin(uuid,text,text,text,text,text)`
- `assign_team_to_group_v1(text,text,text)`
- `dissolve_groups_v2(text)`
- `setup_groups_v2(text,integer)`
- `setup_groups_v3(text,integer,text)`
- `record_login_session_v1()`

## Test Can Chay Sau Khi Apply

- Public `/tournament/pic-cocdan` load du lieu.
- Login SUPER_ADMIN va workspace load du lieu.
- EVENT_ADMIN thao tac doi/bang/lich qua RPC duoc.
- REFEREE nhap diem dung scope duoc.
- Anonymous khong goi duoc cac RPC legacy/mutation neu thu truc tiep.

## Rollback

Neu public route hoac login gap loi do grant, rollback bang migration grant lai dung function/table privilege da revoke. Khong rollback RLS.
