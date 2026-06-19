# Context Validation Report

## Prompt 07-I Summary

Date: 2026-06-19

Goal:

- Block wrong-level business operations across `Tenant -> Tournament -> Event -> Teams/Groups/Matches/Scores/Knockout`.
- Ensure business RPCs reject tenant ids or tournament ids passed as `p_event_id`.
- Ensure scoring RPCs derive event context from `matches`, not from frontend input.

## Migration

Created and applied:

- `supabase/migrations/enterprise_completion_v1/010_business_rpc_context_validation.sql`

No database reset was performed. `auth.users` was not modified.

## SQL Validation Layer

New/updated helpers:

- `p10_validate_event_context_v1(p_event_id text)`
- `p10_require_event_admin_v1(p_event_id text, p_permission text, p_rpc_name text)`
- `p10_require_match_score_context_v1(p_match_id text, p_rpc_name text)`
- `p10_has_event_permission_v1(p_event_id text, p_permission text)`
- `has_event_access(check_event_id text)` now respects active account/event tenant context and active event grants.
- `p06_require_event_admin_v1(...)` now delegates to the Prompt 07-I validation layer.

Standard errors now covered:

| Error | Meaning |
|---|---|
| `UNAUTHENTICATED` | Missing auth/account context. |
| `PERMISSION_DENIED` | Role/permission/event grant is insufficient. |
| `EVENT_NOT_FOUND` | Event row does not exist or is soft-deleted. |
| `MATCH_NOT_FOUND` | Match row does not exist or is soft-deleted. |
| `INVALID_CONTEXT` | Tenant/tournament id or cross-tenant context was used where an event context is required. |
| `INVALID_EVENT_ID` | Missing or malformed event id. Event ids must start with `evt_`. |

## RPCs Covered

The following business RPCs are covered through `p06_require_event_admin_v1` or scoring wrappers:

- `create_team_v1`
- `update_team_v1`
- `archive_team_v1`
- `import_teams_v1`
- `setup_groups_v4`
- `assign_team_to_group_v2`
- `dissolve_groups_v4`
- `generate_schedule_v1`
- `update_match_score_v1`
- `update_match_set_score_v1`
- `reset_match_score_v1`
- `prepare_knockout_candidates_v1`
- `confirm_knockout_teams_v1`
- `generate_knockout_bracket_v1`

Scoring RPC implementation detail:

- Existing scoring functions were renamed to internal core functions:
  - `p10_core_update_match_score_v1`
  - `p10_core_update_match_set_score_v1`
  - `p10_core_reset_match_score_v1`
- Public wrappers keep the original names and validate match/event/permission context before calling the core scoring logic.
- Internal helpers/core functions are not executable by `anon` or `authenticated`.

## Frontend Guards

Updated files:

- `src/hooks/useEvents.ts`
- `src/hooks/useDataMutations.ts`
- `src/hooks/useTournamentRpcMutations.ts`
- `src/lib/api/tournamentRpc.ts`

Frontend guard messages:

- Missing tenant: `Vui lòng chọn hoặc tạo đơn vị trước.`
- Missing tournament: `Vui lòng chọn hoặc tạo giải đấu trước.`
- Missing/invalid event: `Vui lòng chọn hoặc tạo nội dung thi đấu trước.`

`isUsableEventId` now requires ids to match:

- `evt_[A-Za-z0-9]+`

Guarded UI mutation flows:

- Add/import/archive teams.
- Setup/dissolve/assign groups.
- Generate schedules.
- Enter/reset scores.
- Prepare/confirm/generate knockout.

## SQL Test Results

Post-apply check:

| Check | Result |
|---|---|
| Validation helpers exist | Pass |
| Scoring wrappers exist | Pass |
| Internal helpers/core not executable by `anon` | Pass |
| Internal helpers/core not executable by `authenticated` | Pass |
| Public scoring wrappers executable by `authenticated` | Pass |
| Public scoring wrappers not executable by `anon` | Pass |
| Demo Đôi Nam event validates as SUPER_ADMIN | Pass |
| `auth.users` count | 8 |
| active SUPER_ADMIN count | 1 |

Negative checks:

| Test | Expected | Result |
|---|---|---|
| `create_team_v1('', ...)` | `INVALID_EVENT_ID` | Pass |
| `create_team_v1(tournament_id, ...)` | `INVALID_CONTEXT` | Pass |
| `create_team_v1(tenant_id, ...)` | `INVALID_CONTEXT` | Pass |
| `reset_match_score_v1(missing_match_id)` | `MATCH_NOT_FOUND` | Pass |
| REFEREE `tt` calls `create_team_v1` on Đôi Nam | Blocked before team management | Pass, `INVALID_CONTEXT` |

REFEREE notes:

- No active REFEREE exists in tenant `CLB Thắng Oanh`.
- Existing active REFEREE `tt` belongs to tenant `11111111-1111-1111-1111-111111111111`.
- REFEREE `tt` was tested against demo event Đôi Nam and was blocked with `INVALID_CONTEXT`.
- Prompt 07-I did not create `auth.users` and did not create demo REFEREE accounts.
- End-to-end REFEREE event-isolation test remains pending until a REFEREE account exists in the demo tenant.

## Build And Lint

- `npm.cmd run build`: Pass. Existing Vite chunk-size warning remains.
- `npm.cmd run lint`: Pass.

## Remaining Risk

- Legacy local-store functions still exist in `src/store.ts`, but active RPC-driven UI paths now guard selected tenant/tournament/event context before mutations.
- REFEREE E2E requires a tenant-correct REFEREE account in a later prompt or manual setup.
