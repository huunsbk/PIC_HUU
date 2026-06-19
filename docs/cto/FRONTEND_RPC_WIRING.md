# Frontend RPC Wiring

## Prompt 07 Scope

Prompt 07 wires the main frontend business flows to Supabase RPCs created in Prompt 05 and Prompt 06. It does not create migrations, reset data, or change RLS.

## RPC Client Layer

Files:

- `src/lib/api/tournamentRpc.ts`
- `src/hooks/useTournamentRpcMutations.ts`

The API layer wraps `supabase.rpc(...)`, normalizes common backend errors into Vietnamese user-facing messages, and keeps RPC input/output types in one place.

The mutation hook invalidates these query scopes after successful writes:

- `events`
- `teams`
- `groups`
- `matches`
- `match-sets`
- `dashboard-stats`

## Event Config

UI file:

- `src/components/create-event-modal.tsx`

The create event modal now captures:

- `sport_id`, default `sport_pickleball`
- `competition_type`
- `format_type`
- scoring mode: `single` or `best_of_3`
- `ranking_config.groupCount` from 1 to 32
- `top_per_group`
- `best_third_count`
- `exclude_bottom_results`

After an event is created, business configuration is saved by `update_event_config_v1`.

Known limitation: the initial event row creation still uses the existing create-event path because Prompt 05/06 did not define a `create_event_v1` RPC. The business config update is RPC-wired.

## Team Management

UI/hook files:

- `src/components/TeamManager.tsx`
- `src/hooks/useDataMutations.ts`

Main team operations now call:

- `create_team_v1`
- `update_team_v1`
- `archive_team_v1`
- `import_teams_v1`

Frontend no longer inserts/imports teams directly in the main team manager flow.

## Groups And Schedule

UI/hook files:

- `src/components/GroupManager.tsx`
- `src/components/SchedulerAndScoreKeeper.tsx`
- `src/hooks/useDataMutations.ts`

Main group/schedule operations now call:

- `setup_groups_v4`
- `assign_team_to_group_v2`
- `dissolve_groups_v4`
- `generate_schedule_v1`

The group count selector now exposes every value from 1 to 32.

Known limitation: unassigning one team to a null group is not supported by `assign_team_to_group_v2`; the UI blocks that path and points operators to `dissolve_groups_v4` for a full dissolve.

## Scoring

UI/hook files:

- `src/components/ScoreEntry.tsx`
- `src/components/SchedulerAndScoreKeeper.tsx`
- `src/hooks/useDataMutations.ts`
- `src/hooks/useMatchSets.ts`

Single-set scoring uses:

- `update_match_score_v1`
- `reset_match_score_v1`

For `matchSetMode=single`, the UI accepts the real set points, for example `11-4`. It does not ask operators to enter aggregate match results such as `1-0`.

Best-of-3 scoring in `ScoreEntry` uses:

- `update_match_set_score_v1` per set
- `reset_match_score_v1` for reset

For `matchSetMode=best_of_3`, score entry shows three set rows:

- `Séc 1`
- `Séc 2`
- `Séc 3`

Each row accepts real set points and saves through `update_match_set_score_v1(match_id,set_number,score_a,score_b)`.

The frontend does not send `winner_id`; winner calculation remains in RPC. `matches.score_a/score_b` is displayed only as aggregate set result after RPC/refetch.

If a match is finished, the score entry UI locks set inputs and requires `reset_match_score_v1` before editing. For a 2-0 best-of-3 result, set 3 is locked.

`SchedulerAndScoreKeeper` also renders real set-point inputs for best-of-3 events and no longer uses aggregate 2-1 input for those events.

## Knockout

UI file:

- `src/components/KnockoutBracket.tsx`

The knockout flow now has an RPC path:

1. `prepare_knockout_candidates_v1`
2. `confirm_knockout_teams_v1`
3. `generate_knockout_bracket_v1`

The UI shows candidate cards, supports bracket size 4/8/16/32, displays expected BYE count, and allows an override reason before confirmation.

Known limitation: legacy local drag/edit helpers still exist for visual/manual bracket editing and should be retired after a full RPC read/write bracket editor is built.

## Remaining Direct Writes

The following direct writes remain outside the main Prompt 07 RPC-wired flows:

- `src/store.ts:537` soft-deletes `matches` when deleting an event from legacy store state.
- `src/store.ts:539` soft-deletes `teams` when deleting an event from legacy store state.
- `src/store.ts:541` soft-deletes `groups` when deleting an event from legacy store state.
- `src/components/Dashboard.tsx:579-585` deletes matches during legacy JSON import/replace.
- `src/components/Dashboard.tsx:600-606` deletes teams during legacy JSON import/replace.
- `src/components/Dashboard.tsx:621-627` deletes groups during legacy JSON import/replace.

These are legacy administrative bulk-replace paths, not the primary team/group/schedule/scoring UI. They should be replaced by dedicated event archive/import RPCs in a later prompt.

## Selected Event ID Contract

Tournament-level ids and event/content ids are separate:

