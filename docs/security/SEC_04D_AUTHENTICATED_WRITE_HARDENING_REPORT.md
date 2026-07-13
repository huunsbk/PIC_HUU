# SEC-04D Authenticated Write Hardening

## Scope

Phase 4D handles direct frontend database writes and authenticated write grants.

This PR does not change account/security APIs, scoring logic, teams/groups/schedule/knockout business rules, Edge Functions, or Phase 5-7 architecture.

## Root Issue

The frontend still had legacy paths that could write directly to core Supabase tables with the logged-in user's `authenticated` grant:

- JSON import in `Dashboard.tsx` deleted/upserted `tournament`, `events`, `groups`, `teams`, and `matches`.
- Legacy `deleteEvent` in `store.ts` soft-deleted `events`, `groups`, `teams`, and `matches` directly.
- `TournamentCard.tsx` archived tournaments with direct table update.
- `auditLogger.ts` inserted into `audit_logs` directly from the browser.
- `sessionHeartbeat.ts` updated/deleted `active_sessions` directly from the browser.
- Legacy `secureQuery.ts` exposed generic insert/upsert/delete helpers.

These paths bypass centralized policy, validation, audit, and scope checks.

## Changes

- JSON import now loads data into the current local session only. Production DB import must go through scoped RPC/API.
- Legacy event archive now calls `archive_event_v1`.
- Legacy tournament archive now calls `archive_tournament_v1`.
- Client audit logger no longer inserts into `audit_logs`; server/RPC audit remains canonical.
- Session heartbeat no longer writes to `active_sessions` directly.
- Legacy secure query write helpers now throw and instruct callers to use scoped RPC/API mutations.
- Added migration `040_harden_authenticated_direct_writes.sql` to revoke direct `authenticated` write grants on core tables.

## Migration

`supabase/migrations/enterprise_completion_v1/040_harden_authenticated_direct_writes.sql`

Revokes `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` from `authenticated` on:

- `accounts`
- `account_event_permissions`
- `active_sessions`
- `audit_logs`
- `events`
- `groups`
- `knockout_slots`
- `matches`
- `match_sets`
- `teams`
- `tenants`
- `tournament`

The migration does not revoke `SELECT` or RPC `EXECUTE`.

## Apply Order

1. Test Vercel Preview.
2. Apply migration `040` to Supabase only after preview passes.
3. Re-test auth, workspace, account management, event operations, scoring, and public tournament snapshot.
4. Merge only after production owner approval.

## Verification Queries

```sql
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'authenticated'
  AND table_name IN (
    'accounts',
    'account_event_permissions',
    'active_sessions',
    'audit_logs',
    'events',
    'groups',
    'knockout_slots',
    'matches',
    'match_sets',
    'teams',
    'tenants',
    'tournament'
  )
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
ORDER BY table_name, privilege_type;
```

Expected after apply: zero rows.

## Test Matrix

- Login as `SUPER_ADMIN`.
- Open workspace directory.
- Open a permitted workspace.
- Create/update/archive tournament through existing UI.
- Create/update/archive event through existing UI.
- Add/rename/delete teams through RPC-backed UI.
- Setup groups and generate schedule.
- Enter/reset/finalize scores.
- Open ranking and knockout.
- Open public `/tournament/:slug`.
- Confirm no frontend direct DB write errors in Console/Network.

## Rollback

If a preview/prod flow unexpectedly depends on direct `authenticated` writes:

1. Do not merge the PR.
2. Do not apply migration `040`, or revert only the grant revocation for the affected table.
3. Move the affected flow to a scoped RPC/API before reapplying the grant revocation.

## Status

Ready for preview validation. Migration is included but must not be applied to production until preview tests pass.
