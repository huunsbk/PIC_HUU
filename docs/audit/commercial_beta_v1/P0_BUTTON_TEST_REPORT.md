# Commercial Beta V1 P0 Button Test Report

Date: 2026-06-17

Target app: https://huunsbk.github.io/PIC_HUU/

Scope: P0 button/action smoke audit only. No credentials were provided, so authenticated browser actions were not executed. Source-level audit was performed for authenticated actions. No real destructive action was run.

## Summary

- P0 actions audited: 21
- Static deploy smoke: PASS, HTTP 200
- Browser automation: BLOCKED by local environment; no authenticated UI flow was executed
- PASS count: 9
- FAIL count: 0
- FIXED_BY_CODE_CHANGE count: 5
- BLOCKED count: 2
- MANUAL_REQUIRED count: 5
- Build result: PASS (`npm run build:pages`)
- Lint result: PASS (`npm run lint --if-present`)
- SQL write commands run: none
- Supabase commands run: none
- Secrets printed: none by Codex
- Real destructive actions run: none

## P0 Findings

1. FIXED_BY_CODE_CHANGE: Login source logged full Supabase session object to browser console.
   - File/function: `src/components/AuthModal.tsx`, `handleLogin`
   - Evidence: `console.log('SESSION', sessionData.session);`
   - Risk: exposes access token/session metadata in browser console after login.

2. FIXED_BY_CODE_CHANGE: Auto-group button called React Query mutation object as a function.
   - File/function: `src/components/GroupManager.tsx`, `handleAutoGroup`
   - Evidence: `autoGroupTeams(method, numGroups);`
   - Expected usage: `autoGroupTeams.mutateAsync(...)` or `autoGroupTeams.mutate(...)`.

3. FIXED_BY_CODE_CHANGE: Drag/drop and quick group assignment called React Query mutation object as a function with wrong argument shape.
   - File/function: `src/components/GroupManager.tsx`, `handleDrop`, quick assignment selects
   - Evidence: `moveTeamToGroup(team.id, targetGroupId);`
   - Hook expects object payload for `mutationFn`.

4. FIXED_BY_CODE_CHANGE: Schedule regeneration inserted generated match objects in camelCase instead of DB snake_case.
   - File/function: `src/hooks/useDataMutations.ts`, `generateForGroup`, `generateAllSchedules`
   - Evidence: generated matches contain `groupId`, `teamAId`, `scoreA`, etc., then are spread into `supabase.from('matches').insert(dbMatches)`.
   - Expected DB payload fields include `group_id`, `team_a_id`, `score_a`, etc.

5. FIXED_BY_CODE_CHANGE: Create/auto group buttons called missing Staging RPC `setup_groups_v1`.
   - File/function: `src/hooks/useDataMutations.ts`, `setupGroups`, `autoGroupTeams`
   - Evidence: deployed console showed `POST /rest/v1/rpc/setup_groups_v1 404`.
   - Fix: frontend now archives old groups, resets team assignments, clears group-stage matches, inserts `groups` rows, and then assigns teams.

## Test Matrix

