# Project Current Status

## Muc Tieu Du An

Tournament Manager Enterprise / PIC_HUU la nen tang SaaS multi-tenant quan ly giai dau the thao. Muc tieu truoc mat la van hanh on dinh 100 giai Pickleball, voi kien truc mo rong duoc sang nhieu bo mon khac.

## Trang Thai Hien Tai

- Repo lam viec: `PIC_HUU / Tournament Manager Enterprise`.
- Branch hien tai: `enterprise-completion-v1`.
- Frontend: React + Vite + TanStack React Query, van con mot phan Zustand legacy.
- Backend/database: Supabase PostgreSQL, RLS, RPC.
- Prompt 02 chi tao nen lam viec an toan va tai lieu dieu phoi.
- Chua sua logic app.
- Chua sua Supabase schema.
- Chua reset du lieu.

## Prompt/Phase Hien Tai

- Prompt 06: team, group, schedule, knockout selection, and knockout bracket RPC foundation completed.

## Prompt/Phase Da Hoan Thanh

- Prompt 01: read, understand, and confirm architecture/current gaps.
- Permission probe: repo/git/Supabase object create-edit-delete-cleanup capability verified earlier.
- Prompt 02: initialized workspace coordination docs, folders, command checklist, test matrix, performance checklist, and implementation report.
- Prompt 03: reset demo business data and standardized role/permission foundation.
- Prompt 04: multi-sport schema, event config, scoring/ranking config, and match_sets foundation.
- Prompt 05: locked direct match_sets writes and added core RPCs for event access, event config, scoring, reset, and audit.
- Prompt 06: added RPCs for teams, groups, schedule, knockout candidates, admin knockout confirmation, and bracket generation.

## Migration Da Tao

- `supabase/migrations/enterprise_completion_v1/001_reset_demo_and_roles.sql`
- `supabase/migrations/enterprise_completion_v1/002_multisport_event_matchsets.sql`
- `supabase/migrations/enterprise_completion_v1/003_core_rpcs_rls_audit_scoring.sql`
- `supabase/migrations/enterprise_completion_v1/004_team_group_schedule_knockout_rpcs.sql`

## Migration Da Chay

- `001_reset_demo_and_roles.sql`: ran successfully on Supabase beta via `scripts/supabase-sql-runner.mjs`.
- `002_multisport_event_matchsets.sql`: ran successfully on Supabase beta via `scripts/supabase-sql-runner.mjs`.
- `003_core_rpcs_rls_audit_scoring.sql`: ran successfully on Supabase beta via `scripts/supabase-sql-runner.mjs`.
- `004_team_group_schedule_knockout_rpcs.sql`: ran successfully on Supabase beta via `scripts/supabase-sql-runner.mjs`.

## Test Da Chay

- Prompt 03:
  - `rg "EVENT_MANAGER" src`: PASS, no results.
  - `npm run build`: PASS, Vite chunk-size warning remains.
  - `npm run lint`: PASS.
  - `npm run typecheck`: Project chua cau hinh typecheck.
  - SQL roles check: PASS, roles are `EVENT_ADMIN`, `REFEREE`, `SUPER_ADMIN`, `TENANT_ADMIN`, `VIEWER`.
  - SQL permissions check: PASS, permissions are `*`, `enter_scores`, `manage_accounts`, `manage_billing`, `manage_events`, `manage_groups`, `manage_matches`, `manage_teams`, `manage_tenants`, `manage_tournaments`, `view_audit_logs`, `view_public`.
  - SQL business reset check: PASS, listed business tables have 0 rows.
  - SQL SUPER_ADMIN safety check: PASS, 1 active SUPER_ADMIN remains.
  - SQL auth.users safety check: PASS, 8 auth users remain active.
  - Runtime permission simulation: SUPER_ADMIN dashboard RPC readable; EVENT_ADMIN has no event grants after reset; REFEREE cannot manage teams/groups.
  - Runtime gap: TENANT_ADMIN and VIEWER login checks were not executed because no active auth-linked accounts with those roles currently exist.

- Prompt 04:
  - SQL schema check: PASS, `public.sports`, `public.match_sets`, events config columns, unique `match_id,set_number`, RLS policies exist.
  - Seed check: PASS, `sport_pickleball` exists with Pickleball default set scoring config.
  - Insert test: PASS, single-set and best-of-3 events inserted inside a transaction and rolled back; no prompt04 test events persisted.
  - Permission check: PASS, authenticated can select active sports; REFEREE cannot create sport; REFEREE cannot insert match_sets without event access; REFEREE can insert match_sets with event access; anon cannot write match_sets.
  - Grant check: PASS, anon has 0 write grants on `match_sets`.
  - `npm run build`: PASS, Vite chunk-size warning remains.
  - `rg "EVENT_MANAGER" src`: PASS, no results.
  - `rg "matchSetMode" src`: PASS, found only in new types/validation.
  - `rg "format_type" src`: PASS, found only in new types/validation.
  - `rg "sport_pickleball" .`: PASS, found in migration/docs/validation default only.

