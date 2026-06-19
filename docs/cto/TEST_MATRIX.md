# Test Matrix

## Nghiem Thu Du Lieu

| ID | Hang muc | Cach kiem tra | Ket qua mong doi | Trang thai | Ghi chu |
|---|---|---|---|---|---|
| DATA-001 | Demo data reset safety | SQL counts after `001_reset_demo_and_roles.sql` | Listed business tables have 0 rows | Pass | Prompt 03 |
| DATA-002 | SUPER_ADMIN preserved | SQL join `accounts` + `roles` + `auth.users` | At least 1 active SUPER_ADMIN | Pass | Count = 1 |
| DATA-003 | auth.users untouched | SQL count `auth.users` | Auth users still exist | Pass | total=8, active=8 |

## Nghiem Thu Phan Quyen

| ID | Hang muc | Cach kiem tra | Ket qua mong doi | Trang thai | Ghi chu |
|---|---|---|---|---|---|
| AUTH-001 | Role set | `SELECT name FROM public.roles ORDER BY name` | Only SUPER_ADMIN, TENANT_ADMIN, EVENT_ADMIN, REFEREE, VIEWER | Pass | Prompt 03 |
| AUTH-002 | Permission set | `SELECT name FROM public.permissions ORDER BY name` | Standard permission set only | Pass | Prompt 03 |
| AUTH-003 | SUPER_ADMIN permission | Role permission SQL check | SUPER_ADMIN has `*` | Pass | Prompt 03 |
| AUTH-004 | EVENT_ADMIN without event grant | Simulated auth context + `has_event_access` | No event operation without grant | Pass | No grants after reset |
| AUTH-005 | REFEREE restrictions | Simulated auth context + `has_permission` | Can enter scores, cannot manage teams/groups | Pass | Prompt 03 |
| AUTH-006 | TENANT_ADMIN runtime isolation | Login/RLS test with TENANT_ADMIN user | Cannot see another tenant | Blocked | No active auth-linked TENANT_ADMIN account exists |
| AUTH-007 | VIEWER admin RPC denial | Login/RPC test with VIEWER user | Admin RPC denied | Blocked | No active auth-linked VIEWER account exists |
| AUTH-008 | Prompt 05 RPC grants | information_schema routine privileges | `authenticated` execute, no `anon` execute | Pass | Prompt 05 |
| AUTH-009 | Grant/revoke event access | Transaction SQL test as SUPER_ADMIN/REFEREE/anon | SUPER_ADMIN succeeds; anon/REFEREE blocked | Pass | Prompt 05 |
| AUTH-010 | `has_event_access` event scope | Simulated REFEREE/EVENT_ADMIN contexts | Grant required for EVENT_ADMIN/REFEREE | Pass | Prompt 05 |
| AUTH-011 | Direct `match_sets` write lock | Table privileges and direct insert attempts | anon/authenticated cannot insert/update/delete directly | Pass | Prompt 05 |
| AUTH-012 | Prompt 06 admin RPC grants | information_schema routine privileges | `authenticated` execute, no `anon` execute | Pass | Prompt 06 |
| AUTH-013 | Team/group admin permissions | Simulated SUPER_ADMIN/EVENT_ADMIN/REFEREE/anon | SUPER/EVENT_ADMIN pass when allowed; REFEREE/anon blocked | Pass | VIEWER not run; no active auth-linked account |
| AUTH-014 | Prompt 07-H event access RPC grants | Post-apply SQL | list/grant/revoke event-access RPCs exist; authenticated execute; anon blocked | Pass | Migration 009 applied |
| AUTH-015 | Prompt 07-H demo referee grant | SQL demo tenant check | Grant Đôi Nam if active REFEREE exists in demo tenant | Blocked by data | No active REFEREE in demo tenant; no `auth.users` created |
| AUTH-016 | Prompt 07-H cross-tenant referee protection | SQL account/tenant review | Existing REFEREE from another tenant is not granted demo event access | Pass | Đôi Nam/Đôi Nữ grant counts remain 0 |
| AUTH-017 | Prompt 07-I validation helper grants | Post-apply SQL | Internal validation helpers/core not executable by anon/authenticated | Pass | Public wrappers remain executable where needed |
| AUTH-018 | Prompt 07-I invalid event id | Negative SQL | Empty event id returns `INVALID_EVENT_ID` | Pass | `create_team_v1('', ...)` |
| AUTH-019 | Prompt 07-I wrong context ids | Negative SQL | Tournament/tenant ids used as event ids return `INVALID_CONTEXT` | Pass | `create_team_v1(tournament_id/tenant_id, ...)` |
| AUTH-020 | Prompt 07-I missing match id | Negative SQL | Missing match returns `MATCH_NOT_FOUND` | Pass | `reset_match_score_v1(missing)` |
| AUTH-021 | Prompt 07-I REFEREE management block | Negative SQL | Existing REFEREE from another tenant cannot manage Đôi Nam teams | Pass | Blocked with `INVALID_CONTEXT`; demo-tenant REFEREE E2E still pending |

