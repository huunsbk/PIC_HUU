# Implementation Report

## Prompt 02

- Prompt 02 initialized.
- Chua sua database.
- Chua reset du lieu.
- Chua sua nghiep vu.

## Scope

- Created coordination docs and folders for enterprise completion.
- No application logic changes.
- No Supabase schema changes.
- No migration execution.

## Prompt 03

- Created migration: `supabase/migrations/enterprise_completion_v1/001_reset_demo_and_roles.sql`.
- Ran migration on Supabase beta.
- Reset demo business data in the listed tables.
- Did not delete or modify `auth.users`.
- Standardized roles to `SUPER_ADMIN`, `TENANT_ADMIN`, `EVENT_ADMIN`, `REFEREE`, `VIEWER`.
- Standardized permissions to `*`, `manage_tenants`, `manage_accounts`, `manage_tournaments`, `manage_events`, `manage_teams`, `manage_groups`, `manage_matches`, `enter_scores`, `view_audit_logs`, `view_public`, `manage_billing`.
- Removed `EVENT_MANAGER` from `src`.
- Updated role/permission UI guards and role selection options.
- Created `docs/cto/ROLE_PERMISSION_MATRIX.md`.

## Prompt 03 Verification

| Check | Result |
|---|---|
| `rg "EVENT_MANAGER" src` | Pass, no results |
| `npm run build` | Pass, Vite chunk-size warning remains |
| `npm run lint` | Pass |
| `npm run typecheck` | Not configured |
| Business data counts | Pass, all listed tables are 0 |
| Active SUPER_ADMIN | Pass, count = 1 |
| `auth.users` | Pass, total = 8, active = 8 |
| SUPER_ADMIN runtime | Pass, dashboard RPC readable |
| EVENT_ADMIN no event grant | Pass, no event access after reset |
| REFEREE restrictions | Pass, cannot manage teams/groups |
| TENANT_ADMIN runtime | Blocked, no auth-linked TENANT_ADMIN account exists |
| VIEWER runtime | Blocked, no auth-linked VIEWER account exists |

## Prompt 03 Remaining Risks

- Direct frontend writes via `supabase.from(...)` still exist and should be RPC-ized later.
- `update_match_score_v1` still needs implementation/verification in the scoring RPC prompt.
- Runtime TENANT_ADMIN and VIEWER checks need controlled test accounts in a later prompt.

## Prompt 04

- Created migration: `supabase/migrations/enterprise_completion_v1/002_multisport_event_matchsets.sql`.
- Ran migration on Supabase beta.
- Added `public.sports` and seeded `sport_pickleball`.
- Added event config columns: `sport_id`, `competition_type`, `format_type`, `scoring_config`, `ranking_config`.
- Added format and competition type constraints.
- Added `public.match_sets` with set-level score storage and unique `(match_id, set_number)`.
- Enabled RLS on `sports` and `match_sets`.
- Added scoped RLS policies and grants for `authenticated`.
- Revoked `anon`/`PUBLIC` table privileges on `sports` and `match_sets`; `anon` has zero write grants on `match_sets`.
- Updated TypeScript types in `src/types.ts`.
- Updated Zod validation in `src/lib/validation/schemas.ts`.
- Created `docs/cto/DATA_MODEL.md`.

## Prompt 04 Verification

| Check | Result |
|---|---|
| SQL sports seed | Pass, `sport_pickleball` exists |
| SQL events columns | Pass |
| SQL match_sets table | Pass |
| Unique `(match_id,set_number)` | Pass |
| RLS policies | Pass |
| Transaction insert single-set event | Pass, rolled back |
| Transaction insert best-of-3 event | Pass, rolled back |
| Authenticated select sports | Pass |
| REFEREE create sport | Blocked by RLS |
| REFEREE write match_sets without event access | Blocked by RLS |
| REFEREE write match_sets with event access | Pass |
| ANON write match_sets | Blocked; no anon write grant |
| `npm run build` | Pass, chunk-size warning remains |
| `rg "EVENT_MANAGER" src` | Pass, no results |
| Secret scan | No secret values found |

## Prompt 04 Remaining Risks

- Frontend UI is not yet wired to choose sport/event format/scoring/ranking config.
- Scoring RPCs were implemented in Prompt 05; frontend wiring remains for a later prompt.
- Direct frontend writes from earlier phases remain and should be replaced by RPCs in later prompts.
- Event insert tests currently require an active tenant subscription because existing quota triggers enforce plan limits.

## Prompt 05

- Created migration: `supabase/migrations/enterprise_completion_v1/003_core_rpcs_rls_audit_scoring.sql`.
- Ran migration on Supabase beta.
- Standardized helper functions:
  - `current_account_id()`
  - `current_tenant_id()`
  - `current_role_name()`
  - `has_permission(perm_name text)`
  - `has_event_access(check_event_id text)`
