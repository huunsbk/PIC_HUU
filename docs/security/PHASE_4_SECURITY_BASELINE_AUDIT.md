# Phase 4 Security Baseline Audit

Ngay audit: 2026-07-10

Pham vi: khoi dong Giai doan 4 sau khi Giai doan 3 da pass production test. Audit nay chi doc source code va live schema, khong sua database, khong reset data, khong tao migration.

Evidence live schema:

- `docs/security/evidence/phase4_live_schema_baseline.json`
- `docs/security/evidence/phase4_anon_legacy_function_defs.sql`

## Ket Luan Dieu Hanh

He thong da du nen de bat dau Giai doan 4, nhung **chua nen chot Security PASS**.

Nhung diem tot:

- Cac bang loi duoc kiem tra deu da bat RLS.
- Account admin production da chuyen ve Vercel API canonical.
- Edge `admin-delete-account` da bi vo hieu hoa trong source.
- Cac luong doi/bang/lich quan trong da co RPC guard va da pass production test.
- Migration `037` da apply vao Supabase.

Nhung diem can xu ly trong Giai doan 4:

- Live DB dang cap quyen bang truc tiep qua rong cho `anon` va `authenticated`; RLS co the chan, nhung surface khong dat least privilege.
- Nhieu `SECURITY DEFINER` function legacy/mutation van co `anon EXECUTE`.
- Frontend van con direct write/delete/upsert vao bang nghiep vu trong luong import JSON va legacy store.
- Public snapshot van can duoc rut gon DTO de tranh leak metadata/id noi bo.
- Audit denied/failure events chua du chuan doanh nghiep.

## Live Schema Findings

### RLS

Kiem tra live schema cho cac bang loi:

- `accounts`
- `tenants`
- `tournament`
- `events`
- `teams`
- `groups`
- `matches`
- `match_sets`
- `knockout_slots`
- `account_event_permissions`
- `audit_logs`
- `active_sessions`

Ket qua: khong phat hien bang loi nao tat RLS trong evidence.

### Direct Table Grants

Live grants dang rong:

- `anon` co table privileges tren nhieu bang loi, gom `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`.
- `authenticated` co `INSERT`, `UPDATE`, `DELETE` tren cac bang loi.

Tac dong:

- RLS hien la lop chan chinh.
- Tuy nhien trong kien truc doanh nghiep, frontend khong nen co surface direct write/delete vao bang nghiep vu.
- Neu mot policy RLS bi sai trong tuong lai, grants rong se bien thanh loi nghiem trong.

De xuat:

- PR-SEC-04A: revoke direct write grants khoi `anon` cho bang loi.
- PR-SEC-04B: audit va thu hep direct write grants cua `authenticated`; chi giu nhung bang thuc su can client write, neu con.
- Lam tung PR nho, co SQL verify truoc/sau.

### SECURITY DEFINER Functions

Live schema co 95 `SECURITY DEFINER` functions trong public.

Mot so function legacy/mutation dang co `anon EXECUTE`, vi du:

- `archive_tournament_workspace_v6(text)`
- `create_tournament_workspace_v6(text,text,text,uuid)`
- `transfer_tournament_owner_v6(text,uuid)`
- `create_event_admin(uuid,text,text,text,text,text)`
- `assign_team_to_group_v1(text,text,text)`
- `setup_groups_v2(text,integer)`
- `setup_groups_v3(text,integer,text)`
- `dissolve_groups_v2(text)`

Quan sat:

- Nhieu function co guard noi bo bang `auth.uid()`, `current_role_name()`, `has_permission()`.
- Tuy nhien grant `anon EXECUTE` cho mutation/legacy function la surface khong can thiet.
- `create_event_admin(...)` la function legacy tao `auth.users` truc tiep va nhan password input. Du co role guard, no nen bi revoke khoi `anon` va khong nen la path production.

De xuat:

- PR-SEC-04C: revoke `anon EXECUTE` tren tat ca mutation/admin/security-definer functions, chi giu cac public read RPC that su can public:
  - `get_public_tournament_snapshot_v1(text)` neu public route con dung.
- Kiem tra frontend/public route truoc khi revoke.

## Source Findings

### Direct Frontend Writes

Con direct writes vao bang nghiep vu:

- `src/components/Dashboard.tsx`
  - delete/upsert `matches`, `teams`, `groups`, `events`, `tournament`
  - day la luong import JSON/legacy sync co kha nang bo qua RPC business rules.
- `src/store.ts`
  - update soft-delete `events`, `matches`, `teams`, `groups`
  - insert default `tournament`
- `src/lib/audit/auditLogger.ts`
  - insert `audit_logs` tu frontend.
- `src/lib/security/sessionHeartbeat.ts`
  - update/delete `active_sessions`.

Tac dong:

- RLS co the chan, nhung day khong phai kien truc mong muon.
- Logic xoa/nghiep vu da duoc chuan hoa bang RPC, nen direct writes la no ky thuat can thu hep.

