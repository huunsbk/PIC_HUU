# Scoring RPC Tests

Prompt 05 tests were executed against Supabase beta. Test data was created inside a SQL transaction and rolled back after verification.

## Summary

| Area | Result | Evidence |
|---|---|---|
| Function existence | Pass | 12 helper/RPC functions found |
| RPC grants | Pass | `authenticated` execute grants exist; `anon` has none |
| Direct `match_sets` write lock | Pass | `authenticated` only has SELECT; `anon` has no write grant |
| Event access RPC | Pass | anon/REFEREE blocked; SUPER_ADMIN grant/revoke succeeds |
| Event config RPC | Pass | valid configs accepted; invalid configs blocked |
| Single-set scoring | Pass | REFEREE with access can score; aggregate and set row correct |
| Best-of-3 scoring | Pass | 1-0, 1-1, 2-1 and 2-0 flows verified |
| Reset scoring | Pass | match reset to pending and active match_sets cleared |
| Audit logs | Pass | all Prompt 05 audit actions were written |
| Regression | Pass | `auth.users` intact; active SUPER_ADMIN remains |

## Direct Write Block

Expected:

- `anon` cannot insert/update/delete `match_sets`.
- `authenticated` cannot insert/update/delete `match_sets` directly.
- `REFEREE` with event access still cannot write `match_sets` directly.
- Score writes go through RPC.

Observed:

```text
anon direct insert match_sets: blocked, code=42501, permission denied for table match_sets
REFEREE with event access direct insert match_sets: blocked, code=42501, permission denied for table match_sets
match_sets grants for anon/authenticated: authenticated=SELECT only
```

## Event Access Tests

| Test | Result |
|---|---|
| `anon` calls `grant_event_access_v1` | Pass, blocked with function permission denied |
| `REFEREE` calls `grant_event_access_v1` | Pass, blocked by internal permission check |
| `SUPER_ADMIN` calls `grant_event_access_v1` | Pass |
| `SUPER_ADMIN` calls `revoke_event_access_v1` | Pass, `revoked_rows=1` |
| `EVENT_ADMIN` without grant checks `has_event_access` | Pass, false |
| `REFEREE` with grant checks `has_event_access` | Pass, true |
| `REFEREE` without grant checks `has_event_access` | Pass, false |

## Event Config Tests

| Test | Result |
|---|---|
| SUPER_ADMIN updates single-set config | Pass |
| SUPER_ADMIN updates best-of-3 config | Pass |
| Invalid `format_type` | Pass, blocked |
| Invalid `matchSetMode` | Pass, blocked |
| `single` with `numberOfSets=3` | Pass, blocked |
| `best_of_3` with `setsToWin=1` | Pass, blocked |
| EVENT_ADMIN without event grant | Pass, blocked |
| EVENT_ADMIN with event grant | Pass |
| REFEREE updates event config | Pass, blocked |

## Single Set

Fixture:

- Event mode: `single`
- Teams: A and B
- Match starts `pending`
- REFEREE has event access

Action:

```sql
select public.update_match_score_v1('<match_id>', 15, 10);
```

Observed:

```text
success=true
matches.score_a=1
matches.score_b=0
matches.winner_id=team A
matches.status=finished
match_sets active row count=1
match_sets set_number=1
```

Negative tests:

```text
REFEREE without event access: blocked
anon scoring RPC: blocked
direct insert match_sets: blocked
```

## Best Of 3

Fixture:

- Event mode: `best_of_3`
- Teams: A and B
- Match starts `pending`
- REFEREE has event access

Actions and observations:

```text
Set 1: A wins 15-10 -> match in_progress, aggregate 1-0, winner null
Set 2: B wins 15-10 -> match in_progress, aggregate 1-1, winner null
Set 3: A wins 15-12 -> match finished, aggregate 2-1, winner A
```

2-0 path:

```text
Set 1: A wins
Set 2: A wins
Match finished, aggregate 2-0, winner A
Set 3 after 2-0: blocked with "Match is already finished; reset before editing scores"
```

## Reset

Action:

```sql
select public.reset_match_score_v1('<match_id>');
```

Observed:

```text
matches.status=pending
matches.score_a=null
matches.score_b=null
matches.winner_id=null
active match_sets count=0
```

Note:

- Downstream knockout reset is documented as TODO because the current schema/flow does not yet provide a full downstream bracket rollback contract for Prompt 05.

## Audit Log

Audit actions observed during the transaction:

```text
GRANT_EVENT_ACCESS: 7
REVOKE_EVENT_ACCESS: 1
UPDATE_EVENT_CONFIG: 3
UPDATE_MATCH_SCORE: 8
UPDATE_MATCH_SET_SCORE: 5
RESET_MATCH_SCORE: 1
```

The current `audit_logs` table stores JSON details as text in the `details` column.

