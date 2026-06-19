# Referee Access Report

## Prompt 07-H Summary

Date: 2026-06-19

Scope:

- Standardized event-scoped referee access through `account_event_permissions`.
- Did not create a `referees` table.
- Did not create or delete `auth.users`.
- Did not reset business data.

## SQL Changes

Migration created and applied:

- `supabase/migrations/enterprise_completion_v1/009_event_access_referee_rpcs.sql`

Migration changes:

- Added compatible columns to `account_event_permissions` when missing:
  - `tenant_id`
  - `permission`
- Backfilled existing event grants from `events.tenant_id`.
- Soft-deleted active event grants for roles outside `REFEREE` and `EVENT_ADMIN`.
- Added active indexes and unique active permission index.
- Added helper `ensure_manage_event_access_v1(p_event_id text)`.
- Added/standardized RPCs:
  - `list_event_access_v1(p_event_id text)`
  - `grant_event_access_v1(p_event_id text, p_account_id text, p_permission text)`
  - `revoke_event_access_v1(p_event_id text, p_account_id text, p_permission text)`

## RPC Verification

Post-apply SQL verification:

| RPC | Exists | authenticated EXECUTE | anon EXECUTE |
|---|---:|---:|---:|
| `list_event_access_v1(text)` | Yes | Yes | No |
| `grant_event_access_v1(text,text,text)` | Yes | Yes | No |
| `revoke_event_access_v1(text,text,text)` | Yes | Yes | No |

Security rules:

- Caller must be authenticated.
- Caller must have `manage_events` or `*` in the valid tenant/event scope.
- Target account must be active and in the same tenant as the event.
- Target role must be `REFEREE` or `EVENT_ADMIN`.
- `REFEREE` can only receive `enter_scores`.
- Grant/revoke writes audit logs.

## Demo Referee Status

Demo tournament:

- `thang-oanh`

Demo events:

- Đôi Nam: `evt_6da72de38f5c469d8e829348c92dfde2`
- Đôi Nữ: `evt_4b8ff313ce2c43fb8aa796cf6a9da464`
- Đôi Nam Nữ: `evt_86d3121231e2486c99590615a11d5407`

SQL found no active `REFEREE` account inside the demo tenant `CLB Thắng Oanh`.

Therefore:

- No demo referee grant was created.
- No `auth.users` record was created.
- Đôi Nam grant count remains `0`.
- Đôi Nữ grant count remains `0`.

Existing active REFEREE account `tt` belongs to another tenant and was not granted access because cross-tenant grants are blocked.

## Frontend Wiring

Updated UI:

- `src/components/event-card.tsx`
- `src/components/event-members-manager.tsx`
- `src/components/use-events-query.ts`
- `src/lib/api/tournamentRpc.ts`

UI location:

- In the "Nội dung thi đấu" card, click the user icon titled `Cấp quyền trọng tài`.

Modal behavior:

- Reads current event access through `list_event_access_v1`.
- Shows eligible `REFEREE` / `EVENT_ADMIN` accounts from the event tenant.
- Defaults permission to `enter_scores`.
- Grants access through `grant_event_access_v1`.
- Revokes access through `revoke_event_access_v1`.
- Does not use a global `refereeId` context.

## Safety Checks

| Check | Result |
|---|---|
| `auth.users` count | 8 |
| active SUPER_ADMIN count | 1 |
| No direct insert/update/delete into `account_event_permissions` in new UI flow | Pass |
| `rg "EVENT_MANAGER" src` | No results |
| `npm.cmd run build` | Pass |
| `npm.cmd run lint` | Pass |

Known remaining note:

- `src/components/TournamentCard.tsx` still reads `account_event_permissions` from a legacy display shape. It does not write event access and is outside the Prompt 07-H grant/revoke modal flow.