- Created/standardized RPCs:
  - `log_audit_event_v1`
  - `grant_event_access_v1`
  - `revoke_event_access_v1`
  - `update_event_config_v1`
  - `update_match_score_v1`
  - `update_match_set_score_v1`
  - `reset_match_score_v1`
- Locked direct client writes to `public.match_sets` by revoking write grants from `anon` and `authenticated` and dropping direct write RLS policies.
- Preserved authenticated SELECT on `match_sets` for UI/live score reads.
- Added audit logging for event access, event config, scoring, set scoring, and reset.
- Did not reset data.
- Did not delete or modify `auth.users`.
- Did not create seed data for 100 tournaments.
- Did not make broad UI changes.

## Prompt 05 Verification

| Check | Result |
|---|---|
| Migration execution | Pass |
| Static SQL markers | Pass, `SECURITY DEFINER`, `SET search_path`, grants, and revokes present |
| Admin RPC grant to anon | Pass, no anon execute grant found |
| Required function existence | Pass, 12/12 functions found |
| `match_sets` direct writes | Pass, anon/authenticated write grants absent |
| `match_sets` RLS | Pass, enabled |
| Event access tests | Pass |
| Event config tests | Pass |
| Single-set scoring tests | Pass |
| Best-of-3 scoring tests | Pass |
| Reset scoring tests | Pass |
| Audit log tests | Pass |
| Regression: active SUPER_ADMIN | Pass, count = 1 |
| Regression: `auth.users` | Pass, count = 8 |
| Regression: standard roles | Pass, count = 5 |
| Regression: standard permissions | Pass, count = 12 |
| Regression: `sport_pickleball` | Pass |
| Regression: events config columns | Pass |
| `npm run build` | Pass, Vite chunk-size warning remains |
| `npm run lint` | Pass |
| `npm run typecheck` | Not configured |
| `rg "EVENT_MANAGER" src` | Pass, no results |
| Secret scan | References only; no secret values printed or committed |

## Prompt 05 Remaining Risks

- Frontend still contains direct `supabase.from(...)` write paths for teams, matches, and other business flows; Prompt 06 should RPC-ize those paths.
- `reset_match_score_v1` clears the current match score and soft-deletes match sets, but downstream knockout rollback remains TODO for a later bracket/schedule prompt.
- Runtime TENANT_ADMIN and VIEWER login checks still need controlled auth-linked accounts.
- Build still has the existing Vite chunk-size warning.

## Prompt 06

- Created migration: `supabase/migrations/enterprise_completion_v1/004_team_group_schedule_knockout_rpcs.sql`.
- Ran migration on Supabase beta.
- Added `public.event_knockout_selections` with RLS and active unique indexes.
- Added RPCs:
  - `create_team_v1`
  - `update_team_v1`
  - `archive_team_v1`
  - `import_teams_v1`
  - `setup_groups_v4`
  - `assign_team_to_group_v2`
  - `dissolve_groups_v4`
  - `generate_schedule_v1`
  - `prepare_knockout_candidates_v1`
  - `confirm_knockout_teams_v1`
  - `generate_knockout_bracket_v1`
- Added internal helpers:
  - `p06_require_event_admin_v1`
  - `p06_group_label`
- Did not reset data.
- Did not delete or modify `auth.users`.
- Did not create seed data for 100 tournaments.
- Did not make broad UI changes.

## Prompt 06 Verification