De xuat:

- PR-SEC-04D: khoa hoac an luong import JSON ghi DB tren production, hoac dua qua RPC import rieng.
- PR-SEC-04E: thay frontend audit insert bang server/RPC audit helper.
- PR-SEC-04F: danh gia session heartbeat: giu neu can realtime logout, nhung thu hep policy/grants chi cho row cua chinh user.

### Edge Functions

Source hien chi con match:

- `supabase/functions/admin-delete-account/index.ts`

Trang thai:

- Function nay da return 410 trong source.
- Can xac minh live Supabase Edge deploy neu Edge Functions con duoc deploy thu cong. Source da dung, nhung live Edge runtime co the chua sync neu khong auto deploy.

## P0 / P1 / P2 Risks

| Muc | Rui ro | Bang chung | Tac dong | PR de xuat |
| --- | --- | --- | --- | --- |
| P0 | Grants live qua rong cho `anon` tren bang loi. RLS dang chan, nhung surface khong dat least privilege. | `phase4_live_schema_baseline.json` | Neu RLS sai/loose, anon co du grants de doc/ghi/xoa bang loi. | PR-SEC-04A |
| P0 | `anon EXECUTE` tren SECURITY DEFINER mutation/admin legacy functions. | `phase4_live_schema_baseline.json`, `phase4_anon_legacy_function_defs.sql` | Tang surface bypass RLS neu guard noi bo co bug. | PR-SEC-04C |
| P1 | Direct frontend delete/upsert bang nghiep vu trong import JSON/legacy store. | `src/components/Dashboard.tsx`, `src/store.ts` | Bo qua RPC/audit/business invariant; nguy hiem neu RLS/grants lech. | PR-SEC-04D |
| P1 | Public snapshot can least-disclosure. | `get_public_tournament_snapshot_v1` docs/audit cu | Khan gia/public co the thay internal ids/metadata khong can thiet. | PR-SEC-04G |
| P1 | Audit denied/failure events chua du. | audits cu | Kho dieu tra access denied, permission denied, login failed. | PR-SEC-04H |
| P2 | Frontend role/permission helper con rairac. | `src/lib/auth/**`, components | UX co the lech voi backend policy. | Phase 4/5 policy cleanup |

## Thu Tu PR De Xuat Cho Giai Doan 4

1. **PR-SEC-04A - Live grants hardening preflight**
   - Tao report SQL read-only chi ra grants hien tai.
   - Tao migration revoke `anon` direct table write grants tren bang loi.
   - Khong doi frontend logic.

2. **PR-SEC-04C - Revoke anon execute on legacy mutation RPC**
   - Giu public read RPC can thiet.
   - Revoke `anon EXECUTE` cho mutation/admin legacy functions.
   - Test public `/tournament/:slug` van hoat dong.

3. **PR-SEC-04D - Remove or gate direct frontend DB writes**
   - Khoa import JSON ghi DB tren production hoac dua qua RPC.
   - Loai bo direct delete/upsert `matches/teams/groups/events` tu UI production.

4. **PR-SEC-04G - Public snapshot least-disclosure**
   - Rut gon DTO public/TV.
   - Khong tra internal metadata neu UI khong can.

5. **PR-SEC-04H - Audit denied/failure events**
   - `LOGIN_FAILED`
   - `WORKSPACE_ACCESS_DENIED`
   - `PERMISSION_DENIED`
   - `SESSION_REVOKED`

## Test Matrix Cho PR Dau Tien

PR-SEC-04A/04C can test:

- Public `/tournament/pic-cocdan` van load.
- Authenticated SUPER_ADMIN vao workspace duoc.
- EVENT_ADMIN thao tac team/group/schedule/score qua RPC duoc.
- REFEREE chi nhap diem duoc dung scope.
- Anonymous khong goi duoc mutation/admin RPC legacy.
- `npm run build` pass.
- `npm run lint` pass.
- Live SQL verify sau migration:
  - `anon` khong con direct write grants bang loi.
  - `anon` khong con execute mutation/admin SECURITY DEFINER functions.
  - Public snapshot RPC can thiet van execute duoc neu con dung public route.

## Viec Khong Lam Trong Buoc Khoi Dong Nay

- Khong reset Supabase.
- Khong sua auth.users.
- Khong sua production data.
- Khong tao migration revoke ngay trong audit baseline.
- Khong gop chung tat ca hardening vao mot PR lon.

## Ket Luan

Giai doan 4 nen bat dau bang **least-privilege hardening**: thu hep grants va RPC execute surface truoc, sau do moi go direct write removal, public DTO va audit denied/failure.

De xuat hanh dong tiep theo: lam **PR-SEC-04A + PR-SEC-04C** trong mot PR nho neu test public route duoc, hoac tach thanh hai PR neu muon giam rui ro.