- Prompt 05:
  - SQL function existence: PASS, 12/12 helper/RPC functions found.
  - RPC grants: PASS, `authenticated` execute grants exist and `anon` execute grants are absent.
  - Direct write lock: PASS, `anon` and `authenticated` have no INSERT/UPDATE/DELETE/TRUNCATE on `public.match_sets`.
  - Direct insert checks: PASS, `anon` and REFEREE with event access are blocked from direct `match_sets` inserts.
  - Event access tests: PASS, anon/REFEREE grant blocked; SUPER_ADMIN grant/revoke succeeds; event grant required for EVENT_ADMIN/REFEREE.
  - Event config tests: PASS, valid single and best-of-3 configs pass; invalid format/mode/set config fails; REFEREE denied.
  - Single-set scoring: PASS, REFEREE with event access scores 15-10; match finished with aggregate 1-0 and one set row.
  - Best-of-3 scoring: PASS, 1-0, 1-1, 2-1, 2-0, and set-3-after-2-0 block verified.
  - Reset scoring: PASS, match returns to pending, scores/winner cleared, active match_sets cleared.
  - Audit log: PASS, audit rows observed for grant/revoke/config/scoring/set scoring/reset in transaction.
  - Regression: PASS, `auth.users` count=8, active SUPER_ADMIN count=1, standard roles=5, standard permissions=12, `sport_pickleball` exists, events config columns exist, `match_sets` RLS enabled.
  - `npm run build`: PASS, Vite chunk-size warning remains.
  - `npm run lint`: PASS.
  - `npm run typecheck`: Project chua cau hinh typecheck.
  - `rg "EVENT_MANAGER" src`: PASS, no results.
  - Secret scan: variable names/documentation/session-token references only; no secret values printed or committed.

- Prompt 06:
  - Static SQL check: PASS, migration has `SECURITY DEFINER`, `SET search_path TO public, pg_temp`, groupCount bounds 1..32, bracket size check 4/8/16/32, and no admin RPC grant to anon.
  - SQL function existence: PASS, 11/11 required RPCs exist.
  - Group count tests: PASS, 4 teams -> 6 matches, 5 teams -> 10 matches, 16 teams/4 groups -> 24 matches, groupCount 0/33 blocked, fewer teams than groups blocked.
  - Permission tests: PASS, SUPER_ADMIN and granted EVENT_ADMIN can operate; ungranted EVENT_ADMIN, REFEREE, and ANON are blocked. VIEWER runtime not run because no active auth-linked VIEWER account exists.
  - Assign team tests: PASS, team move updates `teams.group_id` and `groups.team_ids`; cross-event group blocked; move after schedule requires regenerate.
  - Knockout candidate tests: PASS, top 2 per group returns 8; +2 best thirds returns 10; exclude bottom result uses derived stats without mutating matches; REFEREE blocked.
  - Confirm knockout tests: PASS, 8/8 and 6/8 with BYE pass; duplicates, cross-event team, 9/8, and bracket size 12 fail; override reason stored.
  - Generate bracket tests: PASS, 8-team bracket creates 7 matches with QF/SF/F IDs and next links; 6-team selection into bracket 8 creates BYE placeholders; duplicate generation blocked; no confirmed teams blocked.
  - Audit tests: PASS for `CREATE_TEAM`, `IMPORT_TEAMS`, `SETUP_GROUPS`, `ASSIGN_TEAM_TO_GROUP`, `GENERATE_SCHEDULE`, `PREPARE_KNOCKOUT_CANDIDATES`, `CONFIRM_KNOCKOUT_TEAMS`, `GENERATE_KNOCKOUT_BRACKET`.
  - Regression: PASS, `auth.users` count=8 and active SUPER_ADMIN count=1.
  - `npm run build`: PASS, Vite chunk-size warning remains.
  - `npm run lint`: PASS.
  - `npm run typecheck`: Project chua cau hinh typecheck.
  - `rg "EVENT_MANAGER" src`: PASS, no results.
  - Secret scan: variable names/documentation/session-token references only; no secret values printed or committed.

- Prompt 02:
- `npm run build`: PASS.
- `npm run lint`: PASS.
- `npm run typecheck`: Project chua cau hinh typecheck.
- `rg "EVENT_MANAGER" src`: co ket qua, can xu ly o Prompt 03.
- `rg "supabase.from\('teams'\).*insert" src`: co ket qua, can RPC hoa o prompt sau.
- `rg "supabase.from\('matches'\).*insert" src`: co ket qua, can RPC hoa o prompt sau.
- `rg "supabase.from\('matches'\).*update" src`: co ket qua, can RPC hoa o prompt sau.
- `rg "supabase.from\('groups'\).*insert" src`: khong co ket qua.
- `rg "service_role|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|JWT_SECRET|refresh_token|access_token" .`: co ket qua ten bien/token references, khong in secret value.

