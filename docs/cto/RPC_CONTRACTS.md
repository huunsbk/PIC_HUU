# RPC Contracts

## Prompt 05 Scope

Prompt 05 creates the RPC/RLS/audit foundation for event access, event config, and scoring. Frontend clients must not write directly to `public.match_sets`; score writes must go through scoring RPCs.

All business RPCs below are `SECURITY DEFINER` and use:

```sql
SET search_path TO public, pg_temp
```

No Prompt 05 RPC is granted to `anon`. `authenticated` may execute the RPCs, but each RPC still checks account, tenant, role, permission, and event access internally.

## Helper Functions

| Function | Input | Output | Purpose |
|---|---|---|---|
| `current_account_id()` | none | `uuid` | Resolves the current active account from `auth.uid()`. |
| `current_tenant_id()` | none | `uuid` | Resolves the current active account tenant. |
| `current_role_name()` | none | `text` | Resolves the current active account role. |
| `has_permission(perm_name text)` | permission name | `boolean` | Allows `SUPER_ADMIN` and `*`; otherwise checks role permissions. |
| `has_event_access(check_event_id text)` | event id | `boolean` | Checks same-tenant event access with soft-delete filters. |

`has_event_access` behavior:

- Unauthenticated users return `false`.
- Soft-deleted events return `false`.
- Cross-tenant access returns `false`.
- `SUPER_ADMIN` is allowed.
- `TENANT_ADMIN` is allowed within tenant.
- `EVENT_ADMIN` and `REFEREE` require a non-deleted row in `account_event_permissions`.

## Audit

### `log_audit_event_v1`

Input:

```sql
log_audit_event_v1(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_payload jsonb default '{}'::jsonb
)
```

Output:

```json
{
  "success": true,
  "action": "ACTION",
  "entity_type": "entity",
  "entity_id": "id"
}
```

Role được gọi:

- `authenticated`

Điều kiện bị chặn:

- `anon` has no execute grant.
- User without active account is rejected.

Compatibility note:

- Current `audit_logs` schema is `timestamp`, `action`, `details`, `created_at`, `tenant_id`.
- The RPC writes a JSON payload into `details` as text and derives tenant/account internally.

## Event Access

### `grant_event_access_v1`

Input:

```sql
grant_event_access_v1(
  p_account_id uuid,
  p_event_id text,
  p_role_name text
)
```

Output:

```json
{
  "success": true,
  "account_id": "uuid",
  "event_id": "event_id",
  "role_name": "REFEREE"
}
```

Role được gọi:

- `SUPER_ADMIN`
- `TENANT_ADMIN` in tenant
- Other role with `manage_events`

Điều kiện bị chặn:

- `anon`
- `REFEREE`
- account not found
- event not found
- cross-tenant grant
- role outside `EVENT_ADMIN`, `REFEREE`, `VIEWER`

Example tests:

```sql
select public.grant_event_access_v1('<account_id>', '<event_id>', 'REFEREE');
select public.has_event_access('<event_id>');
```

### `revoke_event_access_v1`

Input:

```sql
revoke_event_access_v1(
  p_account_id uuid,
  p_event_id text
)
```

Output:

```json
{
  "success": true,
  "account_id": "uuid",
  "event_id": "event_id",
  "revoked_rows": 1
}
```

Role được gọi:

- `SUPER_ADMIN`
- `TENANT_ADMIN` in tenant
- Other role with `manage_events`

Điều kiện bị chặn:

- `anon`
- `REFEREE`
- account not found
- event not found
- cross-tenant revoke

The revoke path soft-deletes rows by setting `account_event_permissions.deleted_at`.

## Event Config

### `update_event_config_v1`

Input:

```sql
update_event_config_v1(
  p_event_id text,
  p_sport_id text,
  p_competition_type text,
  p_format_type text,
  p_scoring_config jsonb,
  p_ranking_config jsonb
)
```

Output:

```json
{
  "success": true,
  "event_id": "event_id",
  "sport_id": "sport_pickleball",
  "competition_type": "doubles",
  "format_type": "round_robin_only",
  "scoring_config": {},
  "ranking_config": {}
}
```

Role được gọi:

- `SUPER_ADMIN`
- `TENANT_ADMIN` in tenant
- `EVENT_ADMIN` with event grant

Điều kiện bị chặn:

- `anon`
- `REFEREE`
- `VIEWER`
- event not found or cross-tenant
- sport not found or soft-deleted
- invalid `format_type`
- invalid `competition_type`
- invalid `scoring_config`