| Check | Result |
|---|---|
| Migration execution | Pass |
| Static SQL markers | Pass, `SECURITY DEFINER`, `SET search_path`, groupCount 1..32, bracket size 4/8/16/32 |
| Admin RPC grant to anon | Pass, no anon execute grant found |
| SQL function existence | Pass, 11/11 required RPCs found |
| SUPER_ADMIN create/import team | Pass |
| EVENT_ADMIN with grant create team/setup groups | Pass |
| EVENT_ADMIN without grant | Pass, blocked |
| REFEREE create team/setup groups | Pass, blocked |
| ANON admin RPC | Pass, blocked |
| VIEWER runtime | Not run; no active auth-linked VIEWER account currently exists |
| 4 teams, groupCount=1 | Pass, 1 group and 6 matches |
| 5 teams, groupCount=1 | Pass, 10 matches and no junk BYE match |
| 16 teams, groupCount=4 | Pass, 4 groups of 4 and 24 group matches |
| groupCount=0 | Pass, blocked |
| groupCount=33 | Pass, blocked |
| Teams fewer than groups | Pass, blocked with clear error |
| Assign team to another group | Pass |
| `teams.group_id` and `groups.team_ids` sync | Pass |
| Assign to cross-event group | Pass, blocked |
| Assign after schedule | Pass, blocked with regenerate-required error |
| Knockout candidates top 2 per group | Pass, 8 candidates |
| Best thirds | Pass, +2 best thirds gives 10 candidates |
| Exclude bottom result comparison | Pass, derived stats only; match results not mutated |
| REFEREE prepare KO candidates | Pass, blocked |
| EVENT_ADMIN with grant prepare KO candidates | Pass |
| EVENT_ADMIN without grant prepare KO candidates | Pass, blocked |
| Confirm 8 teams into bracket size 8 | Pass |
| Confirm 6 teams into bracket size 8 | Pass, `bye_count=2` |
| Duplicate selected team | Pass, blocked |
| Team from another event | Pass, blocked |
| 9 teams into bracket size 8 | Pass, blocked |
| bracket size 12 | Pass, blocked |
| Override reason | Pass, stored and audited |
| Generate bracket size 8 | Pass, 7 matches with QF/SF/F ids and next links |
| Generate bracket with BYE | Pass, 7 matches and BYE placeholders |
| Generate bracket twice | Pass, second call blocked |
| Generate bracket without confirmed teams | Pass, blocked |
| Audit logs | Pass for required Prompt 06 actions |
| `npm run build` | Pass, Vite chunk-size warning remains |
| `npm run lint` | Pass |
| `npm run typecheck` | Not configured |
| `rg "EVENT_MANAGER" src` | Pass, no results |
| Secret scan | References only; no secret values printed or committed |

## Prompt 06 Remaining Risks

- Frontend is not yet wired to call the new RPCs; Prompt 07 should replace direct UI writes with RPC calls.
- Knockout bracket currently creates winner bracket only; bronze/third-place match can be added in a later prompt if required.
- Schedule regeneration is intentionally explicit: active schedules are blocked rather than silently overwritten.
- Runtime VIEWER test still needs an active auth-linked VIEWER account.

## Prompt 07

- Created frontend RPC client: `src/lib/api/tournamentRpc.ts`.
- Created React Query mutation hook: `src/hooks/useTournamentRpcMutations.ts`.
- Updated main team mutations to call:
  - `create_team_v1`
  - `update_team_v1`
  - `archive_team_v1`
  - `import_teams_v1`
- Updated group and schedule mutations to call:
  - `setup_groups_v4`
  - `assign_team_to_group_v2`
  - `dissolve_groups_v4`
  - `generate_schedule_v1`
- Updated score mutations to call:
  - `update_match_score_v1`
  - `update_match_set_score_v1`
  - `reset_match_score_v1`
- Added `useMatchSets` read hook for best-of-3 set display.
- Updated create event modal to collect sport, competition type, format type, scoring mode, group count, and ranking options, then save business config through `update_event_config_v1`.
- Updated group count UI to expose every value from 1 to 32.
- Updated `ScoreEntry` with best-of-3 set score controls that call `update_match_set_score_v1`; winner is not sent by frontend.
- Updated `KnockoutBracket` with RPC flow:
  - prepare candidates
  - confirm teams
  - generate bracket
- Created docs:
  - `docs/cto/FRONTEND_RPC_WIRING.md`
  - `docs/cto/UI_MANUAL_TESTS.md`
- Did not create migrations.
- Did not reset database.
- Did not delete or modify `auth.users`.
- Did not create 100 tournament seed data.

## Prompt 07 Verification

| Check | Result |
|---|---|
| `npm run build` | Pass, existing Vite chunk-size warning remains |
| `npm run lint` | Pass |
| `npm run typecheck` | Not configured |
| `rg "EVENT_MANAGER" src` | Pass, no results |
| RPC usage scan | Pass, all required RPC names found in `src` |
| `match_sets` direct write scan | Pass, no results |
| `event_knockout_selections` direct write scan | Pass, no results |
| Secret scan | References only; no secret values printed or committed |

## Prompt 07 Direct Write Scan

Main Prompt 07 flows were replaced with RPC calls. Remaining direct writes:

| File | Lines | Reason |
|---|---:|---|
| `src/store.ts` | 537, 539, 541 | Legacy event-delete path soft-deletes matches/teams/groups. Needs a future event archive/delete RPC. |
| `src/components/Dashboard.tsx` | 579-585 | Legacy JSON import/replace deletes matches not present in import payload. Needs future bulk import RPC. |
| `src/components/Dashboard.tsx` | 600-606 | Legacy JSON import/replace deletes teams not present in import payload. Needs future bulk import RPC. |
| `src/components/Dashboard.tsx` | 621-627 | Legacy JSON import/replace deletes groups not present in import payload. Needs future bulk import RPC. |

## Prompt 07 UI Wiring Summary