## Loi Con Ton Tai

- Direct writes qua `supabase.from(...)` van con trong frontend; Prompt 07 should wire UI to Prompt 05/06 RPCs and remove direct business writes where practical.
- UI is not yet wired to create/select sports, event format, scoring config, or match set entry.
- `reset_match_score_v1` chua rollback downstream knockout bracket advancement; da ghi TODO cho prompt sau.
- Knockout bracket currently creates winner bracket only; bronze/third-place match can be added later if required.
- Runtime TENANT_ADMIN/VIEWER checks need real auth-linked accounts or controlled test accounts in a later prompt.
- `SECURITY_REPORT_V2.md` had pre-existing uncommitted changes before Prompt 03 and was not modified by this prompt.

## Viec Khong Duoc Lam

- Khong sua logic app trong Prompt 02.
- Khong sua Supabase schema trong Prompt 02.
- Khong chay migration reset du lieu.
- Khong xoa bang.
- Khong xoa `auth.users`.
- Khong sua RLS trong Prompt 02.
- Khong commit secret.

## Quy Tac Bao Mat

- Khong in hoac commit service_role key, database password, JWT secret, access token, refresh token, hoac file `.env`.
- Moi thao tac ghi quan trong o cac prompt sau phai di qua RPC hoac Edge Function.
- Frontend khong tu quyet dinh `tenant_id`, ownership, role, winner, scoring rule.
- RLS phai tiep tuc bat de bao ve database.
- Moi thao tac quan trong can ghi `audit_logs`.

## SUPER_ADMIN Safety

Nguoi dung va Codex phai giu it nhat mot tai khoan `SUPER_ADMIN` dang hoat dong. Khong duoc reset/xoa du lieu theo cach tu khoa he thong.

## Ket Qua Lenh Kiem Tra Prompt 02

### `npm run build`

```text
> react-example@0.0.0 build
> vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs

vite v6.4.2 building for production...
2301 modules transformed.
dist/index.html                 0.47 kB
dist/assets/index-IC6SSMfy.css  111.29 kB
dist/assets/index-C-VZVLP4.js   2,057.29 kB
built in 17.34s

Warning: Some chunks are larger than 500 kB after minification.
dist/server.cjs      15.1kb
dist/server.cjs.map  26.1kb
Done in 8ms
```

Ket qua: PASS, co canh bao chunk lon tu Vite.

### `npm run lint`

```text
> react-example@0.0.0 lint
> eslint .
```

Ket qua: PASS.

### `npm run typecheck`

Project chua cau hinh typecheck. `npm pkg get scripts.typecheck` tra ve:

```json
{}
```

### `rg "EVENT_MANAGER" src`

```text
src\lib\auth\usePermission.ts:  const canManageEvents = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_MANAGER]);
src\lib\auth\usePermission.ts:  const canManageGroups = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_MANAGER]);
src\lib\auth\usePermission.ts:  const canManageTeams = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_MANAGER]);
src\lib\auth\usePermission.ts:  const canManageMatches = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_MANAGER, ROLES.REFEREE]);
src\lib\auth\usePermission.ts:  const canManageKnockout = () => role && hasRole(role as any, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_MANAGER]);
src\lib\auth\permissions.ts:  return hasRole(currentRole, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_MANAGER]);
src\lib\auth\permissions.ts:  return hasRole(currentRole, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_MANAGER, ROLES.REFEREE]);
src\lib\auth\permissions.ts:  return hasRole(currentRole, [ROLES.SUPER_ADMIN, ROLES.TENANT_ADMIN, ROLES.EVENT_MANAGER]);
src\lib\auth\authorization.ts:  EVENT_MANAGER: "EVENT_MANAGER",
src\components\AccountManager.tsx:  const [newRole, setNewRole] = useState('EVENT_MANAGER');
src\components\AccountManager.tsx:                  <option value="EVENT_MANAGER">EVENT_MANAGER (Truong Ban to chuc cap 3)</option>
src\components\AccountManager.tsx:                  <option value="EVENT_MANAGER">EVENT_MANAGER (Truong Ban to chuc cap 3)</option>
```

### `rg "supabase.from\('teams'\).*insert" src`

```text
src\hooks\useDataMutations.ts:         const { error } = await supabase.from('teams').insert(chunk);
```

### `rg "supabase.from\('matches'\).*insert" src`

```text
src\hooks\useDataMutations.ts:        const { error } = await supabase.from('matches').insert(dbMatches);
src\hooks\useDataMutations.ts:        const { error } = await supabase.from('matches').insert(dbMatches);
```

### `rg "supabase.from\('matches'\).*update" src`