Validation:

- `format_type`: `round_robin_only`, `knockout_only`, `group_then_knockout`
- `competition_type`: `singles`, `doubles`, `team`, `individual_time`, `custom`
- `scoring_config.matchSetMode`: `single`, `best_of_3`
- `single`: `numberOfSets=1`, `setsToWin=1`
- `best_of_3`: `numberOfSets=3`, `setsToWin=2`
- `maxScore > 0`
- `capScore >= maxScore`
- optional `winByTwo` and `allowDraw` must be boolean

Example tests:

```sql
select public.update_event_config_v1(
  '<event_id>',
  'sport_pickleball',
  'doubles',
  'round_robin_only',
  '{"matchSetMode":"single","numberOfSets":1,"setsToWin":1,"maxScore":15,"capScore":17,"winByTwo":true,"allowDraw":false}'::jsonb,
  '{}'::jsonb
);
```

## Scoring

### `update_match_score_v1`

Input:

```sql
update_match_score_v1(
  p_match_id text,
  p_score_a integer,
  p_score_b integer
)
```

Output:

```json
{
  "success": true,
  "match_id": "match_id",
  "winner_id": "team_id",
  "score_a": 1,
  "score_b": 0,
  "status": "finished"
}
```

Role được gọi:

- `SUPER_ADMIN`
- `TENANT_ADMIN` in tenant
- `EVENT_ADMIN` with event grant
- `REFEREE` with event grant and `enter_scores`

Điều kiện bị chặn:

- `anon`
- unsupported event mode; this RPC only accepts `matchSetMode=single`
- negative score
- draw when `allowDraw=false`
- score above `capScore`
- invalid win-by-two result when `winByTwo=true`
- user has no tenant/event scoring permission

Behavior:

- Frontend does not pass `winner_id`.
- RPC computes the set winner.
- RPC upserts `match_sets` row `set_number=1`.
- RPC updates `matches.score_a/score_b` as aggregate set score `1/0` or `0/1`.
- RPC sets `matches.status='finished'`.

### `update_match_set_score_v1`

Input:

```sql
update_match_set_score_v1(
  p_match_id text,
  p_set_number integer,
  p_score_a integer,
  p_score_b integer
)
```

Output:

```json
{
  "success": true,
  "match_id": "match_id",
  "set_number": 1,
  "winner_id": null,
  "score_a": 1,
  "score_b": 0,
  "match_status": "in_progress"
}
```

Role được gọi:

- `SUPER_ADMIN`
- `TENANT_ADMIN` in tenant
- `EVENT_ADMIN` with event grant
- `REFEREE` with event grant and `enter_scores`

Điều kiện bị chặn:

- `anon`
- unsupported event mode; this RPC only accepts `matchSetMode=best_of_3`
- `p_set_number` outside `1..3`
- match already finished; reset required before editing
- set 3 after a 2-0 result
- invalid score by scoring config
- user has no tenant/event scoring permission

Behavior:

- Frontend does not pass `winner_id`.
- RPC computes set winner and aggregate set score.
- Until a side reaches 2 sets, `matches.status='in_progress'` and `winner_id=null`.
- At 2 won sets, `matches.status='finished'`, `winner_id` is set, and aggregate score is stored in `matches.score_a/score_b`.

### `reset_match_score_v1`

Input:

```sql
reset_match_score_v1(p_match_id text)
```

Output:

```json
{
  "success": true,
  "match_id": "match_id",
  "status": "pending"
}
```

Role được gọi:

- `SUPER_ADMIN`
- `TENANT_ADMIN` in tenant
- `EVENT_ADMIN` with event grant
- `REFEREE` with event grant and `enter_scores`

Điều kiện bị chặn:

- `anon`
- match not found or cross-tenant
- user has no tenant/event scoring permission

Behavior:

- Soft-deletes active `match_sets` rows for the match.
- Resets `matches.score_a`, `matches.score_b`, `matches.winner_id` to `null`.
- Sets `matches.status='pending'`.
- TODO for later prompt: downstream knockout reset/rollback if winner had advanced.

## Direct Write Rule

Direct client writes to `public.match_sets` are blocked:

```sql
REVOKE INSERT, UPDATE, DELETE ON public.match_sets FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.match_sets FROM authenticated;
```

The valid write paths after Prompt 05 are:

- `update_match_score_v1`
- `update_match_set_score_v1`
- `reset_match_score_v1`