| UI area | Status |
|---|---|
| Event config | Wired to `update_event_config_v1` after event creation |
| Team management | Wired to team RPCs |
| Group management | Wired to group RPCs |
| Schedule generation | Wired to `generate_schedule_v1` |
| Single-set scoring | Wired to `update_match_score_v1` |
| Best-of-3 scoring | Wired in `ScoreEntry` through `update_match_set_score_v1` |
| Score reset | Wired to `reset_match_score_v1` |
| Knockout selection | Wired to prepare/confirm/generate knockout RPCs |

## Prompt 07 Remaining Risks

- No `create_event_v1` RPC exists yet, so initial event row creation remains on the existing path; event config is RPC-wired immediately after creation.
- Legacy JSON import/replace and event-delete direct writes remain documented and should be RPC-ized in a later prompt.
- Browser/manual flow tests are documented but not executed against live test data in Prompt 07.
- `SchedulerAndScoreKeeper` is still optimized for compact aggregate score entry; best-of-3 set-by-set entry is implemented in `ScoreEntry`.

## Prompt 07 Supplemental: Set-by-Set Score Entry

- Updated score entry UI so operators enter real set scores, not aggregate match results.
- Files updated:
  - `src/components/ScoreEntry.tsx`
  - `src/components/SchedulerAndScoreKeeper.tsx`
  - `docs/cto/FRONTEND_RPC_WIRING.md`
  - `docs/cto/UI_MANUAL_TESTS.md`
  - `docs/cto/IMPLEMENTATION_REPORT.md`
  - `docs/cto/TEST_MATRIX.md`

### Supplemental Behavior

| Requirement | Result |
|---|---|
| Single set input | Pass, UI accepts real points such as `11-4` and calls `update_match_score_v1` |
| No aggregate `1-0` input | Pass, aggregate result is display-only after RPC/refetch |
| Best-of-3 rows | Pass, UI renders Séc 1, Séc 2, Séc 3 |
| Set save RPC | Pass, each row saves with `update_match_set_score_v1` |
| Winner calculation | Pass, frontend does not submit `winner_id` |
| Finished match lock | Pass, finished match inputs lock and require reset before edit |
| 2-0 set 3 lock | Pass, set 3 locks when match is finished 2-0 |
| Reset | Pass, reset calls `reset_match_score_v1` and clears local inputs |

### Supplemental Static Checks

| Check | Result |
|---|---|
| `rg "1-0|2-1" src/components src/hooks` | Pass, no input/label matches |
| direct `match_sets` write scan | Pass, no direct insert/update/delete |
| score/winner/status direct `matches.update` scan for scoring flow | Pass, no scoring flow direct update found |
| `npm run build` | Pass, existing Vite chunk-size warning remains |
| `npm run lint` | Pass |

### Supplemental Remaining Risks

- Manual UI tests with live browser data are documented but not executed in this turn.
- Export/live display components may still show aggregate `matches.scoreA-scoreB`; this is expected display data, not score input.

## Prompt 07 Supplemental: Real Event ID For Team Import

- Fixed the frontend event-id resolution that could send a tournament id, legacy placeholder id, or stale `current_event_id` into event-scoped RPCs.
- Root cause: `setCurrentEvent` only accepted ids that existed in the legacy local `events` object. Real rows from `public.events` such as `evt_xxx` could be displayed by the event switcher but rejected by the store, leaving `currentEventId` on a placeholder/tournament-level value.
- Before the fix, team import could call `import_teams_v1` with the wrong `p_event_id`, producing `Event not found`.
- After the fix, `selectedEventId` is resolved from the actual `public.events` query result. If the current id is missing or a placeholder, the first real event row is selected. Newly created events are selected immediately after creation.

### Files Updated For Event ID Resolution

- `src/store.ts`
- `src/hooks/useEvents.ts`
- `src/components/use-events-query.ts`
- `src/hooks/useTeams.ts`
- `src/hooks/useGroups.ts`
- `src/hooks/useMatches.ts`
- `src/hooks/useMatchSets.ts`
- `src/hooks/useDataMutations.ts`
- `src/hooks/useTournamentRpcMutations.ts`
- `src/components/TeamManager.tsx`
- `src/components/KnockoutBracket.tsx`
- `src/components/create-event-modal.tsx`

### Event ID Flow After Fix

| Flow | Event id source |
|---|---|
| Event switcher | Real `public.events.id` row |
| Team create/import | `selectedEventId` resolved from `public.events`, then passed to `create_team_v1` / `import_teams_v1` |
| Group setup/dissolve | `selectedEventId` resolved from `public.events` |
| Schedule generation | `selectedEventId` resolved from `public.events` |
| Match/match set reads | Query filters use `selectedEventId` |
| Knockout prepare/confirm/generate | `selectedEventId` resolved from `public.events` |
| Create event | New event id is selected after successful create/config save |

### Verification

