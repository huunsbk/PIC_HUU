# Score, Schedule, Knockout Fix Implementation Report

## Scope

Implemented the Prompt 12 fix set for:

- Score entry and score display using real set scores from `match_sets`.
- Group-stage round-robin scheduling with `court_count`, `court_number`, `slot_number`, and `display_order`.
- Knockout seed labels that stay visible after teams are resolved and after winners advance.

## Root Cause: 1-0 Displayed Instead Of 15-4

The database contract was already split correctly for single-set matches:

- `match_sets.score_a/score_b` stores real set points, for example `15-4`.
- `matches.score_a/score_b` stores aggregate sets won, for example `1-0`.

The UI bug came from schedule/score components reading `matches.score_a/score_b` for the visible score badge. That made a finished one-set match show `1-0` as if it were the set score.

## Score Fix

Added `src/utils/scoreDisplay.ts` and wired the relevant screens to attach `match_sets` to matches. Set score display now reads from `match_sets` first, then falls back only when no set rows exist.

Updated screens:

- `ScoreEntry`: latest score badge now shows `15-4`; result line shows `t2 thắng 1-0`.
- `SchedulerAndScoreKeeper`: score inputs and Excel export use real set scores.
- `Standings`: standings calculate point totals from set points, not aggregate set wins.
- `LiveDashboard`, `LiveBracket`, `ExportManager`: visible scores/export values use set score strings.

`useDataMutations` now invalidates `match-sets` after score update/reset so reset and save refresh immediately.

## RPC And Migration

Added migration:

- `supabase/migrations/enterprise_completion_v1/012_score_schedule_knockout_fix.sql`

It adds:

- `events.schedule_config jsonb`
- `matches.court_number`
- `matches.slot_number`
- `matches.display_order`
- `matches.metadata jsonb`
- `event_knockout_selections.seed_label`
- `event_knockout_selections.seed_source`
- `event_knockout_selections.resolved_team_id`

It replaces/extends:

- `generate_schedule_v1`
- `prepare_knockout_candidates_v1`
- `confirm_knockout_teams_v1`
- `generate_knockout_bracket_v1`
- `update_match_score_v1`
- `update_match_set_score_v1`
- `reset_match_score_v1`

The score RPC wrappers still use the existing secured `p10_require_match_score_context_v1` and core scoring functions, then add KO winner propagation/reset behavior.

## Schedule Algorithm

`generate_schedule_v1` now reads `court_count` from `events.schedule_config` or `ranking_config.schedule_config`. It soft-deletes existing pending group-stage schedules before regeneration. If any group-stage match already has a finished score, it raises an explicit error and does not silently erase results.

For a 4-team group ordered as `A1, A2, A3, A4`, it generates:

- Round 1: `A1-A2`, `A3-A4`
- Round 2: `A1-A3`, `A2-A4`
- Round 3: `A1-A4`, `A2-A3`

With Bảng A ordered `t1, t3, t5, t7`, the first match is therefore `t1` vs `t3`.

For multiple groups, matches are ordered by `round_no`, then `match_in_round`, then group order, so Bảng A/B/C are interleaved by round instead of exhausting one group first.

Court assignment:

- `court_number` cycles from `1..court_count`.
- `slot_number` increments after all courts for the current slot are filled.
- A greedy slot guard advances to the next slot if a candidate would put the same team on two courts at once.
- `display_order` is stable and deterministic.

## Knockout Model

Knockout selections and matches now separate:

- `seed_label`: display label such as `Nhất bảng A`, `Nhì bảng B`, `Ba XS 1`, `Thắng Tứ Kết 1`.
- `seed_source`: JSON source such as group id/rank, third-best index, or winner-of-match id.
- `resolved_team_id`: concrete team id at confirmation/propagation time.

`generate_knockout_bracket_v1` writes the labels and resolved team ids into `matches.metadata`:

- `seed_label_a`, `seed_label_b`
- `seed_source_a`, `seed_source_b`
- `resolved_team_id_a`, `resolved_team_id_b`

The bracket UI now renders the seed label as the primary line and the resolved team name as the smaller secondary line.

## KO Auto Selection And Manual Edit

`prepare_knockout_candidates_v1` returns seed labels/source metadata along with team ids. `confirm_knockout_teams_v1` persists that metadata.

The existing manual drag/drop editor remains in `KnockoutBracket.tsx`; display logic has been updated so saved/resolved slots do not collapse into team-only labels. Database-confirmed KO generation uses the persistent seed metadata.

When a KO score is entered:

- RPC computes `winner_id`.
- `p12_propagate_knockout_winner_v1` writes the winner into the next match slot.
- The next slot keeps its primary label, for example `Thắng Tứ Kết 1`, and only updates the secondary team line.

When a KO score is reset:

- `p12_reset_knockout_downstream_v1` clears downstream resolved teams and scores recursively.
- Audit logging still flows through the existing reset score core RPC.

## Tests And Verification

Added:

- `tests/enterprise/verify_score_schedule_knockout_012.sql`

It verifies:

- Prompt 12 schema columns exist.
- Required RPC signatures exist.
- 4-team Bảng A simulation starts with `t1-t3`.
- 6 unique pairs are generated.
- No team is assigned twice in one 2-court slot.

Commands run:

- `npm run build`: passed.
- `npm run lint`: passed.
- `node scripts/supabase-sql-runner.mjs supabase/migrations/enterprise_completion_v1/012_score_schedule_knockout_fix.sql`: passed on DB target.
- `node scripts/supabase-sql-runner.mjs tests/enterprise/verify_score_schedule_knockout_012.sql`: passed on DB target.

`npm test` was not run because `package.json` has no `test` script.

Direct write scan:

- `matches update`: one legacy event soft-delete write remains in `src/store.ts`.
- `matches insert`: none.
- `match_sets update`: none.
- `match_sets insert`: none.
- `groups insert`: none.
- `teams insert`: none.

The remaining `matches` direct update is event archival cleanup, not score entry or schedule generation. It should be moved behind an archive-event RPC in a separate event-management cleanup pass.

## Files Changed

- `src/components/ExportManager.tsx`
- `src/components/KnockoutBracket.tsx`
- `src/components/LiveBracket.tsx`
- `src/components/LiveDashboard.tsx`
- `src/components/SchedulerAndScoreKeeper.tsx`
- `src/components/ScoreEntry.tsx`
- `src/components/Standings.tsx`
- `src/components/create-event-modal.tsx`
- `src/hooks/useDataMutations.ts`
- `src/hooks/useGroups.ts`
- `src/hooks/useMatches.ts`
- `src/lib/api/tournamentRpc.ts`
- `src/types.ts`
- `src/utils/scoreDisplay.ts`
- `src/utils/tournamentEngine.ts`
- `supabase/migrations/enterprise_completion_v1/012_score_schedule_knockout_fix.sql`
- `tests/enterprise/verify_score_schedule_knockout_012.sql`

## Notes / Residual Risk

- The repo already had unrelated local changes in `SECURITY_REPORT_V2.md` and an untracked Word lock file `docs/cto/~$ompt08.docx`; they were not part of this implementation.
- The new schedule algorithm has an exact deterministic path for 4-team groups, which covers the required Bảng A test. Larger/odd groups are deterministic and complete with same-slot team conflict prevention, but deeper rest-time optimization can be refined further if tournament rules require a specific Berger table for every group size.
