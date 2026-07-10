# Security Gate 1 - Account Security & Auth Hardening Audit V1

Ngay audit: 2026-07-05
Pham vi: static audit tren source code, migrations, API routes, Edge Functions va config trong repo.
Rang buoc da tuan thu: khong sua code chay, khong sua database, khong tao migration, khong sua du lieu production, khong merge main.

## Ket Luan Dieu Hanh

Chua du an toan de coi la "Security Gate 1 PASS" cho van hanh giai that.

He thong da co nhieu nen tang dung: frontend dung Supabase anon key, service role khong nam trong `VITE_*`, business mutations phan lon di qua RPC `SECURITY DEFINER`, score/bracket/team/group RPC co guard theo account/event, va co co che active session invalidation khi thu quyen event.

Tuy nhien con it nhat 1 rui ro P0 va mot so P1 can xu ly bang PR nho truoc khi chot van hanh dai ngay:

- P0: API reset mat khau production co the cho `EVENT_ADMIN` reset mat khau tai khoan ngoai pham vi neu biet username.
- P1: update account sang `inactive/banned` khong bat buoc revoke active session/Supabase Auth session ngay.
- P1: con direct write frontend vao bang nghiep vu trong luong import/legacy store.
- P1: public snapshot dang expose kha nhieu truong noi bo nhu `settings`, `metadata`, `tenant_id`.
- P1: audit chua day du cho login failed, workspace access denied va permission denied.

## Bang Rui Ro

| Muc | Rui ro | File/RPC lien quan | Tac dong production | De xuat PR nho |
| --- | --- | --- | --- | --- |
| P0 | `EVENT_ADMIN` co the reset mat khau theo username ma khong kiem tra target role/tenant/event scope. `getActorAccount` cho `EVENT_ADMIN` qua, nhung `reset.js` chi chan cross-tenant cho `TENANT_ADMIN`. | `api/admin/_accountService.js:80`, `api/admin/accounts/reset.js:23`, `api/admin/accounts/reset.js:39`, `api/admin/accounts/reset.js:45` | Tai khoan EVENT_ADMIN co the chiem quyen REFEREE/EVENT_ADMIN/TENANT_ADMIN/SUPER_ADMIN neu biet username, tuy tuy thuoc Supabase Auth update thanh cong. | PR-SEC-01: reset password phai dung chung `ensureEventAdminCanManageTargetAccount`; SUPER_ADMIN/TENANT_ADMIN co scope rieng; chan reset SUPER_ADMIN tru khi SUPER_ADMIN; audit target role/actor. |
| P1 | Khi update account status thanh `inactive` hoac `banned`, route update khong xoa `active_sessions`, khong revoke Supabase refresh sessions. Delete/archive co xoa active_sessions, update thi khong. | `api/admin/accounts/[id].js:31`, `api/admin/accounts/[id].js:76`, `api/admin/accounts/[id].js:82`, `api/admin/accounts/[id].js:123` | User dang online co the khong bi logout ngay; RPC moi co the bi chan do `current_account_id()` yeu cau active, nhung UI/session van co the gay nham lan, va API nao chi verify token co the van cho qua neu khong check account status dung. | PR-SEC-02: neu status doi sang inactive/banned hoac role/tenant thay doi, xoa `active_sessions`, revoke Supabase user sessions neu kha thi, va yeu cau frontend logout realtime. |
| P1 | Direct write frontend vao bang `matches`, `teams`, `groups`, `events`, `tournament`, `audit_logs` con ton tai trong luong import/legacy helpers. | `src/components/Dashboard.tsx:606`, `src/components/Dashboard.tsx:667`, `src/components/Dashboard.tsx:683`, `src/components/Dashboard.tsx:702`, `src/components/Dashboard.tsx:738`, `src/store.ts:623`, `src/store.ts:684`, `src/lib/audit/auditLogger.ts:12`, `src/lib/db/secureQuery.ts:11` | Neu RLS/grants bi lech, frontend co the ghi/xoa truc tiep du lieu production, bo qua business rule/RPC/audit. | PR-SEC-03: khoa hoac go bo import-to-DB legacy tren production; moi write phai qua RPC; audit direct write grants bang SQL read-only truoc khi sua. |
| P1 | Public snapshot cho khan gia expose nhieu field noi bo: `tenant_id`, event `settings`, `scoring_config`, `ranking_config`, match `metadata`, full match/team/group ids. | `supabase/migrations/enterprise_completion_v1/025_public_tournament_snapshot.sql:87`, `:100`, `:105`, `:176`, `:183`, `:197`, `:217` | Co the leak cau hinh noi bo, id noi bo, metadata bracket/seed/schedule khong can thiet cho khan gia. Khong phai leak password, nhung khong dat chuan least disclosure. | PR-SEC-04: tao public DTO toi thieu cho audience/TV; chi tra field can hien thi; khong tra tenant_id/account/permission/metadata noi bo. |
| P1 | Edge Functions account flow lech voi Vercel API production. Edge shared chi cho SUPER_ADMIN/TENANT_ADMIN; Vercel API cho EVENT_ADMIN quan ly REFEREE theo scope. Edge delete hard-delete account/Auth user, Vercel delete soft-delete. | `supabase/functions/_shared/admin-account.ts:80`, `supabase/functions/admin-delete-account/index.ts`, `api/admin/_accountService.js:80`, `api/admin/accounts/[id].js:91` | Neu fallback sang GitHub Pages/Edge Function hoac goi truc tiep Edge Function, hanh vi quyen/xoa tai khoan khac production. | PR-SEC-05: chon 1 backend canonical cho account admin; dong bo Edge Function theo Vercel API hoac tat fallback Edge Function. |
| P1 | Vercel runtime env chua duoc xac minh bang CLI trong audit nay do checkout chua link Vercel project. Repo chi static-scan duoc. | `vercel env ls` tra loi: codebase isn't linked. | Co the co bien Vercel sai ten, service role bi gan nham `VITE_*`, hoac env cu con ton tai ma static repo khong thay. | PR/Task-SEC-06: link Vercel project read-only hoac kiem tra Dashboard: chi cho frontend `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; service role chi server/Edge, khong `VITE_`. |
| P2 | Frontend van co helper role-check don gian, co the gay lech UI neu duoc dung lai. Backend RPC hien van la boundary chinh. | `src/lib/auth/usePermission.ts`, `src/lib/auth/permissions.ts` | UI co the hien/chan sai nut khi quyen chi tiet thay doi; neu backend guard tot thi khong mat data, nhung UX va audit loi. | PR-SEC-07: thay role-only helper bang policy/effective permission helpers theo event/action. |
| P2 | `src/supabaseClient.ts` co fallback hardcoded Supabase URL va anon publishable key. Anon key khong phai secret, nhung production nen fail-fast neu env thieu de tranh tro sai project. | `src/supabaseClient.ts:3`, `src/supabaseClient.ts:4`, `src/lib/config/env.ts:2` | Build/run sai env co the van ket noi Supabase production cu/nham project; kho phat hien khi preview/production doi domain. | PR-SEC-08: bo fallback trong production build; chi giu fallback dev neu co flag ro rang. |
| P2 | Audit logs bi xoa khi hard-delete tenant. Day dung nghiep vu "xoa cung" nhung mat forensic trail. | `supabase/migrations/enterprise_completion_v1/032_archived_tenant_hard_delete.sql:161` | Sau khi xoa cung tenant, khong con log tranh chap/lich su lien quan tenant. | PR-SEC-09: truoc hard-delete, export/snapshot audit log sang evidence table/storage hoac yeu cau xac nhan "delete forensic history". |