| Check | Result |
|---|---|
| `rg "11111111-1111-1111-1111-111111111111" src` | Pass, no results |
| Wrong explicit RPC event-id scan | Pass, no direct `currentEventId` handoff found for import/team/group/schedule/KO RPC paths |
| `npm run build` | Pass, existing Vite chunk-size warning remains |
| `npm run lint` | Pass |

### Remaining Manual Verification

- Browser network verification for tournament `Thắng Oanh`, event `Đôi Nam`, and event `Đôi Nữ` still needs to be run against the user's active Supabase data.
- Expected network result: `import_teams_v1` sends `p_event_id` equal to the selected event row id, not a tournament id and not the legacy placeholder.

## Prompt 07 Supplemental: Workspace Route And Event Scope Fix

- Fixed the route/store conflict where the legacy tenant hash URL could overwrite routed workspace URLs such as `/admin/workspace/thang-oanh`.
- `AdminWorkspace` and public tournament routes now resolve route slug/id through the `tournament` table before loading the workspace context.
- Root entry now upgrades legacy `#/workspace-id` URLs to routed workspace URLs when a matching tournament slug exists.
- Store hash navigation is skipped when the user is already on a routed workspace/tournament page.
- Event queries now filter by the active tournament id in addition to tenant id, preventing event/team/group/match data from different tournaments in the same tenant from bleeding into the current workspace.
- `CreateEventModal` now creates an event/content row with `tournament_id` and is labeled as “Tạo nội dung thi đấu”, not “Tạo giải đấu”.
- `EventBar` now reads real event/content rows from `public.events` via React Query, so tabs such as `Đôi Nam` and `Đôi Nữ` are displayed from database state instead of legacy local store state.

### Verification

| Check | Result |
|---|---|
| `npm run build` | Pass, existing Vite chunk-size warning remains |
| `npm run lint` | Pass |
| UI label scan for old Event Center wording | Pass, no old create-event wording remains in changed files |

### Remaining Manual Verification

- Reopen a workspace through `/admin/workspace/<slug>` and confirm the browser URL remains the workspace slug, not the legacy `#/11111111-...` hash.
- In workspace `Thắng Oanh`, create/select `Đôi Nam` and `Đôi Nữ`; confirm EventBar/EventSwitcher show these competition contents and team lists stay separated.

## Prompt 07-C/D/E/F: Context, Tenant, Tournament, Menu Hardening

- Created SQL migrations:
  - `supabase/migrations/enterprise_completion_v1/005_context_scope_hardening.sql`
  - `supabase/migrations/enterprise_completion_v1/006_tenant_management_rpcs.sql`
  - `supabase/migrations/enterprise_completion_v1/007_tournament_management_rpcs.sql`
- Migration run status: not run in this turn. Database data was not reset and `auth.users` was not modified.
- Added `get_workspace_context_v1(p_slug text)` contract to resolve a route slug into real tenant/tournament context.
- Added tenant management RPC contracts: `list_tenants_v1`, `create_tenant_v1`, `update_tenant_v1`, `archive_tenant_v1`, `restore_tenant_v1`.
- Added tournament management RPC contracts: `list_tournaments_v1`, `create_tournament_v1`, `update_tournament_v1`, `archive_tournament_v1`, `restore_tournament_v1`.
- Frontend store now tracks `activeTenantId`, `activeTenantName`, `activeTournamentId`, and hydrates routed workspaces from `/admin/workspace/<slug>`.
- Event/team/group/match queries use the active tournament id so data from another tournament in the same tenant is not mixed into the current workspace.
- Added SUPER_ADMIN-only `Quản lý đơn vị` page backed by tenant RPCs.
- Rewired `Quản lý giải đấu` list/create/update/archive/restore flows to tournament RPCs.
- Renamed navigation:
  - `Trang chủ` -> `Tổng quan giải`
  - `Enterprise Workspaces` -> `Quản lý giải đấu`
  - `Event Center` -> `Nội dung thi đấu`
  - `Tuyển chọn vòng trong` -> `Xếp hạng & Vào vòng trong`
  - `Sơ đồ trực tiếp` -> `Sơ đồ Knockout`
- Header now shows `Đơn vị / Giải / Nội dung thi đấu`.

### Prompt 07-C/D/E/F Verification

| Check | Result |
|---|---|
| `npm.cmd run build` | Pass, existing Vite chunk-size warning remains |
| `npm.cmd run lint` | Pass |
| `rg "11111111-1111-1111-1111-111111111111" src` | Pass, no results |
| Menu wording scan for old labels | Pass, no old menu labels in `src` |
| Legacy workspace RPC scan | Pass, no v6 workspace RPC usage in active `src` hooks |

### Remaining Risks

- The new SQL migrations need to be applied before the new tenant/tournament RPC UI can work against Supabase.
- Manual browser verification is still required on the user's live data for `Thắng Oanh`, including URL `/admin/workspace/<slug>`, visible event contents, and separated team counts per event.

