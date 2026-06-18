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

## Nghiem Thu Realtime

| ID | Hang muc | Cach kiem tra | Ket qua mong doi | Trang thai | Ghi chu |
|---|---|---|---|---|---|
| RT-001 | Event-scoped updates | TBD | User receives updates only for selected event | Not run |  |
| RT-002 | MatchSets RLS foundation | Simulated roles | anon cannot write; REFEREE needs event access | Pass | Prompt 04 |
| RT-003 | MatchSets final write path | Direct write + scoring RPC tests | Direct write blocked; RPC write succeeds | Pass | Prompt 05 |

## Nghiem Thu Performance

| ID | Hang muc | Cach kiem tra | Ket qua mong doi | Trang thai | Ghi chu |
|---|---|---|---|---|---|
| PERF-001 | Dashboard 100 tournaments | TBD | Load time under 2 seconds | Not run |  |