## Kiem Tra Env Supabase/Vercel

Ket qua static repo:

- Khong thay `SUPABASE_SERVICE_ROLE_KEY` trong frontend `src/**`.
- Frontend Supabase client dung `VITE_SUPABASE_URL` va `VITE_SUPABASE_ANON_KEY`.
- `.env.example` co `SUPABASE_SERVICE_ROLE_KEY` nhung khong co gia tri secret.
- Git chi track `.env.example`; local co `.env.db.local` nhung khong doc noi dung de tranh lo secret.
- `api/admin/_accountService.js` dung `SUPABASE_SERVICE_ROLE_KEY` server-side.
- `supabase/functions/_shared/admin-account.ts` dung `SUPABASE_SERVICE_ROLE_KEY` Edge Function server-side.

Can xac minh them tren Vercel Dashboard/linked CLI:

- Khong co bien nao ten `VITE_SUPABASE_SERVICE_ROLE_KEY`.
- Khong co `SUPABASE_SERVICE_ROLE_KEY` trong client bundle.
- Production/Preview chi expose frontend-safe vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Serverless API co `SUPABASE_SERVICE_ROLE_KEY` neu account admin API con dung Vercel API.

Ghi chu: `vercel env ls` khong chay duoc trong checkout hien tai vi repo chua link Vercel project local. Audit nay khong doc gia tri env.

## Auth/Account Flow

### Login

- `AuthModal` dung `supabase.auth.signInWithPassword`.
- Sau login goi `get_current_profile`; account bi `deleted_at` hoac `status != active` se khong co profile.
- `record_login_session_v1` ghi `LOGIN_SUCCESS` va `active_sessions`.

Rui ro:

- Khong co audit `LOGIN_FAILED`.
- Neu `record_login_session_v1` loi, frontend chi warn va van cho user tiep tuc.

### Logout va session revoke