## Migration 005-006-007 Apply Attempt

Status: blocked before apply.

Static safety review:

- `005_context_scope_hardening.sql`, `006_tenant_management_rpcs.sql`, and `007_tournament_management_rpcs.sql` were scanned for `TRUNCATE`, `DELETE FROM`, `DROP TABLE`, and `auth.users`.
- No destructive data reset commands were found.
- No `auth.users` mutation was found.

Preflight result:

| Check | Result |
|---|---|
| `auth.users` count before apply | 8 |
| Active SUPER_ADMIN accounts | 1 |
| orphan `events.tournament_id` | 0 |
| orphan `teams.event_id` | 10 |
| orphan `groups.event_id` | 0 |
| orphan `matches.event_id` | 0 |
| orphan `match_sets.event_id` | 0 |
| duplicate active `(tenant_id, slug)` tournaments | 0 |
| duplicate tenant slugs | 0 |

Blocking orphan detail:

- `teams.event_id = 11111111-1111-1111-1111-111111111111__event-7im6lk9`
- Orphan teams: `t1`, `t2`, `t3`, `t4`, `t5`, `t6`, `t7`, `t8`, `t9`, `t10`
- All 10 rows currently have `tournament_id = 11111111-1111-1111-1111-111111111111`.

Decision:

- Migrations 005, 006, and 007 were not run.
- No data was reset.
- `auth.users` was not modified.
- Browser/RPC post-apply tests were not run because apply was correctly blocked by preflight.

Next safe action:

- Decide how to handle the 10 orphan demo teams before applying 005. Options should be explicit: reconnect them to a valid event, archive/soft-delete them if they are demo-only, or recreate the missing event row if that is the intended event.

## Business Test Data Reset And Migration 005-006-007 Apply

The user confirmed current Supabase business data is test-only and can be reset.

### Reset Result

- Reset used `DELETE` statements in dependency order.
- No `TRUNCATE CASCADE`.
- No `DROP TABLE`.
- No `auth.users` mutation.
- Protected tables preserved: `auth.users`, `accounts`, `roles`, `permissions`, `role_permissions`, `sports`.

Business tables reset to zero rows:

- `match_sets`
- `matches`
- `event_knockout_selections`
- `groups`
- `teams`
- `account_event_permissions`
- `events`
- `tournament`
- `tenant_subscriptions`
- `invoices`
- `payments`
- `audit_logs`

### Safety Counts

| Check | Before | After |
|---|---:|---:|
| `auth.users` | 8 | 8 |
| active SUPER_ADMIN | 1 | 1 |
| `accounts` | 5 | 5 |
| `roles` | 5 | 5 |
| `permissions` | 12 | 12 |
| `role_permissions` | 20 | 20 |
| `sports` | 1 | 1 |

### Post-Reset Preflight

All orphan and duplicate checks returned 0 after reset.

### Migration Apply

| Migration | Status |
|---|---|
| `005_context_scope_hardening.sql` | Applied |
| `006_tenant_management_rpcs.sql` | Applied |
| `007_tournament_management_rpcs.sql` | Applied |

During post-check, `anon_execute` was initially true on tenant/tournament admin RPCs. Migrations 006 and 007 were patched to explicitly revoke from `anon` and re-applied.

### RPC Verification

All expected RPCs exist. `authenticated_execute=true` and `anon_execute=false` for:

- `get_workspace_context_v1`
- `list_tenants_v1`
- `create_tenant_v1`
- `update_tenant_v1`
- `archive_tenant_v1`
- `restore_tenant_v1`
- `list_tournaments_v1`
- `create_tournament_v1`
- `update_tournament_v1`
- `archive_tournament_v1`
- `restore_tournament_v1`

### Build And Lint

- `npm.cmd run build`: Pass, existing chunk-size warning remains.
- `npm.cmd run lint`: Pass.

### Remaining Notes

- Manual browser test for `/PIC_HUU/admin/workspace/thang-oanh` was not run as pass/fail because the reset removed all tournaments, including `Thắng Oanh`.
- Since `tenant_subscriptions` is now empty, creating tournament/event may hit `PLAN_LIMIT_EXCEEDED` if quota triggers require a subscription. A later prompt should create a safe demo subscription for the test tenant if needed.

## Prompt 07-BASE: Clean SaaS Demo Foundation

- Created/reused demo tenant `CLB Thắng Oanh` with slug `clb-thang-oanh`.
- Created an active demo subscription for that tenant using the existing `Enterprise` plan.
- Created/reused tournament `Giải Pickleball Thắng Oanh 2026` with slug `thang-oanh`.
- Did not create events, teams, groups, matches, or match_sets.
- Did not reset database.
- Did not modify `auth.users`, accounts, roles, permissions, role_permissions, or sports.

