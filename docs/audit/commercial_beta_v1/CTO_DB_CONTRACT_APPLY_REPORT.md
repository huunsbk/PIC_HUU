# CTO DB Contract Apply Report

Date: 2026-06-17

Target: controlled Commercial Beta database

## Migration File

- `supabase/migrations/20260617_commercial_beta_v1_group_contracts.sql`

## Preflight Result

Status: PASS

Read-only preflight confirmed:

- Database connection reached the intended beta/staging-safe runner target without printing the connection URL or password.
- Required context functions exist:
  - `current_tenant_id`
  - `current_role_name`
  - `has_permission`
  - `has_event_access`
- Required tables exist:
  - `events`
  - `groups`
  - `teams`
  - `matches`
- Required `groups` columns exist:
  - `id`
  - `name`
  - `team_ids`
  - `event_id`
  - `tenant_id`
  - `tournament_id`
- Required `matches` columns exist:
  - `id`
  - `group_id`
  - `team_a_id`
  - `team_b_id`
  - `score_a`
  - `score_b`
  - `winner_id`
  - `status`
  - `round`
  - `event_id`
  - `tenant_id`
  - `tournament_id`
  - `placeholder_a`
  - `placeholder_b`
  - `knockout_round_name`
  - `knockout_match_id`
  - `next_match_id`
  - `next_match_slot`
- `groups.team_ids` is `jsonb`; migration uses `'[]'::jsonb`.
- `audit_logs` is compatible for safe login telemetry:
  - `action text`
  - `details text`
  - `timestamp text`
  - `tenant_id uuid`
  - `created_at timestamp with time zone`

## SQL Apply Result

Status: PASS

Applied only:

- `supabase/migrations/20260617_commercial_beta_v1_group_contracts.sql`

Runner result:

- `success: true`
- `command: SQL`

Post-apply read-only signature check confirmed:

- `record_login_session_v1()` returns `jsonb`, `SECURITY DEFINER = true`
- `setup_groups_v2(p_event_id text, p_num_groups integer)` returns `jsonb`, `SECURITY DEFINER = true`

## RPCs Created

- `public.setup_groups_v2(p_event_id text, p_num_groups integer) RETURNS jsonb`
- `public.record_login_session_v1() RETURNS jsonb`

## Permission Checks

`setup_groups_v2` checks:

- `auth.uid()` is not null.
- `current_tenant_id()` is not null.
- Permission is one of:
  - `current_role_name() = 'SUPER_ADMIN'`
  - `current_role_name() = 'TENANT_ADMIN'`
  - `has_permission('manage_groups') AND has_event_access(p_event_id)`

All group setup writes are scoped by:

- `event_id = p_event_id`
- `tenant_id = current_tenant_id()`

## Frontend Files Changed

- `src/components/AuthModal.tsx`
- `src/components/use-events-query.ts`
- `src/hooks/useAuditLogs.ts`
- `src/hooks/useDataMutations.ts`
- `src/hooks/useEvents.ts`
- `src/hooks/useGroups.ts`
- `src/hooks/useMatches.ts`
- `src/hooks/useTeams.ts`

Frontend changes:

- Calls `setup_groups_v2` instead of using the missing group setup contract.
- Calls `record_login_session_v1` as optional non-blocking telemetry.
- Does not send access tokens, refresh tokens, or full session objects to login telemetry.
- Blocks tenant-scoped queries while `activeTenantId` is `default`.
- Removes frontend `.is('tenant_id', null)` tenant filters.

## Runner Change

- `scripts/supabase-sql-runner.mjs`

Runner changes:

- Allows approved writes only for `DB_TARGET=beta` or `DB_TARGET=staging` with `ALLOW_DB_WRITE=YES`.
- Continues to block production writes.
- Supports beta/staging SSL override without printing secrets.
- Executes approved migration SQL directly instead of wrapping it as a read-only JSON query.

## Build And Lint

- `npm run build:pages`: PASS
- `npm run lint --if-present`: PASS

## Data Safety

- Real tournament data modified by Codex: no
- Destructive test action run: no
- `setup_groups_v2` called on a real event: no
- JSON restore run: no
- Schedule reset run: no
- Tables dropped: no
- Service role key used: no
- Secrets printed: no