## Nghiem Thu Nghiep Vu Pickleball

| ID | Hang muc | Cach kiem tra | Ket qua mong doi | Trang thai | Ghi chu |
|---|---|---|---|---|---|
| PB-001 | Create tournament/event/team flow | TBD | End-to-end flow succeeds | Not run |  |
| PB-002 | Prompt 03 no algorithm change | Code scope review | No tournament algorithm edits | Pass | Prompt 03 only touched role/permission-related frontend |
| PB-003 | Single-set scoring RPC | `update_match_score_v1` in transaction | Match finished, aggregate 1-0, one match_set row | Pass | Prompt 05 |
| PB-004 | Best-of-3 scoring RPC | `update_match_set_score_v1` in transaction | 1-0, 1-1, 2-1 and 2-0 paths correct | Pass | Prompt 05 |
| PB-005 | Reset score RPC | `reset_match_score_v1` in transaction | Match pending, scores/winner cleared, active sets cleared | Pass | Downstream knockout reset TODO |
| PB-006 | Team management RPC | `create_team_v1`, `import_teams_v1` | Create/import pass with duplicate/permission guards | Pass | Prompt 06 |
| PB-007 | Group setup 4 teams | `setup_groups_v4`, `generate_schedule_v1` | 1 group, 6 matches | Pass | Prompt 06 |
| PB-008 | Group setup 5 teams | `setup_groups_v4`, `generate_schedule_v1` | 1 group, 10 matches, no junk BYE | Pass | Prompt 06 |
| PB-009 | Group setup 16 teams | `setup_groups_v4`, `generate_schedule_v1` | 4 groups of 4, 24 matches | Pass | Prompt 06 |
| PB-010 | Group count bounds | `setup_groups_v4` | 0 and 33 blocked | Pass | Prompt 06 |
| PB-011 | Assign team to group | `assign_team_to_group_v2` | team/group sync and cross-event guard | Pass | Prompt 06 |
| PB-012 | Knockout candidates | `prepare_knockout_candidates_v1` | 8 top-2 candidates, 10 with best thirds | Pass | Prompt 06 |
| PB-013 | Confirm KO teams | `confirm_knockout_teams_v1` | Confirms 8 or 6/8 with BYE; invalid inputs blocked | Pass | Prompt 06 |
| PB-014 | Generate KO bracket | `generate_knockout_bracket_v1` | QF/SF/F ids, next links, BYE placeholders | Pass | Prompt 06 |
| PB-015 | Team UI RPC wiring | Static scan + code review | Main UI calls `create/update/archive/import` team RPCs | Pass | Prompt 07 |
| PB-016 | Group UI RPC wiring | Static scan + code review | Main UI calls `setup_groups_v4`, `assign_team_to_group_v2`, `dissolve_groups_v4` | Pass | Prompt 07 |
| PB-017 | Schedule UI RPC wiring | Static scan + code review | Main UI calls `generate_schedule_v1` | Pass | Prompt 07 |
| PB-018 | Single scoring UI RPC wiring | Static scan + build | UI calls `update_match_score_v1`, no frontend `winner_id` input | Pass | Prompt 07 |
| PB-019 | Best-of-3 scoring UI RPC wiring | Static scan + build | `ScoreEntry` calls `update_match_set_score_v1` per set | Pass | Prompt 07 |
| PB-020 | Knockout UI RPC wiring | Static scan + build | UI calls prepare/confirm/generate knockout RPCs | Pass | Prompt 07 |
| PB-021 | Single set real score input | Static UI review + build | UI accepts real set points such as `11-4`, not aggregate `1-0` input | Pass | Prompt 07 supplemental |
| PB-022 | Best-of-3 set rows | Static UI review + build | UI renders Séc 1, Séc 2, Séc 3 with score A/B inputs | Pass | Prompt 07 supplemental |
| PB-023 | Best-of-3 2-0 lock | Static UI review + build | Set 3 locks after finished 2-0 result; reset required before edit | Pass | Prompt 07 supplemental |
| PB-024 | Score reset UI | Static UI review + build | UI calls `reset_match_score_v1` and clears local score inputs | Pass | Prompt 07 supplemental |
| PB-025 | Team import uses real event id | Static scan + build | Team/group/schedule/KO RPC paths resolve `selectedEventId` from `public.events`; placeholder id not present in `src` | Pass | Manual network test pending |
| PB-026 | Workspace context route | Static scan + build | `/admin/workspace/<slug>` resolves tenant/tournament context and does not use legacy placeholder hash | Pass | SQL migration/manual browser test pending |
| PB-027 | Tenant management UI | Static scan + build | SUPER_ADMIN-only UI calls tenant management RPCs | Pass | Migration 006 not run in this turn |
| PB-028 | Tournament management UI | Static scan + build | Tournament list/create/archive uses tournament RPCs | Pass | Migration 007 not run in this turn |
| PB-029 | Migration 005-006-007 preflight | Orphan/FK preflight SQL | No orphan FK rows before applying migrations | Pass | Business test data reset cleared orphan rows |
| PB-030 | Business test data reset | Count SQL before/after | Business tables reset to 0; protected auth/roles/accounts/sports preserved | Pass | `auth.users=8`, active SUPER_ADMIN=1 |
| PB-031 | 005-006-007 RPC existence/grants | Post-apply SQL | RPCs exist; authenticated execute; anon blocked | Pass | 006/007 patched and re-applied to revoke anon |
| PB-032 | Prompt 07-BASE demo tenant | `list_tenants_v1` + SQL verify | `CLB Thắng Oanh` exists once and is active | Pass | Tenant id `49fdb58c-1c70-4bb6-8ffc-d6ffe711195b` |
| PB-033 | Prompt 07-BASE demo subscription | SQL verify | Demo tenant has one active subscription with sufficient plan | Pass | Enterprise plan; direct insert because no billing RPC exists |
| PB-034 | Prompt 07-BASE demo tournament | `list_tournaments_v1` + context RPC | `thang-oanh` exists and resolves through `get_workspace_context_v1` | Pass | No events/teams created |
| PB-035 | Prompt 07-G event RPCs | Post-apply SQL | list/create/update/archive/restore event RPCs exist; authenticated execute; anon blocked | Pass | Migration 008 applied |
| PB-036 | Prompt 07-G demo events | SQL verify | Đôi Nam, Đôi Nữ, Đôi Nam Nữ exist in tournament `thang-oanh` | Pass | teams/groups/matches remain 0 |
| PB-037 | Event UI RPC wiring | Static scan + build | Nội dung thi đấu list/create/archive/restore uses RPCs | Pass | Legacy Dashboard import/delete remains out of scope |
| PB-038 | Event referee access UI wiring | Static scan + build | "Cấp quyền trọng tài" modal uses list/grant/revoke RPCs, no direct `account_event_permissions` write | Pass | Prompt 07-H |
| PB-039 | Business mutation context guards | Static review + build | Team/group/schedule/score/KO mutations require tenant/tournament/event context | Pass | Prompt 07-I |