| # | Status | Menu | Button/Action | Expected result | Actual result | Source file/function | Data table/RPC | Network error | Console error | Suspected root cause | Fix priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | FIXED_BY_CODE_CHANGE | Auth | Login | User signs in, profile loads, redirects with `/PIC_HUU/` base path | Removed session/user/profile object logging and removed missing `record_login_session` RPC call; browser login not executed due no demo credentials | `src/components/AuthModal.tsx` `handleLogin`; `src/store.ts` `setAuthStatus` | `auth.signInWithPassword`, `get_current_profile` | none in source; browser auth not run | Not runtime-tested | Debug logging and missing login-session RPC removed from login path | P0 |
| 2 | PASS | Auth | Logout | Clears auth, signs out, reloads as guest | Source audit passes; runtime manual test still recommended | `src/store.ts` `logout`; `src/App.tsx` logout button | `auth.signOut` | none | none found | Auth state clears before signOut and reload | P1 |
| 3 | PASS | Auth | Refresh after logout | Refresh remains logged out | Source audit passes; persisted auth fields excluded from Zustand storage | `src/store.ts` `logout`, `partialize` | `auth.signOut` | none | none found | State and auth session cleared | P1 |
| 4 | MANUAL_REQUIRED | Auth | Browser Back after logout | Back should not restore admin session | Not executed; needs real browser login/logout flow | `src/store.ts` `logout`; `src/App.tsx` auth guard | `auth.signOut` | none | not captured | Needs browser history validation after real logout | P1 |
| 5 | PASS | Trang chủ | Cập nhật thông tin giải | Updates only existing tournament columns | Source audit passes; sends `name`, `organization`, `location`, `date`, `settings`, `current_event_id` only | `src/components/Dashboard.tsx` `handleSaveInfo`; `src/store.ts` `updateTournament` | `tournament.update` | none | none found | Column allowlist matches current schema | P0 |
| 6 | PASS | Trang chủ | Cập nhật quy chế | Updates tournament settings | Source audit passes; updates `settings` only | `src/components/Dashboard.tsx` `handleSaveSettings`; `src/store.ts` `updateSettings` | `tournament.update` | none | none found | Column allowlist matches current schema | P0 |
| 7 | PASS | Quản lý đội | Thêm đội | Inserts team with required fields and refreshes list | Source audit passes | `src/components/TeamManager.tsx` `handleCreateTeam`; `src/hooks/useDataMutations.ts` `addTeam` | `teams.insert` | none | none found | Payload includes `id`, `name`, `event_id`, `tenant_id`, `tournament_id` | P0 |
| 8 | PASS | Quản lý đội | Nhập danh sách dán vào | Parses pasted spreadsheet rows and inserts teams | Source audit passes | `src/components/TeamManager.tsx` `handleImportFromExcelText`; `src/hooks/useDataMutations.ts` `importTeams` | `teams.insert` | none | none found | Parser handles tab/comma/semicolon and STT column | P0 |
| 9 | PASS | Quản lý đội | Nhập CSV | Reads CSV/TXT and inserts teams | Source audit passes | `src/components/TeamManager.tsx` `handleFileUpload`; `src/hooks/useDataMutations.ts` `importTeams` | `teams.insert` | none | none found | Same parser as paste path | P0 |
| 10 | MANUAL_REQUIRED | Quản lý đội | Sửa đội `SMOKE_TEST_` | Updates only test team name/seed | Not executed; no demo credentials/SMOKE_TEST data available | `src/components/TeamManager.tsx` `handleSaveEdit`; `src/hooks/useDataMutations.ts` `updateTeam` | `teams.update` | none | not captured | Needs safe test team row | P0 |
| 11 | MANUAL_REQUIRED | Quản lý đội | Xóa đội `SMOKE_TEST_` only | Soft deletes only test team | Not executed to avoid real data deletion | `src/components/TeamManager.tsx` `handleDeleteConfirm`; `src/hooks/useDataMutations.ts` `deleteTeam` | `teams.update deleted_at` | none | not captured | Needs disposable SMOKE_TEST row | P0 |
| 12 | FIXED_BY_CODE_CHANGE | Chia bảng | Tạo bảng test | Creates empty groups for current event | Replaced missing `setup_groups_v1` RPC with direct `groups.insert` payload and local cleanup; not runtime-tested | `src/components/GroupManager.tsx` `handleCreateGroupsEmpty`; `src/hooks/useDataMutations.ts` `setupGroups` | `groups.update`, `teams.update`, `matches.delete`, `groups.insert` | `setup_groups_v1` 404 fixed in source | Not runtime-tested | Missing RPC replaced with direct table operations | P0 |
| 13 | FIXED_BY_CODE_CHANGE | Chia bảng | Chia tự động with `SMOKE_TEST_` data only | Assigns teams to groups | Updated to use `autoGroupTeams.mutateAsync({ method, numGroups })`; not runtime-tested | `src/components/GroupManager.tsx` `handleAutoGroup`; `src/hooks/useDataMutations.ts` `autoGroupTeams` | `teams.update` | none | Not runtime-tested | Mutation object call fixed | P0 |
| 14 | FIXED_BY_CODE_CHANGE | Chia bảng | Kéo thả/gán đội test | Moves team to selected group | Updated drag/drop and quick selects to use `moveTeamToGroup.mutate({ teamId, toGroupId })`; not runtime-tested | `src/components/GroupManager.tsx` `handleDrop`, quick select handlers; `src/hooks/useDataMutations.ts` `moveTeamToGroup` | `teams.update` | none | Not runtime-tested | Mutation object call and payload shape fixed | P0 |
| 15 | MANUAL_REQUIRED | Nhập điểm | Bắt đầu trận test if safe | Sets match status to `playing` | Not executed; needs SMOKE_TEST match | `src/components/ScoreEntry.tsx` `handleSetPlaying`; `src/hooks/useDataMutations.ts` `updateMatchStatus` | `matches.update` | none | not captured | Needs safe test match | P0 |
| 16 | MANUAL_REQUIRED | Nhập điểm | Lưu điểm test if safe | Saves score and winner | Not executed; needs SMOKE_TEST match | `src/components/ScoreEntry.tsx` `saveScore`; `src/hooks/useDataMutations.ts` `updateMatchScore` | `update_match_score_v1` | none | not captured | Needs safe test match and RPC validation | P0 |
| 17 | PASS | Nhập điểm | Hủy nhập | Sets match status back to `pending` | Source audit passes | `src/components/ScoreEntry.tsx` `handleCancelPlaying`; `src/hooks/useDataMutations.ts` `updateMatchStatus` | `matches.update` | none | none found | Uses `updateMatchStatus.mutateAsync` correctly | P0 |
| 18 | FIXED_BY_CODE_CHANGE | Lịch & Kết quả | Tạo lại lịch only if SMOKE_TEST event | Deletes/recreates group schedule | Generated matches are mapped to DB snake_case insert payload; not runtime-tested | `src/components/SchedulerAndScoreKeeper.tsx` `handleRegenSubmit`; `src/hooks/useDataMutations.ts` `generateForGroup`, `generateAllSchedules` | `matches.delete`, `matches.insert` | none | Not runtime-tested | CamelCase insert payload fixed | P0 |
| 19 | PASS | Lịch & Kết quả | Reset điểm only if SMOKE_TEST event | Clears scores for group matches | Source audit passes; not executed | `src/components/SchedulerAndScoreKeeper.tsx` `handleResetScoresSubmit`; `src/hooks/useDataMutations.ts` `resetMatchScore` | `matches.update` | none | none found | Uses update payload with real DB columns | P0 |
| 20 | BLOCKED | Enterprise Workspaces / Event Center | Open/read actions only | Open pages and read data without archive/delete/transfer | Authenticated browser not available; no destructive action run | `src/components/TournamentWorkspaceListPage.tsx`, `src/components/event-management-page.tsx`, cards/dialogs | `get_tournament_workspace_dashboard_v6`, event reads | Browser automation unavailable; HTTP app root returned 200 | not captured | Requires authenticated UI session for meaningful read-only validation | P1 |
| 21 | BLOCKED | Dashboard JSON restore | Inspect only; do not restore real data | Inspect restore UI; no restore execution | Source inspected; restore not run | `src/components/Dashboard.tsx` `handleImportJson` | Multi-table delete/upsert | none | not captured | Highly destructive path; requires disposable SMOKE_TEST backup only | P0 |

## Missing-Column Query Audit

No obvious missing-column frontend query bug was found in current `main` for the P0 areas audited.

Previously risky frontend selects now match the known staging schema:

- `src/hooks/useGroups.ts` selects `id, name, team_ids`
- `src/hooks/useMatches.ts` selects `id, group_id, team_a_id, team_b_id, placeholder_a, placeholder_b, score_a, score_b, winner_id, status, round, knockout_round_name, knockout_match_id, next_match_id, next_match_slot`
- `src/hooks/useTeams.ts` selects `id, name, group_id, seed`

## Manual Test Requirements

Manual browser testing still requires a dedicated demo account and disposable SMOKE_TEST event/team/match data. Do not run archive, transfer, delete, reset, or JSON restore against real production data.

Recommended first manual tests after fixing P0 source failures:

1. Login without leaking session data in console.
2. Logout, refresh after logout, browser Back after logout.
3. Create `SMOKE_TEST_` teams through single add, paste import, and CSV import.
4. Create SMOKE_TEST groups, auto-group, and manually assign teams.
5. Generate SMOKE_TEST schedule, start match, save score, cancel/reset score.
