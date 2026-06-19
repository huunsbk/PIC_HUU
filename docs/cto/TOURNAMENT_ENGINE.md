# Tournament Engine

## Prompt 06 Scope

Prompt 06 moves team, group, schedule, knockout candidate, knockout confirmation, and knockout bracket operations into Supabase RPCs. Frontend wiring remains for Prompt 07.

Migration:

```text
supabase/migrations/enterprise_completion_v1/004_team_group_schedule_knockout_rpcs.sql
```

## Team Management

RPCs:

- `create_team_v1(p_event_id text, p_name text, p_seed text default 'none')`
- `update_team_v1(p_team_id text, p_name text default null, p_seed text default null)`
- `archive_team_v1(p_team_id text)`
- `import_teams_v1(p_event_id text, p_teams jsonb)`

Rules:

- RPC derives tenant/account/role from auth context.
- SUPER_ADMIN can operate globally.
- TENANT_ADMIN can operate inside tenant.
- EVENT_ADMIN must have event access.
- REFEREE and VIEWER cannot manage teams.
- Active team names are unique per event.
- Import rejects empty names, duplicate names, and names already active in the event.
- All write operations create audit logs.

## Group Setup

RPC:

```sql
setup_groups_v4(p_event_id text, p_group_count integer, p_mode text default 'balanced')
```

Admin can choose `p_group_count` from 1 to 32. The RPC explicitly blocks:

- `p_group_count < 1`
- `p_group_count > 32`
- team count smaller than requested group count

Supported modes:

- `balanced`
- `random`
- `seed`

`teams.group_id` is the source of truth. `groups.team_ids` is maintained for compatibility with current UI/data loaders.

`groupCount` is stored in:

```text
events.ranking_config.groupCount
```

## Assign Team To Group

RPC:

```sql
assign_team_to_group_v2(p_team_id text, p_group_id text)
```

Rules:

- Team and group must belong to the same event and tenant.
- Cross-event group assignment is blocked.
- If active group-stage matches already exist, the RPC blocks the move with a regenerate-required error.
- `teams.group_id` and `groups.team_ids` stay synchronized.
- Audit action: `ASSIGN_TEAM_TO_GROUP`.

## Dissolve Groups

RPC:

```sql
dissolve_groups_v4(p_event_id text)
```

Behavior:

- Clears active teams' `group_id`.
- Soft-deletes active groups.
- Soft-deletes active non-knockout matches.
- Removes `ranking_config.groupCount`.
- Audit action: `DISSOLVE_GROUPS`.

## Round Robin Schedule

RPC:

```sql
generate_schedule_v1(p_event_id text)
```

Behavior:

- Reads `events.format_type`.
- Blocks duplicate active group-stage schedule generation.
- `round_robin_only`: generates round-robin matches for all teams or per group if groups exist.
- `group_then_knockout`: generates group-stage round-robin only.
- `knockout_only`: does not generate group-stage matches.
- Odd team counts do not create fake BYE matches; the RPC creates only real team-vs-team matches.

Verified cases:

- 4 teams, 1 group: 6 matches.
- 5 teams, 1 group: 10 matches, no junk BYE match.
- 16 teams, 4 groups: 24 group matches.

## Knockout Candidates

RPC:

```sql
prepare_knockout_candidates_v1(
  p_event_id text,
  p_top_per_group integer default 2,
  p_best_third_count integer default 0,
  p_exclude_bottom_results boolean default false
)
```

Rules:

- Applies to `group_then_knockout`.
- SUPER_ADMIN, TENANT_ADMIN, and granted EVENT_ADMIN can prepare candidates.
- REFEREE and VIEWER are blocked.
- The RPC returns suggestions only; it does not create bracket matches.
- Best-third comparison can use derived statistics excluding bottom-team results without mutating real match results.
- Audit action: `PREPARE_KNOCKOUT_CANDIDATES`.

## Admin Knockout Confirmation

RPC:

```sql
confirm_knockout_teams_v1(
  p_event_id text,
  p_teams jsonb,
  p_bracket_size integer,
  p_override_reason text default null
)
```

Rules:

- Supported bracket sizes: 4, 8, 16, 32.
- Admin can choose the final team list; system suggestions are not automatically locked.
- Fewer selected teams than bracket size is allowed and produces BYE slots.
- More selected teams than bracket size is blocked.
- Duplicate teams and duplicate seeds are blocked.
- Teams from another event are blocked.
- Existing active selections for the event are soft-deleted before new selections are inserted.
- Selection rows are stored in `public.event_knockout_selections`.
- Override reason is stored when provided.
- Audit action: `CONFIRM_KNOCKOUT_TEAMS`.

## Knockout Bracket

RPC:

```sql
generate_knockout_bracket_v1(p_event_id text)
```

Rules:

- Requires confirmed knockout teams.
- Reads confirmed selections and bracket size.
- Supports bracket sizes 4, 8, 16, 32.
- Uses seed pairing.
- Adds BYE placeholders when selected teams are fewer than bracket size.
- Creates `matches` rows with `group_id='knockout'`.
- Sets `knockout_match_id` such as `QF-1`, `SF-1`, and `F`.
- Sets `next_match_id` and `next_match_slot` for non-final matches.
- Blocks duplicate active knockout bracket generation.
- Does not compute winners; winners are handled by Prompt 05 scoring RPCs.
- Audit action: `GENERATE_KNOCKOUT_BRACKET`.

## Current Limits

- Frontend still needs Prompt 07 wiring to call these RPCs.
- `generate_schedule_v1` blocks duplicate schedules instead of silently regenerating.
- `assign_team_to_group_v2` blocks moves after schedule generation; caller must dissolve/regenerate deliberately.
- Knockout bracket creates winner bracket only; bronze match is not part of Prompt 06 DB contract.
- Runtime VIEWER check was not executed because no active auth-linked VIEWER account currently exists.