- `tournamentId`: the tournament/competition container, for example `Thắng Oanh`.
- `selectedEventId`: the real `public.events.id` row for a competition content, for example `Đôi Nam` or `Đôi Nữ`.

Team, group, schedule, scoring, and knockout RPCs must use `selectedEventId`, not `tournamentId`.

The frontend now resolves `selectedEventId` from the actual events query:

- `useEvents` and `useEventsQuery` read real rows from `public.events`.
- If the store has no usable event id, the first real event row is selected.
- The legacy placeholder event id is treated as unusable and is not sent to RPCs.
- `setCurrentEvent` accepts real database event ids even when they do not exist in the legacy local event map.
- After a new event is created, the frontend selects the newly created `event.id`.

Affected RPC paths:

- `create_team_v1`
- `import_teams_v1`
- `setup_groups_v4`
- `dissolve_groups_v4`
- `generate_schedule_v1`
- `prepare_knockout_candidates_v1`
- `confirm_knockout_teams_v1`
- `generate_knockout_bracket_v1`

If no real event is selected, Team Manager blocks add/import and shows:

`Vui lòng chọn nội dung thi đấu như Đôi Nam hoặc Đôi Nữ trước khi thêm đội.`

## Workspace Context Contract

The frontend now separates three ids:

- `activeTenantId`: tenant/unit id.
- `activeTournamentId`: tournament/competition container id.
- `selectedEventId`: competition content id such as `Đôi Nam` or `Đôi Nữ`.

Routed workspace pages use:

- `/admin/workspace/<tournament-slug>`
- `get_workspace_context_v1(p_slug)` to resolve tenant/tournament context.

If the RPC is not available, the frontend falls back to reading the matching `tournament` row by slug/id. The fallback is only for compatibility; the enterprise path should use the RPC after migration `005_context_scope_hardening.sql` is applied.

Tenant/tournament management UI calls:

- `list_tenants_v1`
- `create_tenant_v1`
- `archive_tenant_v1`
- `restore_tenant_v1`
- `list_tournaments_v1`
- `create_tournament_v1`
- `archive_tournament_v1`

The old workspace v6 RPCs are no longer used by the active tournament list/create/archive hooks.

## Event Management Wiring

Prompt 07-G moved the active event/content management flow to RPCs:

| UI flow | RPC |
|---|---|
| Read events for current tournament | `list_events_by_tournament_v1(activeTournamentId)` |
| Create event/content | `create_event_v1` |
| Archive event/content | `archive_event_v1` |
| Restore event/content | `restore_event_v1` |

`create_event_v1` derives `tenant_id` from the tournament. The frontend does not send `tenant_id` for event creation.

`CreateEventModal` sets the selected event using the real `event_id` returned by `create_event_v1`.

`useEvents` and `useEventsQuery` use `activeTournamentId`, so `selectedEventId` remains an event/content id such as `evt_...`, not a tenant or tournament id.

## Event Referee Access Wiring

Prompt 07-H moved the active "Cấp quyền trọng tài" modal to event-access RPCs:

| UI flow | RPC |
|---|---|
| Read granted and eligible event accounts | `list_event_access_v1(selectedEventId)` |
| Grant referee scoring access | `grant_event_access_v1(selectedEventId, accountId, 'enter_scores')` |
| Revoke referee scoring access | `revoke_event_access_v1(selectedEventId, accountId, 'enter_scores')` |

Frontend files:

- `src/components/event-card.tsx`
- `src/components/event-members-manager.tsx`
- `src/components/use-events-query.ts`
- `src/lib/api/tournamentRpc.ts`

The modal stores only local UI state `selectedRefereeAccountId`. It does not introduce a global `refereeId` context, and it does not directly insert/update/delete `account_event_permissions`.

`REFEREE` visibility and scoring authority remain server-controlled by RPC/RLS. The frontend only displays RPC results and sends the chosen account id to the grant/revoke RPCs.

## Prompt 07-I Context Guards

All business mutation flows must have a valid context before calling RPC:

- `activeTenantId`
- `activeTournamentId` or current tournament id
- `selectedEventId`

Guard messages:

- `Vui lòng chọn hoặc tạo đơn vị trước.`
- `Vui lòng chọn hoặc tạo giải đấu trước.`
- `Vui lòng chọn hoặc tạo nội dung thi đấu trước.`

`isUsableEventId` now rejects placeholders, tenant ids, tournament ids, and anything that does not match `evt_[A-Za-z0-9]+`.

Guarded frontend files:

- `src/hooks/useEvents.ts`
- `src/hooks/useDataMutations.ts`
- `src/hooks/useTournamentRpcMutations.ts`
- `src/lib/api/tournamentRpc.ts`

Guarded operations:

- Add/import/archive teams.
- Setup/dissolve/assign groups.
- Generate schedules.
- Enter/reset scores.
- Prepare/confirm/generate knockout.

Backend still performs final validation through Prompt 07-I RPC helpers, so frontend guards are user-experience checks, not the security boundary.