## Nghiem Thu Multi-Sport

| ID | Hang muc | Cach kiem tra | Ket qua mong doi | Trang thai | Ghi chu |
|---|---|---|---|---|---|
| SPORT-001 | Pickleball as configured sport | TBD | Pickleball is data/config, not hard-coded system identity | Not run |  |
| SPORT-002 | Sports table and seed | SQL schema/seed check | `sport_pickleball` exists with default settings | Pass | Prompt 04 |
| SPORT-003 | Event config columns | information_schema check | `sport_id`, `competition_type`, `format_type`, `scoring_config`, `ranking_config` exist | Pass | Prompt 04 |
| SPORT-004 | Single set event config | Transaction insert test | `matchSetMode=single`, `numberOfSets=1` accepted | Pass | Rolled back |
| SPORT-005 | Best-of-3 event config | Transaction insert test | `matchSetMode=best_of_3`, `numberOfSets=3` accepted | Pass | Rolled back |
| SPORT-006 | Match sets table | SQL schema check | `match_sets` exists with unique `(match_id,set_number)` | Pass | Prompt 04 |
| SPORT-007 | Sports RLS | Simulated authenticated REFEREE | REFEREE cannot create sport | Pass | RLS blocks insert |
| SPORT-008 | Event config RPC validation | `update_event_config_v1` transaction tests | Valid configs pass, invalid configs fail | Pass | Prompt 05 |
| SPORT-009 | REFEREE event config denial | Simulated REFEREE | REFEREE cannot update event config | Pass | Prompt 05 |
| SPORT-010 | Event config UI fields | Static UI review | sport, competition, format, scoring mode, groupCount/ranking options available | Pass | Prompt 07 |
| SPORT-011 | Event config UI RPC | Static scan + build | Business config saves through `update_event_config_v1` | Pass | Prompt 07 |

## Nghiem Thu Realtime

| ID | Hang muc | Cach kiem tra | Ket qua mong doi | Trang thai | Ghi chu |
|---|---|---|---|---|---|
| RT-001 | Event-scoped updates | TBD | User receives updates only for selected event | Not run |  |
| RT-002 | MatchSets RLS foundation | Simulated roles | anon cannot write; REFEREE needs event access | Pass | Prompt 04 |
| RT-003 | MatchSets final write path | Direct write + scoring RPC tests | Direct write blocked; RPC write succeeds | Pass | Prompt 05 |
| RT-004 | Frontend `match_sets` direct write scan | `rg` static scan | No direct insert/update/delete in `src` | Pass | Prompt 07 |
| RT-005 | Frontend KO selections direct write scan | `rg` static scan | No direct insert/update/delete in `src` | Pass | Prompt 07 |

## Nghiem Thu Performance

| ID | Hang muc | Cach kiem tra | Ket qua mong doi | Trang thai | Ghi chu |
|---|---|---|---|---|---|
| PERF-001 | Dashboard 100 tournaments | TBD | Load time under 2 seconds | Not run |  |
| PERF-002 | Prompt 07 build bundle | `npm run build` | Build succeeds | Pass | Existing Vite chunk-size warning remains |
