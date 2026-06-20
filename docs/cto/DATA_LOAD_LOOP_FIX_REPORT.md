# Data Load Loop Fix Report

Status: hotfix implemented; authenticated browser verification blocked by missing SUPER_ADMIN test session and Vercel Authentication.

Date: 2026-06-20

## Root Cause

The route `/admin/workspace/thang-oanh` correctly loaded the workspace context, but the legacy Zustand loader still ran after login and realtime updates.

The bad chain was:

1. `AdminWorkspace` called `setWorkspaceContext(...)`.
2. `setWorkspaceContext(...)` called `initSupabase()`.
3. `initSupabase()` restored the signed-in profile and overwrote `activeTenantId` with the account tenant from `get_current_profile`.
4. For the observed SUPER_ADMIN session this restored tenant was the legacy/system tenant `11111111-1111-1111-1111-111111111111`.
5. `initSupabase()` then loaded legacy tournament data by tenant-style id instead of the routed tournament context.
6. Realtime table subscriptions called `initSupabase()` again for teams/groups/events/tournament changes, creating repeated reloads.

This made the UI header look correct from route context, while the dashboard/team/group/match data was read from the wrong legacy context and showed `0/0`.

## Files With Legacy Behavior

| File | Legacy behavior |
|---|---|
| `src/store.ts` | `setWorkspaceContext` called `initSupabase`; `initSupabase` overwrote route context during profile restore. |
| `src/App.tsx` | Realtime `triggerFullSync` called `initSupabase()` even while inside route-based workspace pages. |
| `src/hooks/useEvents.ts` | Event query key included tenant context. |
| `src/components/use-events-query.ts` | Event query key included tenant context. |
| `src/hooks/useTeams.ts` | Team query key included tenant context. |
| `src/hooks/useGroups.ts` | Group query key included tenant context. |
| `src/hooks/useMatches.ts` | Match query key included tenant context. |
| `src/hooks/useMatchSets.ts` | Match-set query key included tenant context. |

## Fix

| File | Change |
|---|---|
| `src/store.ts` | Route workspace context no longer calls legacy `initSupabase`; `initSupabase` no longer overwrites route context with profile tenant when current path is `/admin/workspace/*` or `/tournament/*`. |
| `src/App.tsx` | Realtime full legacy sync is skipped while on route-based workspace/tournament paths. |
| `src/hooks/useEvents.ts` | Event query key changed to `['events', activeTournamentId]`. |
| `src/components/use-events-query.ts` | Header event query key changed to `['events', activeTournamentId]`. |
| `src/hooks/useTeams.ts` | Team query key changed to `['teams', selectedEventId]`. |
| `src/hooks/useGroups.ts` | Group query key changed to `['groups', selectedEventId]`. |
| `src/hooks/useMatches.ts` | Match query key changed to `['matches', selectedEventId]`. |
| `src/hooks/useMatchSets.ts` | Match-set query key changed to `['match-sets', selectedEventId]`. |
| `src/hooks/useDataMutations.ts` | Invalidations updated to the new query key prefixes. |
| `src/hooks/useTournamentRpcMutations.ts` | Invalidations updated to the new query key prefixes. |

## Correct Context

Verified from SQL demo report:

| Context | Value |
|---|---|
| Tenant | `49fdb58c-1c70-4bb6-8ffc-d6ffe711195b` |
| Tournament | `tournament-ee121f28-e882-466b-acfc-866179df715a` |
| Đôi Nam | `evt_6da72de38f5c469d8e829348c92dfde2` |
| Đôi Nữ | `evt_4b8ff313ce2c43fb8aa796cf6a9da464` |
| Đôi Nam Nữ | `evt_86d3121231e2486c99590615a11d5407` |

## Demo Data Verification

Read-only SQL verification:

```text
tests/enterprise/verify_demo_e2e_07j.sql
```

Result: PASS.

| Event | Teams | Groups | Group matches | Finished group matches | Confirmed KO teams | KO matches |
|---|---:|---:|---:|---:|---:|---:|
| Đôi Nam | 16 | 4 | 24 | 24 | 8 | 7 |
| Đôi Nữ | 8 | 2 | 12 | 4 | 0 | 0 |
| Đôi Nam Nữ | 8 | 2 | 12 | 0 | 0 | 0 |

Isolation:

- Đôi Nam has Đôi Nữ demo teams: `0`.
- Đôi Nữ has Đôi Nam demo teams: `0`.
- Cross-event match/team mismatch count: `0`.
- Tenant id and tournament id are not valid event ids.
- All selected demo event ids start with `evt_`.

## Vercel Test

Vercel deployment URL from previous production deployment:

```text
https://giai-dau-pickleball-6pb729di4-huunsbks-projects.vercel.app
```

Runtime browser verification is blocked because Vercel is currently protected:

```text
401 Authentication Required
This page requires Vercel authentication.
```

Authenticated SUPER_ADMIN browser test was not run because no SUPER_ADMIN credential/session or Vercel bypass token was provided in this workspace.

## GitHub Pages Test

GitHub Pages can be opened publicly, but authenticated SUPER_ADMIN browser test was not run because no SUPER_ADMIN credential/session was provided.

Expected after deploy:

- Route `/PIC_HUU/admin/workspace/thang-oanh` should no longer invoke legacy `initSupabase` repeatedly.
- Console should not print the old Vietnamese `CSDL phân rã` load message.
- Data hooks should read by `evt_...` event id.

## Console / Network

Could not complete the required 60-second authenticated browser observation without credentials.

Static/runtime implications of the fix:

- Workspace route no longer calls legacy full sync from `setWorkspaceContext`.
- Auth profile restore no longer overwrites route context with account tenant.
- Realtime table changes no longer trigger legacy full sync on route workspace pages.
- Query keys are stable scalar keys, not object keys.

## Verification Commands

| Check | Result |
|---|---|
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `rg "EVENT_MANAGER" src` | PASS, no matches |
| `rg "11111111-1111-1111-1111-111111111111" src` | PASS, no matches |
| `rg "CSDL phân rã\|Khởi tạo và đồng bộ" src` | PASS, no matches |

## Remaining Manual Verification

After Vercel protection is disabled or a bypass token is provided:

1. Log in as SUPER_ADMIN.
2. Open `/admin/workspace/thang-oanh`.
3. Observe console for at least 60 seconds.
4. Confirm no legacy tenant id appears.
5. Confirm no repeated Supabase load loop.
6. Confirm Đôi Nam displays 16 teams, 4 groups, 24 group matches, and 7 KO matches.
7. Switch to Đôi Nữ and Đôi Nam Nữ and confirm 8 teams, 2 groups, 12 group matches each.