Creation paths:

- Tenant: `create_tenant_v1` when missing.
- Tournament: `create_tournament_v1` when missing.
- Subscription: direct insert into `tenant_subscriptions` because no billing RPC exists yet; scoped only to the demo tenant.

Verification:

| Check | Result |
|---|---|
| `list_tenants_v1` includes `CLB Thắng Oanh` | Pass |
| `list_tournaments_v1` includes `thang-oanh` | Pass |
| `get_workspace_context_v1('thang-oanh')` | Pass |
| `auth.users` count | 8 |
| active SUPER_ADMIN count | 1 |
| `events` count | 0 |
| `teams` count | 0 |
| `npm.cmd run build` | Pass |
| `npm.cmd run lint` | Pass |

Manual browser test was not executed because a browser-control tool was not available in the active toolset. The expected UI state is documented in `DEMO_BASE_REPORT.md` and `UI_MANUAL_TESTS.md`.

Prompt 07-BASE is ready for Prompt 07-G.

## Prompt 07-G: Event Management RPCs And Demo Events

- Created and applied `supabase/migrations/enterprise_completion_v1/008_event_management_rpcs.sql`.
- Added RPCs:
  - `list_events_by_tournament_v1`
  - `create_event_v1`
  - `update_event_v1`
  - `archive_event_v1`
  - `restore_event_v1`
- Verified all 5 RPCs exist, `authenticated` can execute, and `anon` cannot execute.
- Wired frontend event list/create/archive/restore flows to RPCs.
- `CreateEventModal` now calls `create_event_v1`; it no longer inserts directly into `events`.
- `EventCard` now archives/restores through RPC.
- `useEvents` and `useEventsQuery` now read via `list_events_by_tournament_v1(activeTournamentId)`.
- Created 3 demo events in tournament `thang-oanh`:
  - `Đôi Nam`
  - `Đôi Nữ`
  - `Đôi Nam Nữ`
- All demo events have the same `tournament_id = tournament-ee121f28-e882-466b-acfc-866179df715a`.
- `teams`, `groups`, and `matches` remain 0.
- `auth.users` remains 8 and active SUPER_ADMIN remains 1.

Build and lint:

- `npm.cmd run build`: Pass.
- `npm.cmd run lint`: Pass.

Static direct-write note:

- No direct `events` insert/update/delete remains in the active "Nội dung thi đấu" management flow.
- Legacy direct `events.delete` remains in `Dashboard` import/replace paths and is documented as outside Prompt 07-G scope.

Manual browser test was not executed because no browser-control tool was available in the active toolset.

Prompt 07-G is ready for Prompt 07-H.

## Prompt 07-H: Event-Scoped Referee Access

- Created and applied `supabase/migrations/enterprise_completion_v1/009_event_access_referee_rpcs.sql`.
- Did not create a `referees` table.
- Used existing `accounts`, `roles`, and `account_event_permissions`.
- Added compatible `tenant_id` and `permission` columns to `account_event_permissions` when missing.
- Created/standardized RPCs:
  - `list_event_access_v1(p_event_id text)`
  - `grant_event_access_v1(p_event_id text, p_account_id text, p_permission text)`
  - `revoke_event_access_v1(p_event_id text, p_account_id text, p_permission text)`
- Verified the new RPC signatures exist, `authenticated` can execute, and `anon` cannot execute.
- Wired the event card "Cấp quyền trọng tài" modal to the RPCs.
- Removed direct insert/delete writes to `account_event_permissions` from `EventMembersManager`.
- The modal now uses a local `selectedRefereeAccountId`; no global `refereeId` context was added.
- No active `REFEREE` account exists in demo tenant `CLB Thắng Oanh`, so no demo grant was created and no `auth.users` record was created.
- Existing REFEREE account `tt` belongs to another tenant and was not granted cross-tenant access.
- `auth.users` remains 8 and active SUPER_ADMIN remains 1.

Build and lint:

- `npm.cmd run build`: Pass.
- `npm.cmd run lint`: Pass.

Remaining notes:

- Manual browser verification for opening the modal and testing a real REFEREE login is pending because the demo tenant has no active REFEREE account.
- `src/components/TournamentCard.tsx` still reads a legacy `account_event_permissions` shape for display only; it does not write event access.

## Prompt 07-I: Business RPC Context Validation

- Created and applied `supabase/migrations/enterprise_completion_v1/010_business_rpc_context_validation.sql`.
- Added validation helpers:
  - `p10_validate_event_context_v1`
  - `p10_require_event_admin_v1`
  - `p10_require_match_score_context_v1`
  - `p10_has_event_permission_v1`
