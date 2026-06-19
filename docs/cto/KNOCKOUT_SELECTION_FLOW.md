# Knockout Selection Flow

## 1. System Suggests Teams

RPC:

```sql
prepare_knockout_candidates_v1(
  p_event_id text,
  p_top_per_group integer default 2,
  p_best_third_count integer default 0,
  p_exclude_bottom_results boolean default false
)
```

The system calculates current group standings and returns candidate teams with:

- `team_id`
- `team_name`
- `group_id`
- `group_name`
- `group_rank`
- `points`
- `score_diff`
- `set_diff`
- `point_diff`
- `source`
- `suggested_seed`

Sources:

- `group_rank`: qualified by rank inside group.
- `best_third`: qualified as one of the best third-place teams.

If `p_exclude_bottom_results=true`, the RPC uses derived comparison stats for best-third selection. It does not delete or modify real match results.

Audit action:

```text
PREPARE_KNOCKOUT_CANDIDATES
```

## 2. Admin Confirms Teams

RPC:

```sql
confirm_knockout_teams_v1(
  p_event_id text,
  p_teams jsonb,
  p_bracket_size integer,
  p_override_reason text default null
)
```

The system suggestion is only a draft. Admin confirms the final list.

Supported bracket sizes:

- 4
- 8
- 16
- 32

Rules:

- Duplicate team is blocked.
- Duplicate seed is blocked.
- Team from another event is blocked.
- More teams than `bracket_size` is blocked.
- Fewer teams than `bracket_size` is allowed and produces BYE slots.
- Old active selections are soft-deleted before new selections are saved.

Rows are stored in:

```text
public.event_knockout_selections
```

Important columns:

- `event_id`
- `team_id`
- `seed`
- `bracket_size`
- `source`
- `source_group_id`
- `group_rank`
- `is_override`
- `override_reason`
- `confirmed_by`
- `confirmed_at`

## 3. Admin Override

If Admin changes the system-suggested list, the UI should pass `p_override_reason`.

The RPC stores:

```text
is_override=true
override_reason=<provided reason>
```

Audit action:

```text
CONFIRM_KNOCKOUT_TEAMS
```

The audit payload includes bracket size, selected count, BYE count, override reason, and selected teams.

## 4. Generate Bracket

RPC:

```sql
generate_knockout_bracket_v1(p_event_id text)
```

Rules:

- Requires active confirmed selections.
- Blocks if active knockout matches already exist.
- Uses confirmed seed order.
- Creates `matches` rows with `group_id='knockout'`.
- Creates `knockout_match_id` values like `QF-1`, `SF-1`, and `F`.
- Sets `next_match_id` and `next_match_slot` for non-final matches when schema supports it.
- Does not auto-calculate winner.

BYE behavior:

- If 6 teams are confirmed into bracket size 8, the RPC returns `bye_count=2`.
- Missing seed slots are represented as `BYE` placeholders.

Audit action:

```text
GENERATE_KNOCKOUT_BRACKET
```