```text
src\store.ts:            const { error: e1 } = await supabase.from('matches').update({ deleted_at: deleteTimestamp }).eq('event_id', id);
src\hooks\useDataMutations.ts:         const { error } = await supabase.from('matches').update({ score_a: null, score_b: null, winner_id: null, status: 'pending' }).eq('id', matchId);
src\hooks\useDataMutations.ts:      const { error } = await supabase.from('matches').update({ score_a: null, score_b: null, winner_id: null, status: 'pending' }).eq('id', matchId);
src\hooks\useDataMutations.ts:      const { error } = await supabase.from('matches').update({ status }).eq('id', matchId);
```

### `rg "supabase.from\('groups'\).*insert" src`

```text
No results.
```

### `rg "service_role|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|JWT_SECRET|refresh_token|access_token" .`

```text
.\apply_sql.ts:  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
.\.env.example:# SUPABASE_SERVICE_ROLE_KEY: Required for secure administrative backend operations.
.\.env.example:SUPABASE_SERVICE_ROLE_KEY=
.\check_sync.ts:  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || ""
.\check_rls.ts:  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
.\exec_sql.js:const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
.\exec_sql.js:const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
.\docs\audit\commercial_beta_v1\URGENT_AUTH_SECURITY_FIX_REPORT.md:The Edge Function may use the service role key server-side only. The frontend must never contain a service role key, must not use `VITE_SUPABASE_SERVICE_ROLE_KEY`, and must not call `admin.updateUserById`.
.\security_report.md:During the audit, we reviewed whether the `anon` key or regular `authenticated` key is being misused for operations that require `service_role`.
.\security_report.md:- Administrative operations (such as assigning permissions or creating new accounts) now safely rely strictly on the `SUPER_ADMIN` or `TENANT_ADMIN` clauses natively in RLS, eliminating the need to bypass RLS with `service_role` manually in edge cases.
.\server.ts:  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
.\server.ts:  if (!SUPABASE_SERVICE_ROLE_KEY && process.env.NODE_ENV === "production") {
.\server.ts:    console.warn("WARNING: SUPABASE_SERVICE_ROLE_KEY is not defined in environment variables. Admin operations will fail.");
.\server.ts:  const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
.\server.ts:    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
.\server.ts:      res.status(500).json({ error: 'Server misconfiguration: SUPABASE_SERVICE_ROLE_KEY not set' });
.\server.ts:      if (!supabaseAdmin) throw new Error("Server missing SUPABASE_SERVICE_ROLE_KEY");
.\server.ts:      if (!supabaseAdmin) throw new Error("Server missing SUPABASE_SERVICE_ROLE_KEY");
.\server.ts:      if (!supabaseAdmin) throw new Error("Server missing SUPABASE_SERVICE_ROLE_KEY");
.\server.ts:      if (!supabaseAdmin) throw new Error("Server missing SUPABASE_SERVICE_ROLE_KEY");
.\server.ts:      if (!supabaseAdmin) throw new Error("Server missing SUPABASE_SERVICE_ROLE_KEY");
.\src\components\AccountManager.tsx:      const token = sessionData?.session?.access_token;
.\src\components\AccountManager.tsx:      const token = sessionData?.session?.access_token;
.\src\components\AccountManager.tsx:      const token = sessionData?.session?.access_token;
.\src\components\ResetPasswordModal.tsx:      const token = sessionData?.session?.access_token;
.\tong_hop_code_pickleball.txt:              * Yeu cau quyen quan tri cap cao (service_role) tu bang dieu khien Supabase de can thiep doi mat khau. Key nay chi dung 1 lan, KHONG LUU LAI tren he thong.
.\src\lib\security\sessionHeartbeat.ts:    }).eq('session_token', data.session.access_token);
.\src\lib\security\sessionHeartbeat.ts:          .eq('session_token', data.session.access_token);
.\supabase\migrations\20260617_commercial_beta_v1_group_contracts.sql:  'Commercial Beta V1: optional safe login audit; never stores access_token, refresh_token, or full session objects.';
.\docs\cto\CODEX_COMMANDS.md:rg "service_role|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|JWT_SECRET|refresh_token|access_token" .
.\docs\cto\PROJECT_CURRENT_STATUS.md:- Khong in hoac commit service_role key, database password, JWT secret, access token, refresh token, hoac file `.env`.
```

Khong co secret value nao duoc in trong bao cao nay.

## Ket Qua Lenh Kiem Tra Prompt 03

### Static Search

```text
rg "EVENT_MANAGER" src
No results.
```

### Secret Scan

```text
rg "service_role|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|JWT_SECRET|refresh_token|access_token" .
Matches are variable names, documentation warnings, and session-token references only. No secret values were printed or committed.
```

## GitHub Test Preview Status

- Branch: `enterprise-completion-v1`.
- Preview intent: push current work to GitHub for user online testing.
- Release status: not a stable release.
- Included scope: tenant/tournament/event context, tenant management, tournament management, event management RPCs, and referee event-access modal.
- Demo tenant: `CLB Thắng Oanh`.
- Demo tournament slug: `thang-oanh`.
- Demo events: `Đôi Nam`, `Đôi Nữ`, `Đôi Nam Nữ`.
- Manual browser tests remain pending.
- REFEREE E2E remains blocked because the demo tenant does not yet have an active REFEREE account.
- No database reset was performed.
- Prompt 08 was not run.