- Updated `p06_require_event_admin_v1` to delegate to Prompt 07-I validation, covering Prompt 06 team/group/schedule/knockout RPCs without changing their public signatures.
- Wrapped scoring RPCs so match context is validated before core scoring logic runs:
  - `update_match_score_v1`
  - `update_match_set_score_v1`
  - `reset_match_score_v1`
- Internal scoring core/helper functions are no longer executable by `anon` or `authenticated`.
- Public scoring wrappers remain executable by `authenticated`; `anon` remains blocked.
- Standardized context errors observed in tests:
  - empty event id: `INVALID_EVENT_ID`
  - tournament id used as event id: `INVALID_CONTEXT`
  - tenant id used as event id: `INVALID_CONTEXT`
  - missing match id: `MATCH_NOT_FOUND`
- Frontend guards added in:
  - `src/hooks/useEvents.ts`
  - `src/hooks/useDataMutations.ts`
  - `src/hooks/useTournamentRpcMutations.ts`
  - `src/lib/api/tournamentRpc.ts`
- UI mutation guards now require tenant, tournament, and event context before team/group/schedule/score/knockout operations.
- `isUsableEventId` now requires ids to start with `evt_`.
- `auth.users` remains 8 and active SUPER_ADMIN remains 1.

Build and lint:

- `npm.cmd run build`: Pass.
- `npm.cmd run lint`: Pass.

Remaining notes:

- No active REFEREE account exists in the demo tenant, so REFEREE E2E remains pending.
- Prompt 07-I did not run Prompt 07-J or Prompt 08.

## GitHub Test Preview Push

- Target branch: `enterprise-completion-v1`.
- Purpose: preview build for user online testing; this is not a stable release.
- Included scope: tenant/tournament/event context, tenant management, tournament management, event management RPCs, and referee event-access modal.
- Demo tenant: `CLB Thắng Oanh`.
- Demo tournament slug: `thang-oanh`.
- Demo events: `Đôi Nam`, `Đôi Nữ`, `Đôi Nam Nữ`.
- Manual browser tests remain pending.
- REFEREE E2E remains blocked until the demo tenant has an active REFEREE account.

Pre-push verification:

- `npm.cmd run build`: Pass, existing Vite chunk-size warning remains.
- `npm.cmd run lint`: Pass.
- `rg "EVENT_MANAGER" src`: Pass, no results.
- `rg "11111111-1111-1111-1111-111111111111" src`: Pass, no results.
- `rg "SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|JWT_SECRET|refresh_token|service_role" .`: variable/documentation references only; no secret values found.
- `.env.db.local`, `dist/`, and `node_modules/` are ignored and were not staged.
- No database reset was performed.
- Prompt 08 was not run.

## Prompt 07-J: Demo E2E Data And Flow Verification

- Created complete demo E2E data for tournament `thang-oanh` in tenant `CLB Thắng Oanh`.
- Did not reset the database globally.
- Did not delete or modify `auth.users`.
- Did not modify accounts, roles, permissions, or sports.
- Did not run Prompt 08.
- Demo cleanup was scoped to the three demo events under tournament `thang-oanh`.
- Team/group/schedule/score/knockout creation used the required RPCs:
  - `import_teams_v1`
  - `setup_groups_v4`
  - `generate_schedule_v1`
  - `update_match_score_v1`
  - `prepare_knockout_candidates_v1`
  - `confirm_knockout_teams_v1`
  - `generate_knockout_bracket_v1`
- Locked direct-write tables were respected; old match score cleanup uses `reset_match_score_v1`.

Verification:

| Check | Result |
|---|---|
| Đôi Nam teams/groups/group matches | Pass, 16 teams, 4 groups, 24 group matches |
| Đôi Nam scores | Pass, all 24 group matches finished |
| Đôi Nam knockout | Pass, 8 confirmed teams and 7 knockout matches |
| Đôi Nữ teams/groups/group matches | Pass, 8 teams, 2 groups, 12 group matches |
| Đôi Nữ partial scores | Pass, 4 finished group matches |
| Đôi Nam Nữ teams/groups/group matches | Pass, 8 teams, 2 groups, 12 group matches |
| Event isolation | Pass, no Đôi Nam/Đôi Nữ team mixing and no cross-event match/team mismatch |
| Event id shape | Pass, all selected demo event ids begin with `evt_` |
| Tournament id as event id | Pass, blocked with `INVALID_CONTEXT` |
| Tenant id as event id | Pass, blocked with `INVALID_CONTEXT` |
| REFEREE demo account | Blocked by data, 0 active REFEREE accounts in demo tenant |
| Cross-tenant REFEREE grant | Pass, 0 grants |

Files:

- `tests/enterprise/seed_demo_e2e_07j.sql`
- `tests/enterprise/verify_demo_e2e_07j.sql`
- `docs/cto/DEMO_E2E_07J_REPORT.md`
