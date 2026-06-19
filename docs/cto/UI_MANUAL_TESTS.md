# UI Manual Tests

## Prompt 07 Manual Flow Checklist

These tests require a logged-in account with suitable enterprise permissions and a tenant/event context. Prompt 07 did not reset or seed database data.

## Test 1: Event Config

| Step | Expected result | Status |
|---|---|---|
| Create an event with sport `sport_pickleball` | Event is created | Ready for manual run |
| Select `group_then_knockout` | Config saves through `update_event_config_v1` | Ready for manual run |
| Select `single` | `scoring_config.matchSetMode=single` | Ready for manual run |
| Set `groupCount=4` | `ranking_config.groupCount=4` | Ready for manual run |
| Reload page | UI reads saved config from `events` query | Ready for manual run |

## Test 2: Team, Group, Schedule

| Step | Expected result | Status |
|---|---|---|
| Import 16 teams | `import_teams_v1` succeeds | Ready for manual run |
| Setup 4 groups | `setup_groups_v4` creates 4 groups | Ready for manual run |
| Verify each group | Each group has 4 teams | Ready for manual run |
| Generate schedule | `generate_schedule_v1` creates 24 group matches | Ready for manual run |

## Test 3: Special Group Counts

| Step | Expected result | Status |
|---|---|---|
| 4 teams, groupCount=1 | 6 matches after schedule generation | Ready for manual run |
| groupCount=0 | UI/RPC shows clear error | Ready for manual run |
| groupCount=33 | UI/RPC shows clear error | Ready for manual run |

## Test 4: Scoring

| Step | Expected result | Status |
|---|---|---|
| Single event, enter set score `11-4` | `update_match_score_v1(match_id,11,4)` finishes match | Ready for manual run |
| Single result display | UI shows real set points `11-4` and aggregate match result `1-0` from DB/RPC | Ready for manual run |
| Best-of-3, enter set 1 `11-4` | `update_match_set_score_v1(match_id,1,11,4)` saves set 1 | Ready for manual run |
| Best-of-3, enter set 2 `8-11` | `update_match_set_score_v1(match_id,2,8,11)` saves set 2 | Ready for manual run |
| Best-of-3, enter set 3 `11-5` | Match result displays `2-1` from DB/RPC | Ready for manual run |
| Best-of-3 2-0 path | Enter `11-4`, `11-6`; set 3 is locked after match finishes | Ready for manual run |
| Reset score | `reset_match_score_v1` clears set rows/aggregate result and unlocks inputs | Ready for manual run |

## Test 5: Knockout

| Step | Expected result | Status |
|---|---|---|
| Prepare top 2 per group | `prepare_knockout_candidates_v1` returns candidates | Ready for manual run |
| Adjust bracket size to 8 | BYE count displayed when fewer than 8 teams selected | Ready for manual run |
| Confirm candidates | `confirm_knockout_teams_v1` stores selection | Ready for manual run |
| Generate bracket | `generate_knockout_bracket_v1` creates bracket | Ready for manual run |
| Generate bracket again | RPC shows duplicate bracket error | Ready for manual run |

## Notes

- Build and lint passed after Prompt 07 frontend wiring.
- Automated browser/manual data-flow tests were not run in Prompt 07 because the prompt only required recording the manual flow checklist.
- Legacy JSON import/replace direct writes remain documented in `FRONTEND_RPC_WIRING.md`.

## Supplemental Test: Real Event ID For Team Import

| Step | Expected result | Status |
|---|---|---|
| Create tournament `Thắng Oanh` | Tournament container exists | Ready for manual run |
| Create event/content `Đôi Nam` | `public.events` has a real id for `Đôi Nam` | Ready for manual run |
| Create event/content `Đôi Nữ` | `public.events` has a real id for `Đôi Nữ` | Ready for manual run |
| Select `Đôi Nam`, then import teams | Network call `import_teams_v1` sends `p_event_id` equal to the real `Đôi Nam` event id | Ready for manual run |
| Select `Đôi Nữ`, then import teams | Network call `import_teams_v1` sends `p_event_id` equal to the real `Đôi Nữ` event id | Ready for manual run |
| Compare team lists | Teams for `Đôi Nam` and `Đôi Nữ` are separated by event | Ready for manual run |
| Try add/import with no event | UI blocks and asks the user to select a competition content first | Ready for manual run |

Static verification completed:

- `rg "11111111-1111-1111-1111-111111111111" src` returns no results.
- `npm run build` passes.
- `npm run lint` passes.
## Prompt 07-C/D/E/F Manual Tests

| Test | Steps | Expected result | Status |
|---|---|---|---|
| Workspace route slug | Open `/admin/workspace/<slug>` for `Thắng Oanh` | Browser URL remains the slug route, not `#/11111111-1111-1111-1111-111111111111` | Pending manual browser test |
| Header context | Open a tournament workspace | Header shows `Đơn vị`, `Giải`, and selected `Nội dung thi đấu` | Pending manual browser test |
| Event separation | Select `Đôi Nam`, then `Đôi Nữ` | EventBar/EventSwitcher show real event rows and team lists stay separated by event | Pending manual browser test |
| Tenant management | Login as SUPER_ADMIN and open `Quản lý đơn vị` | Can list/create/archive/restore tenants through RPC after migration 006 is applied | Pending migration run |
| Tournament management | Open `Quản lý giải đấu` | Can list/create/archive tournaments through RPC after migration 007 is applied | Pending migration run |

## Migration 005-006-007 Manual Test Status