Pre-push verification:

```text
npm.cmd run build: PASS, Vite chunk-size warning remains.
npm.cmd run lint: PASS.
rg "EVENT_MANAGER" src: no results.
rg "11111111-1111-1111-1111-111111111111" src: no results.
rg "SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|JWT_SECRET|refresh_token|service_role" .: variable/documentation references only; no secret values found.
```

## Prompt 07-J Current Status

Prompt 07-J completed on Supabase beta.

Demo E2E data is now available for tournament `thang-oanh`:

- Đôi Nam (`evt_6da72de38f5c469d8e829348c92dfde2`): 16 teams, 4 groups, 24 group matches, 24 finished group matches, 8 confirmed knockout teams, 7 knockout matches.
- Đôi Nữ (`evt_4b8ff313ce2c43fb8aa796cf6a9da464`): 8 teams, 2 groups, 12 group matches, 4 finished group matches.
- Đôi Nam Nữ (`evt_86d3121231e2486c99590615a11d5407`): 8 teams, 2 groups, 12 group matches, no scores entered.

Verification:

- Event isolation: PASS.
- `selectedEventId` shape: PASS, demo event ids are `evt_...`.
- Tournament id as event id: PASS, blocked with `INVALID_CONTEXT`.
- Tenant id as event id: PASS, blocked with `INVALID_CONTEXT`.
- Cross-tenant REFEREE grants: PASS, 0 grants.

Remaining:

- REFEREE E2E remains blocked by data because tenant `CLB Thắng Oanh` has 0 active REFEREE accounts.
- No `auth.users` record was created.
- Prompt 08 has not been run.

## Prompt 07-I Status: Business RPC Context Validation

Current phase: Prompt 07-I completed.

Completed:

- Created and applied `supabase/migrations/enterprise_completion_v1/010_business_rpc_context_validation.sql`.
- Added validation helpers for event context, event admin context, match scoring context, and event permission checks.
- Updated `p06_require_event_admin_v1` so Prompt 06 RPCs inherit stricter event id/context validation.
- Wrapped scoring RPCs so `match_id` is validated before core score logic runs.
- Locked internal helper/core functions away from `anon` and `authenticated`.
- Kept public scoring wrappers executable by `authenticated`; `anon` remains blocked.
- Added frontend guard messages for missing tenant, tournament, and event.
- `selectedEventId` must now be a real id beginning with `evt_`.

SQL test results:

```text
post_apply_check_010_context_validation.sql: PASS
auth.users count: 8
active SUPER_ADMIN count: 1
validated demo event: evt_6da72de38f5c469d8e829348c92dfde2
validated role: SUPER_ADMIN
empty event id: INVALID_EVENT_ID
tournament id as event id: INVALID_CONTEXT
tenant id as event id: INVALID_CONTEXT
missing match id: MATCH_NOT_FOUND
REFEREE tt create team on Đôi Nam: INVALID_CONTEXT
```

Frontend/build:

```text
npm.cmd run build: PASS, Vite chunk-size warning remains.
npm.cmd run lint: PASS.
rg "EVENT_MANAGER" src: No results.
Secret scan: variable/documentation references only; no secret value printed or committed.
```

Remaining:

- REFEREE E2E still requires a REFEREE account in tenant `CLB Thắng Oanh`.
- Prompt 07-J and Prompt 08 were not run.

## Prompt 07-H Status: Event-Scoped Referee Access

Current phase: Prompt 07-H completed pending manual browser test with a demo-tenant REFEREE account.

Completed:

- Created and applied `supabase/migrations/enterprise_completion_v1/009_event_access_referee_rpcs.sql`.
- Standardized event access on `account_event_permissions`; no `referees` table was created.
- Added/verified RPCs:
  - `list_event_access_v1(p_event_id text)`
  - `grant_event_access_v1(p_event_id text, p_account_id text, p_permission text)`
  - `revoke_event_access_v1(p_event_id text, p_account_id text, p_permission text)`
- Verified `authenticated` has EXECUTE and `anon` does not have EXECUTE on the new event-access admin RPC signatures.
- Updated frontend modal "Cấp quyền trọng tài" to call RPCs instead of direct writes.
- Kept `auth.users` unchanged.
- Confirmed active SUPER_ADMIN remains available.

Demo data status:

- Demo tenant `CLB Thắng Oanh` currently has no active REFEREE account.
- No demo REFEREE grant was created.
- Existing active REFEREE account `tt` belongs to another tenant and was not granted cross-tenant event access.

Tests run:

