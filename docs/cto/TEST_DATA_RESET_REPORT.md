# Test Data Reset Report

## Scope

Reset business test data before applying:

- `005_context_scope_hardening.sql`
- `006_tenant_management_rpcs.sql`
- `007_tournament_management_rpcs.sql`

Protected tables were not reset:

- `auth.users`
- `public.accounts`
- `public.roles`
- `public.permissions`
- `public.role_permissions`
- `public.sports`

## Counts Before Reset

| Schema | Table | Category | Exists | Rows before reset |
|---|---|---|---|---:|
| auth | users | protected | yes | 8 |
| public | accounts | protected | yes | 5 |
| public | permissions | protected | yes | 12 |
| public | role_permissions | protected | yes | 20 |
| public | roles | protected | yes | 5 |
| public | sports | protected | yes | 1 |
| public | tenants | protected | yes | 2 |
| public | account_event_permissions | business | yes | 1 |
| public | audit_logs | business | yes | 45 |
| public | event_knockout_selections | business | yes | 0 |
| public | events | business | yes | 1 |
| public | groups | business | yes | 4 |
| public | invoices | business | yes | 0 |
| public | match_sets | business | yes | 0 |
| public | matches | business | yes | 20 |
| public | payments | business | yes | 0 |
| public | teams | business | yes | 20 |
| public | tenant_subscriptions | business | yes | 0 |
| public | tournament | business | yes | 1 |

## Safety Gate Before Reset

| Check | Result |
|---|---:|
| `auth.users` count | 8 |
| active SUPER_ADMIN count | 1 |
| `public.accounts` count | 5 |
| `public.tenants` count | 2 |
| `public.sports` count | 1 |

Result: reset allowed because active SUPER_ADMIN count is at least 1.

## Reset Execution

Reset command used `DELETE`, not `TRUNCATE CASCADE`.

Deleted business test data in dependency order:

1. `match_sets`
2. `matches`
3. `event_knockout_selections`
4. `groups`
5. `teams`
6. `account_event_permissions`
7. `events`
8. `tournament`
9. `payments`
10. `invoices`
11. `tenant_subscriptions`
12. `audit_logs`

Protected tables were not deleted or modified by the reset script.

## Counts After Reset

| Schema | Table | Category | Exists | Rows after reset |
|---|---|---|---|---:|
| auth | users | protected | yes | 8 |
| public | accounts | protected | yes | 5 |
| public | permissions | protected | yes | 12 |
| public | role_permissions | protected | yes | 20 |
| public | roles | protected | yes | 5 |
| public | sports | protected | yes | 1 |
| public | tenants | protected | yes | 2 |
| public | account_event_permissions | business | yes | 0 |
| public | audit_logs | business | yes | 0 |
| public | event_knockout_selections | business | yes | 0 |
| public | events | business | yes | 0 |
| public | groups | business | yes | 0 |
| public | invoices | business | yes | 0 |
| public | match_sets | business | yes | 0 |
| public | matches | business | yes | 0 |
| public | payments | business | yes | 0 |
| public | teams | business | yes | 0 |
| public | tenant_subscriptions | business | yes | 0 |
| public | tournament | business | yes | 0 |

## Orphan Preflight After Reset

| Check | Count |
|---|---:|
| orphan `events.tournament_id` | 0 |
| orphan `teams.event_id` | 0 |
| orphan `groups.event_id` | 0 |
| orphan `matches.event_id` | 0 |
| orphan `match_sets.event_id` | 0 |
| duplicate active tournament `(tenant_id, slug)` | 0 |
| duplicate tenant slug | 0 |

## Migration Apply Result

| Migration | Result |
|---|---|
| `005_context_scope_hardening.sql` | Applied |
| `006_tenant_management_rpcs.sql` | Applied, then re-applied after adding explicit `REVOKE ... FROM anon` |
| `007_tournament_management_rpcs.sql` | Applied, then re-applied after adding explicit `REVOKE ... FROM anon` |

## RPC And Grant Verification

All expected RPCs exist. `authenticated` has `EXECUTE`; `anon` does not have `EXECUTE`:

- `get_workspace_context_v1`
- `list_tenants_v1`
- `create_tenant_v1`
- `update_tenant_v1`
- `archive_tenant_v1`
- `restore_tenant_v1`
- `list_tournaments_v1`
- `create_tournament_v1`
- `update_tournament_v1`
- `archive_tournament_v1`
- `restore_tournament_v1`

## Final Safety Checks

| Check | Result |
|---|---:|
| `auth.users` count after apply | 8 |
| active SUPER_ADMIN count after apply | 1 |
| `npm.cmd run build` | Pass |
| `npm.cmd run lint` | Pass |

## Manual Test Note

Because business test data was reset, the previous tournament `Thắng Oanh` no longer exists. The route `/PIC_HUU/admin/workspace/thang-oanh` cannot be expected to pass until a new tournament with that slug is created.

Also note: `tenant_subscriptions` was reset to 0. If quota triggers require an active subscription, creating a tournament/event may raise `PLAN_LIMIT_EXCEEDED` until a demo subscription is created in a later prompt.