- Frontend listen realtime `DELETE` tren `active_sessions` va logout neu `payload.old.account_id` trung user hien tai.
- `grant_event_access_v1`/`revoke_event_access_v1` co goi invalidate session cho target account.
- Delete/archive account route co xoa `active_sessions`.

Rui ro:

- Account update status/role/tenant khong chac invalidate active sessions.
- Supabase Auth refresh token co the con hieu luc neu chi xoa `active_sessions`; can test va neu can dung Admin API revoke/signOut user sessions.

### Doi mat khau / reset mat khau

- Reset password production di qua `/api/admin/accounts/reset`.
- P0: `EVENT_ADMIN` duoc vao API nhung reset route khong check target scope cho EVENT_ADMIN.

### Doi email

- Audit khong thay luong doi email user-facing day du. Update account hien chi update `user_metadata` va password, khong doi email.
- Can co PR rieng neu can doi email: update Supabase Auth email, verify flow, sync `accounts.username/email`, audit, session revoke.

### Disabled/deleted_at

- RPC profile/current_account check `accounts.deleted_at IS NULL` va `status = 'active'`.
- Account soft delete set `status='inactive'`, `deleted_at=now()`.

Rui ro:

- Status update khong revoke active session ngay.

## RPC Security Definer

Nhan xet:

- Da co nhieu RPC `SECURITY DEFINER SET search_path TO public, pg_temp`.
- Score mutations goi `p10_require_match_score_context_v1`.
- Team/group/schedule/KO mutations goi `p06_require_event_admin_v1` / event permission guard.
- Public wrappers revoke `anon` va grant `authenticated` o nhieu migration.

RPC can uu tien test lai bang SQL read-only:

- Account/permission: `grant_event_access_v1`, `revoke_event_access_v1`, `list_permission_tree_v1`, `list_account_access_summary_v1`.
- Score: `update_match_set_score_v1`, `finalize_match_score_v1`, `reset_match_score_v1`, `update_match_status_v1`.
- KO: `save_manual_knockout_bracket_v1`, `clear_knockout_bracket_v1`, `resolve_knockout_slots_v1`.
- Delete/archive: `hard_delete_event_v1`, `hard_delete_tournament_v1`, `hard_delete_tenant_v1`.

Can kiem bang live schema:

```sql
SELECT n.nspname, p.proname, p.oid::regprocedure, p.prosecdef, p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef = true
ORDER BY p.proname;
```

## RLS / Data Isolation

Nhan xet:

- Direct `match_sets` write da bi revoke/lock trong migrations.
- `knockout_slots` co RLS va authenticated SELECT.
- Public snapshot dung RPC rieng cho anon.
- `get_current_profile` chi tra account active cua `auth.uid()`.

Rui ro:

- Con direct frontend writes vao business tables; phai xac minh live grants/RLS thuc su chan.
- Public snapshot can rut gon DTO.
- CORS Edge Function cho moi `*.vercel.app`; tien loi cho preview nhung nen gioi han domain cua project trong production neu co the.

## Frontend Permission Findings

Van con cac diem role/permission client-side:

- `src/lib/auth/usePermission.ts` va `src/lib/auth/permissions.ts` la role-only helper.
- Nhieu component disable button bang `canManage`/`hasPermission`; can coi UI la UX only, khong phai security.
- Da co Phase 1 workspace guard va normalize `tenantId !== 'default'`.
- Can tiep tuc scan sau moi PR bang:

```bash
rg "tenant_id.*default|default'|\"default\"|role ===|role !==|hasPermission|canManage" src
```

## Audit Coverage

Dang co:

- `LOGIN_SUCCESS` qua `record_login_session_v1`.
- Account create/update/archive/reset qua Vercel API audit.
- Grant/revoke event access qua RPC audit.
- Score set save/reset/finalize va KO save/clear co log audit trong RPC.

Thieu hoac chua dam bao:

- `LOGIN_FAILED`.
- `WORKSPACE_ACCESS_DENIED`.
- `PERMISSION_DENIED` audit trong RPC exception path.
- Audit khi account status doi inactive/banned va session revoke.
- Forensic retention truoc hard delete tenant.

## Viec Khong Duoc Lam Trong Security Gate 1

- Khong reset Supabase production.
- Khong xoa `auth.users`.
- Khong sua du lieu giai that.
- Khong dua service role key vao frontend hoac `VITE_*`.
- Khong sua wide refactor quyen trong mot PR lon.
- Khong merge main neu chua test preview/production smoke theo checklist.
- Khong hard-delete tenant/event/tournament de test security tren production.

## De Xuat Tach PR Nho