```text
post_apply_check_009_event_access.sql: PASS
auth.users count: 8
active SUPER_ADMIN count: 1
eligible demo REFEREE count: 0
Đôi Nam REFEREE grant count: 0
Đôi Nữ REFEREE grant count: 0
rg "EVENT_MANAGER" src: No results.
npm.cmd run build: PASS, Vite chunk-size warning remains.
npm.cmd run lint: PASS.
```

Remaining:

- Manual browser test of the modal is pending.
- End-to-end REFEREE login isolation test requires a REFEREE account in tenant `CLB Thắng Oanh`; this prompt intentionally did not create `auth.users`.

## Prompt 07-C/D/E/F Current Status

### Phase

Prompt 07-C/D/E/F implemented locally. Prompt 08 not started.

### Migrations Created

```text
supabase/migrations/enterprise_completion_v1/005_context_scope_hardening.sql
supabase/migrations/enterprise_completion_v1/006_tenant_management_rpcs.sql
supabase/migrations/enterprise_completion_v1/007_tournament_management_rpcs.sql
```

### Migrations Run

```text
Not run in this turn.
No database reset.
No auth.users changes.
```

### Frontend Status

```text
activeTenantId, activeTenantName, activeTournamentId, and selectedEventId are separated.
/admin/workspace/<slug> resolves workspace context through get_workspace_context_v1 when available.
Menu labels were renamed to Vietnamese product terms.
SUPER_ADMIN tenant management UI was added.
Tournament management UI now calls list/create/archive tournament RPCs.
```

### Tests Run

```text
npm.cmd run build: PASS
npm.cmd run lint: PASS
rg "11111111-1111-1111-1111-111111111111" src: no results
old menu label scan in src: no results
old workspace v6 RPC scan in src: no active results
```

### Remaining Work

```text
Apply migrations 005, 006, 007 to Supabase.
Manual browser test for Thắng Oanh route slug, event visibility, and separated team counts.
```

## Migration 005-006-007 Preflight Apply Status

### Static SQL Safety

```text
Scanned migrations 005, 006, 007 for TRUNCATE, DELETE FROM, DROP TABLE, auth.users.
Result: no destructive reset command found; no auth.users mutation found.
```

### Preflight SQL Result

```text
auth_users_count = 8
active_super_admin_count = 1
orphan_events_tournament_id_count = 0
orphan_teams_event_id_count = 10
orphan_groups_event_id_count = 0
orphan_matches_event_id_count = 0
orphan_match_sets_event_id_count = 0
duplicate_active_tournament_tenant_slug_count = 0
duplicate_tenant_slug_count = 0
```

### Blocking Orphan Detail

```text
teams.event_id = 11111111-1111-1111-1111-111111111111__event-7im6lk9
orphan team names = t1, t2, t3, t4, t5, t6, t7, t8, t9, t10
tournament_id on these rows = 11111111-1111-1111-1111-111111111111
```

### Decision

```text
Migrations 005, 006, 007 were not applied.
Reason: preflight found orphan teams.event_id rows; per safety requirement, apply stopped.
No database reset.
No auth.users changes.
Prompt 07-G and Prompt 08 were not run.
```

## Business Test Data Reset And 005-006-007 Apply Status

### Reset

```text
User confirmed all current Supabase business data is test data.
Business test data reset completed with DELETE statements.
No TRUNCATE CASCADE.
No DROP TABLE.
No auth.users changes.
No accounts/roles/permissions/role_permissions/sports changes.
```

### Counts After Reset

```text
auth.users = 8
accounts = 5
roles = 5
permissions = 12
role_permissions = 20
sports = 1
tenants = 2
active SUPER_ADMIN = 1

match_sets = 0
matches = 0
event_knockout_selections = 0
groups = 0
teams = 0
account_event_permissions = 0
events = 0
tournament = 0
tenant_subscriptions = 0
invoices = 0
payments = 0
audit_logs = 0
```

### Post-Reset Preflight

```text
orphan_events_tournament_id_count = 0
orphan_teams_event_id_count = 0
orphan_groups_event_id_count = 0
orphan_matches_event_id_count = 0
orphan_match_sets_event_id_count = 0
duplicate_active_tournament_tenant_slug_count = 0
duplicate_tenant_slug_count = 0
```

### Migrations

```text
005_context_scope_hardening.sql = applied
006_tenant_management_rpcs.sql = applied
007_tournament_management_rpcs.sql = applied
```

### RPC/Grant Check

```text
All expected 005/006/007 RPCs exist.
authenticated EXECUTE = true
anon EXECUTE = false
auth.users remained 8
active SUPER_ADMIN remained 1
```

### Build/Lint

```text
npm.cmd run build = PASS
npm.cmd run lint = PASS
```

### Current Caveat

```text
No tournament/event/team demo data exists after reset.
The old Thắng Oanh route cannot be manually verified until a new tournament with that slug is created.
tenant_subscriptions = 0, so PLAN_LIMIT_EXCEEDED may appear if quota triggers require a subscription.
```

## Prompt 07-BASE Status