| Test | Expected result | Status | Note |
|---|---|---|---|
| Login SUPER_ADMIN | SUPER_ADMIN can access admin UI | Not run | Migration apply blocked by orphan data |
| Open `Quản lý đơn vị` | Tenant list loads through `list_tenants_v1` | Not run | Migration 006 not applied |
| Open `Quản lý giải đấu` | Tournament list loads through `list_tournaments_v1` | Not run | Migration 007 not applied |
| Open `/PIC_HUU/admin/workspace/thang-oanh` | URL stays route-based, not legacy hash | Not run | Migration 005 not applied |
| Header context | Shows Đơn vị / Giải / Nội dung thi đấu | Not run | Migration apply blocked |

## Post Reset Manual Test Status

| Test | Expected result | Status | Note |
|---|---|---|---|
| Login SUPER_ADMIN | SUPER_ADMIN can access admin UI | Not run | Database safety verified by SQL; browser login not executed in this turn |
| Open `Quản lý đơn vị` | Tenant list loads through `list_tenants_v1` | Pending manual browser test | Migration 006 now applied |
| Open `Quản lý giải đấu` | Tournament list loads through `list_tournaments_v1` | Pending manual browser test | Migration 007 now applied; list should be empty after reset |
| Open `/PIC_HUU/admin/workspace/thang-oanh` | URL stays route-based, not legacy hash | Not applicable after reset | `Thắng Oanh` tournament was deleted with business test data |
| Header context | Shows Đơn vị / Giải / Nội dung thi đấu | Pending manual browser test | Needs newly created tournament/event |

## Prompt 07-BASE Manual Test Targets

| Test | Expected result | Status | Note |
|---|---|---|---|
| Login SUPER_ADMIN | Admin session opens | Pending manual browser test | SQL confirms active SUPER_ADMIN remains 1 |
| Open `Quản lý đơn vị` | Shows `CLB Thắng Oanh` | Pending manual browser test | `list_tenants_v1` SQL verification passed |
| Open `Quản lý giải đấu` | Shows `Giải Pickleball Thắng Oanh 2026` | Pending manual browser test | `list_tournaments_v1` SQL verification passed |
| Open `/PIC_HUU/admin/workspace/thang-oanh` | URL does not return to `#/11111111...` | Pending manual browser test | `get_workspace_context_v1('thang-oanh')` SQL verification passed |
| Header context | Shows Đơn vị / Giải / Nội dung thi đấu | Pending manual browser test | Nội dung thi đấu should be empty until Prompt 07-G |

## Prompt 07-G Manual Test Targets

| Test | Expected result | Status | Note |
|---|---|---|---|
| Open `/PIC_HUU/admin/workspace/thang-oanh` | Route remains `/admin/workspace/thang-oanh`, no `#/11111111...` | Pending manual browser test | SQL context RPC passed |
| Open `Nội dung thi đấu` | Shows `Đôi Nam`, `Đôi Nữ`, `Đôi Nam Nữ` | Pending manual browser test | SQL event verification passed |
| Select `Đôi Nam` | `selectedEventId` is `evt_6da72de38f5c469d8e829348c92dfde2` | Pending manual browser test | Event id is real DB id |
| Select `Đôi Nữ` | `selectedEventId` is `evt_4b8ff313ce2c43fb8aa796cf6a9da464` | Pending manual browser test | Event id is real DB id |
| Create one new content through UI | Calls `create_event_v1`, no direct `events.insert` | Pending manual browser test | Static code review passed |
| Quota | No `PLAN_LIMIT_EXCEEDED` when creating content | Pending manual browser test | Active Enterprise subscription exists |

## Prompt 07-H Manual Test Targets

| Test | Expected result | Status | Note |
|---|---|---|---|
| Open "Nội dung thi đấu" | Event cards show the user icon titled `Cấp quyền trọng tài` | Pending manual browser test | Static UI wiring completed |
| Open referee access modal for Đôi Nam | Modal calls `list_event_access_v1` and shows current event name | Pending manual browser test | SQL RPC verification passed |
| Grant referee access | Select an eligible REFEREE/EVENT_ADMIN and grant `enter_scores` | Blocked by data | Demo tenant has no active REFEREE account |
| Revoke referee access | Existing grant can be revoked through `revoke_event_access_v1` | Pending data | Requires a demo-tenant REFEREE/EVENT_ADMIN grant |
| REFEREE event isolation | REFEREE with Đôi Nam access cannot score Đôi Nữ | Pending data | No demo-tenant REFEREE login exists yet |
| SUPER_ADMIN safety | SUPER_ADMIN can manage event access | SQL pass, browser pending | active SUPER_ADMIN count remains 1 |

## Prompt 07-I Context Guard Manual Test Targets

| Test | Expected result | Status | Note |
|---|---|---|---|
| No tenant selected | Team/group/schedule/score/KO actions show `Vui lòng chọn hoặc tạo đơn vị trước.` | Pending manual browser test | Guard added in hooks |
| No tournament selected | Business actions show `Vui lòng chọn hoặc tạo giải đấu trước.` | Pending manual browser test | Guard added in hooks |
| No event selected | Business actions show `Vui lòng chọn hoặc tạo nội dung thi đấu trước.` | Pending manual browser test | Guard requires `evt_...` |
| Placeholder event id | No mutation is sent with `11111111-1111-1111-1111-111111111111` | Static pass | `isUsableEventId` rejects placeholder and non-`evt_` ids |
| Tournament id used as event id | Backend returns `INVALID_CONTEXT` | SQL pass | Negative test executed |
| Tenant id used as event id | Backend returns `INVALID_CONTEXT` | SQL pass | Negative test executed |
| Missing match id | Backend returns `MATCH_NOT_FOUND` | SQL pass | Negative test executed |