1. PR-SEC-01: Khoa reset password scope.
   - Sua `/api/admin/accounts/reset`.
   - SUPER_ADMIN: duoc reset non-last/self policy theo quy dinh.
   - TENANT_ADMIN: chi trong tenant, khong reset SUPER_ADMIN.
   - EVENT_ADMIN: chi reset REFEREE do minh quan ly theo event scope, dung `ensureEventAdminCanManageTargetAccount`.
   - Test bang SUPER_ADMIN, TENANT_ADMIN, EVENT_ADMIN, REFEREE.

2. PR-SEC-02: Session invalidation khi account status/role/tenant thay doi.
   - Neu `status != active`, role/tenant change, password reset: xoa active_sessions va revoke Supabase sessions neu kha thi.
   - Frontend realtime logout phai kich hoat.

3. PR-SEC-03: Khoa direct DB writes tu frontend production.
   - Tat import JSON ghi DB hoac dua qua RPC admin/import rieng.
   - Xoa/khong dung `secureTenantDelete/Insert/Upsert` cho business production.
   - Xac minh RLS live khong cho direct write.

4. PR-SEC-04: Public snapshot least-disclosure.
   - Tao DTO public toi thieu.
   - Bo `tenant_id`, raw `metadata`, internal settings khong can thiet.

5. PR-SEC-05: Audit failure events.
   - Ghi `LOGIN_FAILED`, `WORKSPACE_ACCESS_DENIED`, `PERMISSION_DENIED`.
   - Khong ghi password/token.

6. PR-SEC-06: Vercel env verification.
   - Link Vercel project hoac dung Dashboard export ten bien.
   - Luu report ten bien, khong luu gia tri.

## Rollback Note

- Vi audit nay chi tao markdown, rollback la xoa file report tren branch audit.
- Cac PR sua security sau nay phai co rollback rieng:
  - API reset password: rollback route handler ve commit truoc neu block nham.
  - Session invalidation: rollback neu logout nham hang loat.
  - Public snapshot DTO: rollback neu TV/audience route thieu field.
  - Direct write lock: rollback feature import neu can, khong rollback RLS/grants tren production neu chua co SQL verify.

## Test Matrix De Chot Gate

| Ma test | Muc tieu | Tai khoan | Ket qua mong doi |
| --- | --- | --- | --- |
| AUTH-SEC-001 | Vercel env names | Dashboard/CLI | Khong co `VITE_SUPABASE_SERVICE_ROLE_KEY`; service role chi server-side |
| AUTH-SEC-002 | Client bundle secret scan | Production JS bundle | Khong co service role/database/JWT secret |
| AUTH-SEC-003 | Login active account | SUPER_ADMIN/TENANT_ADMIN/EVENT_ADMIN/REFEREE | Dang nhap thanh cong, profile dung |
| AUTH-SEC-004 | Login disabled account | Account inactive/banned | Bi tu choi, khong vao workspace |
| AUTH-SEC-005 | Login failed audit | Sai password | Co audit `LOGIN_FAILED`, khong ghi password |
| AUTH-SEC-006 | Reset password scope | EVENT_ADMIN | Chi reset duoc REFEREE thuoc scope; bi chan cross-tenant/SUPER/TENANT |
| AUTH-SEC-007 | Disable online account | Admin khoa account dang online | Browser target bi logout/revoke quyen trong thoi gian ngan |
| AUTH-SEC-008 | Permission revoke live | Thu quyen EVENT_ADMIN/REFEREE dang online | Cac thao tac team/group/schedule/score/KO bi chan backend |
| AUTH-SEC-009 | Direct table write attempt | REFEREE/VIEWER | Insert/update/delete `matches`, `teams`, `groups`, `events`, `match_sets` bi chan |
| AUTH-SEC-010 | Score RPC scope | REFEREE | Chi nhap diem event duoc cap; cross-event bi `PERMISSION_DENIED` |
| AUTH-SEC-011 | KO RPC scope | EVENT_ADMIN | Chi save/clear KO event duoc cap `manage_matches`; cross-event bi chan |
| AUTH-SEC-012 | Public snapshot | Guest | Chi thay du lieu public can hien thi, khong thay account/permission/internal metadata |
| AUTH-SEC-013 | Workspace denied audit | User vao URL sai quyen | Redirect `/admin/workspaces` va co audit denied |
| AUTH-SEC-014 | Hard delete safety | SUPER_ADMIN staging only | Chi archived object moi xoa duoc; co forensic/export truoc khi xoa |

## Ket Luan

Security Gate 1 chua nen PASS cho van hanh giai that neu chua sua P0 reset password va P1 session/direct-write/public-snapshot/audit gaps.

Khuyen nghi xu ly ngay theo thu tu:

1. PR-SEC-01 reset password scope.
2. PR-SEC-02 session invalidation khi account status/role/tenant doi.
3. PR-SEC-06 xac minh Vercel env runtime.
4. PR-SEC-03 direct DB write lockdown.
5. PR-SEC-04 public snapshot least-disclosure.
6. PR-SEC-05 audit denied/failed events.