### Demo SaaS Foundation

```text
Tenant demo:
name = CLB Thắng Oanh
slug = clb-thang-oanh
id = 49fdb58c-1c70-4bb6-8ffc-d6ffe711195b
status = active

Subscription demo:
plan = Enterprise
plan_id = 8e88d676-023d-4861-82d9-addd1b4d5783
status = active
creation path = direct insert scoped to demo tenant because no billing RPC exists yet

Tournament demo:
name = Giải Pickleball Thắng Oanh 2026
slug = thang-oanh
id = tournament-ee121f28-e882-466b-acfc-866179df715a
```

### Verification

```text
list_tenants_v1 includes CLB Thắng Oanh = pass
list_tournaments_v1 includes thang-oanh = pass
get_workspace_context_v1('thang-oanh') = pass
auth.users = 8
active SUPER_ADMIN = 1
events = 0
teams = 0
npm.cmd run build = PASS
npm.cmd run lint = PASS
```

### Manual Browser Test

```text
Not executed in this turn because no browser-control tool was available.
Expected: /PIC_HUU/admin/workspace/thang-oanh remains route-based and does not return to #/11111111...
Expected: header shows Đơn vị / Giải / Nội dung thi đấu.
Expected: Nội dung thi đấu is empty until Prompt 07-G creates events.
```

## Prompt 07-G Status

### Migration

```text
008_event_management_rpcs.sql = applied
```

### RPCs

```text
list_events_by_tournament_v1 = exists
create_event_v1 = exists
update_event_v1 = exists
archive_event_v1 = exists
restore_event_v1 = exists

authenticated EXECUTE = true
anon EXECUTE = false
```

### Demo Events

```text
Tournament slug = thang-oanh
Tournament id = tournament-ee121f28-e882-466b-acfc-866179df715a

Đôi Nam = evt_6da72de38f5c469d8e829348c92dfde2
Đôi Nữ = evt_4b8ff313ce2c43fb8aa796cf6a9da464
Đôi Nam Nữ = evt_86d3121231e2486c99590615a11d5407

All 3 events share the same tournament_id.
teams = 0
groups = 0
matches = 0
```

### Build/Lint

```text
npm.cmd run build = PASS
npm.cmd run lint = PASS
```

### Manual Browser Test

```text
Not executed in this turn because no browser-control tool was available.
Expected: Nội dung thi đấu page shows Đôi Nam, Đôi Nữ, Đôi Nam Nữ.
Expected: selecting an event sets selectedEventId to the real evt_... id.
```

## Prompt 07 Current Status

- Prompt/phase current: Prompt 07 frontend RPC wiring.
- Prompt/phase completed: Prompt 02, Prompt 03, Prompt 04, Prompt 05, Prompt 06, Prompt 07 code wiring.
- Migration created: none in Prompt 07.
- Migration run: none in Prompt 07.
- Database reset: not performed.
- `auth.users`: not modified.
- Seed 100 tournaments: not created.

### Prompt 07 Files Changed

- `src/lib/api/tournamentRpc.ts`
- `src/hooks/useTournamentRpcMutations.ts`
- `src/hooks/useDataMutations.ts`
- `src/hooks/useEvents.ts`
- `src/hooks/useMatchSets.ts`
- `src/components/create-event-modal.tsx`
- `src/components/GroupManager.tsx`
- `src/components/ScoreEntry.tsx`
- `src/components/KnockoutBracket.tsx`
- `docs/cto/FRONTEND_RPC_WIRING.md`
- `docs/cto/UI_MANUAL_TESTS.md`
- `docs/cto/PROJECT_CURRENT_STATUS.md`
- `docs/cto/TEST_MATRIX.md`
- `docs/cto/IMPLEMENTATION_REPORT.md`

### Prompt 07 Verification

```text
npm run build: PASS
npm run lint: PASS
npm run typecheck: Project chưa cấu hình typecheck.
rg "EVENT_MANAGER" src: no results
```

### Prompt 07 RPC Usage Check

```text
src/lib/api/tournamentRpc.ts contains calls to:
update_event_config_v1
create_team_v1
update_team_v1
archive_team_v1
import_teams_v1
setup_groups_v4
assign_team_to_group_v2
dissolve_groups_v4
generate_schedule_v1
update_match_score_v1
update_match_set_score_v1
reset_match_score_v1
prepare_knockout_candidates_v1
confirm_knockout_teams_v1
generate_knockout_bracket_v1

src/hooks/useTournamentRpcMutations.ts exposes the same RPC names for UI mutations.
src/components/KnockoutBracket.tsx uses knockout candidate/confirm/generate RPC mutations.
```

### Prompt 07 Direct Write Static Check

```text
rg teams write:
src/store.ts:539
src/components/Dashboard.tsx:600
src/components/Dashboard.tsx:601
src/components/Dashboard.tsx:606

rg groups write:
src/store.ts:541
src/components/Dashboard.tsx:621
src/components/Dashboard.tsx:622
src/components/Dashboard.tsx:627

rg matches write:
src/store.ts:537
src/components/Dashboard.tsx:579
src/components/Dashboard.tsx:580
src/components/Dashboard.tsx:585

rg match_sets write:
no results

rg event_knockout_selections write:
no results
```

Remaining direct writes are legacy event delete and Dashboard JSON import/replace paths. Primary team/group/schedule/scoring/knockout UI flows are now RPC-wired.

### Prompt 07 Secret Scan

```text
rg "service_role|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|JWT_SECRET|refresh_token|access_token" .
Results are variable names, environment placeholders, documentation warnings, and session-token references only. No secret values were printed or committed.
```

### Prompt 07 Remaining Risks

- Event creation itself still uses the existing create-event path because no `create_event_v1` RPC exists yet; event business config is saved through `update_event_config_v1`.
- Legacy Dashboard JSON import/replace and store event-delete paths still write directly to business tables.
- `SchedulerAndScoreKeeper` remains a compact aggregate scoring surface; the dedicated `ScoreEntry` view is the Prompt 07 best-of-3 scoring UI.
- Manual browser flow tests are documented but not executed with live UI data in this prompt.

### Build And Lint

```text
npm run build
PASS. Vite chunk-size warning remains for the main JS bundle.

npm run lint
PASS.

npm run typecheck
Project chua cau hinh typecheck.
```

### SQL Verification

```text
roles:
EVENT_ADMIN, REFEREE, SUPER_ADMIN, TENANT_ADMIN, VIEWER

permissions:
*, enter_scores, manage_accounts, manage_billing, manage_events,
manage_groups, manage_matches, manage_teams, manage_tenants,
manage_tournaments, view_audit_logs, view_public

business counts:
matches=0, teams=0, groups=0, account_event_permissions=0,
audit_logs=0, events=0, tournament=0, tenant_subscriptions=0,
invoices=0, payments=0

active SUPER_ADMIN count:
1

auth.users:
total=8, active=8

EVENT_MANAGER role:
absent
```

### Permission/RLS-Oriented Checks

```text
SUPER_ADMIN:
has '*' = true
can manage tournaments through '*' = true
dashboard RPC readable = true

EVENT_ADMIN:
has manage_events = true
event grants after reset = 0
has_event_access('prompt03-no-event') = false

REFEREE:
can enter_scores = true
can manage teams = false
can manage groups = false
can view_public = true

TENANT_ADMIN / VIEWER:
role_permissions matrix verified, but runtime login checks not executed because no active auth-linked accounts with these roles currently exist.
```

## Ket Qua Lenh Kiem Tra Prompt 04

### SQL Schema Check

```text
sport_pickleball:
id=sport_pickleball, name=Pickleball, slug=pickleball, scoring_type=sets
default_settings includes maxScore=15, capScore=17, winByTwo=true,
matchSetMode=single, setsToWin=1, numberOfSets=1.

events columns:
sport_id text
competition_type text default 'doubles'
format_type text default 'group_then_knockout'
scoring_config jsonb not null default '{}'
ranking_config jsonb not null default '{}'

match_sets:
to_regclass('public.match_sets') = match_sets
unique constraint uq_match_set_number = UNIQUE (match_id, set_number)

RLS:
sports rls_enabled=true
match_sets rls_enabled=true
```

### Insert Test

```text
Created inside transaction:
prompt04_test_event_single:
sport_id=sport_pickleball, competition_type=doubles,
format_type=group_then_knockout, matchSetMode=single, numberOfSets=1

prompt04_test_event_best_of_3:
sport_id=sport_pickleball, competition_type=doubles,
format_type=knockout_only, matchSetMode=best_of_3, numberOfSets=3

Transaction rolled back:
post_rollback_prompt04_test_events=0
```

Note: the insert test needed a temporary `tenant_subscriptions` row inside the same transaction because the existing event quota trigger blocks event creation when no active subscription exists.

### Permission Check

```text
authenticated select sports as SUPER_ADMIN: ok=true
REFEREE create sport: blocked by RLS, code=42501
REFEREE insert match_sets without event access: blocked by RLS, code=42501
REFEREE insert match_sets with event access: ok=true
ANON insert match_sets: blocked, permission denied, code=42501
ANON match_sets write grants: 0
```

### Build And Static Checks

```text
npm run build: PASS, Vite chunk-size warning remains.
rg "EVENT_MANAGER" src: No results.
rg "matchSetMode" src: src/types.ts and src/lib/validation/schemas.ts only.
rg "format_type" src: src/types.ts and src/lib/validation/schemas.ts only.
rg "sport_pickleball" .: migration, DATA_MODEL.md, validation default.
```

### Secret Scan

```text
rg "service_role|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|JWT_SECRET|refresh_token|access_token" .
Matches are variable names, documentation warnings, and session-token references only. No secret values were printed or committed.
```
