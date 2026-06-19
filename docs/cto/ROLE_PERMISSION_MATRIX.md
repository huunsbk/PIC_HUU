# Role Permission Matrix

## Standard Roles

| Role | Scope | Purpose |
|---|---|---|
| SUPER_ADMIN | Global | Full system administration. |
| TENANT_ADMIN | Tenant | Manage accounts, tournaments, events, teams, groups, matches, billing, and audit visibility inside the tenant. |
| EVENT_ADMIN | Assigned event | Manage event operations only for events granted through `account_event_permissions`. |
| REFEREE | Assigned event | Enter scores for assigned events and view public information. |
| VIEWER | Public/read-only | View public information only. |

## Standard Permissions

| Permission | Meaning |
|---|---|
| `*` | All permissions. |
| `manage_tenants` | Manage tenant-level records and tenant settings. |
| `manage_accounts` | Manage accounts within allowed scope. |
| `manage_tournaments` | Manage tournament workspaces. |
| `manage_events` | Manage competition events within allowed scope. |
| `manage_teams` | Manage teams within allowed scope. |
| `manage_groups` | Manage groups within allowed scope. |
| `manage_matches` | Manage matches and brackets within allowed scope. |
| `enter_scores` | Enter and reset scores within allowed scope. |
| `view_audit_logs` | View audit logs within allowed scope. |
| `view_public` | View public tournament information. |
| `manage_billing` | Manage billing within allowed scope. |

## Matrix

| Permission | SUPER_ADMIN | TENANT_ADMIN | EVENT_ADMIN | REFEREE | VIEWER |
|---|---:|---:|---:|---:|---:|
| `*` | Yes | No | No | No | No |
| `manage_tenants` | Via `*` | No | No | No | No |
| `manage_accounts` | Via `*` | Yes | No | No | No |
| `manage_tournaments` | Via `*` | Yes | No | No | No |
| `manage_events` | Via `*` | Yes | Yes, assigned event only | No | No |
| `manage_teams` | Via `*` | Yes | Yes, assigned event only | No | No |
| `manage_groups` | Via `*` | Yes | Yes, assigned event only | No | No |
| `manage_matches` | Via `*` | Yes | Yes, assigned event only | No | No |
| `enter_scores` | Via `*` | Yes | Yes, assigned event only | Yes, assigned event only | No |
| `view_audit_logs` | Via `*` | Yes | No | No | No |
| `view_public` | Via `*` | Yes | Yes | Yes | Yes |
| `manage_billing` | Via `*` | Yes | No | No | No |

## Test Plan By Role

| Role | Test |
|---|---|
| SUPER_ADMIN | Log in and confirm dashboard/workspaces/accounts/logs are visible; SQL verifies role has `*`. |
| TENANT_ADMIN | Log in with a tenant-admin account and confirm data is limited to its tenant; verify no cross-tenant rows are visible. |
| EVENT_ADMIN | Grant one event through `account_event_permissions`; confirm event operations work only for that event. With no event grant, event operations must be denied. |
| REFEREE | Grant one event through `account_event_permissions`; confirm score entry works only for that event and team/group management is denied. |
| VIEWER | Confirm only public views are available and administrative RPCs are denied. |

## Current Prompt 03 Notes

- `EVENT_MANAGER` is removed from `src`.
- Runtime login checks for TENANT_ADMIN and VIEWER require actual auth users with those roles. Prompt 03 does not create or delete `auth.users`.
## Prompt 07-E Tenant Management Notes

| Action | SUPER_ADMIN | TENANT_ADMIN | EVENT_ADMIN | REFEREE | VIEWER |
|---|---|---|---|---|---|
| List tenants | Yes | No | No | No | No |
| Create tenant | Yes | No | No | No | No |
| Update tenant | Yes | No | No | No | No |
| Archive/restore tenant | Yes | No | No | No | No |

Tenant management RPCs still perform server-side permission checks even though the UI only shows `Quản lý đơn vị` to SUPER_ADMIN.

## Prompt 07-H Event Access Notes

Event-scoped access uses `account_event_permissions`, not a separate `referees` table.

| Event access action | SUPER_ADMIN | TENANT_ADMIN | EVENT_ADMIN | REFEREE | VIEWER |
|---|---:|---:|---:|---:|---:|
| List event access | Yes | Yes, same tenant | Yes, assigned event and `manage_events` | No | No |
| Grant `enter_scores` to REFEREE | Yes | Yes, same tenant | Yes, assigned event and `manage_events` | No | No |
| Grant event management to EVENT_ADMIN | Yes | Yes, same tenant | Yes, assigned event and `manage_events` | No | No |
| Revoke event access | Yes | Yes, same tenant | Yes, assigned event and `manage_events` | No | No |

Validation rules:

- Target account must be active and in the same tenant as the event.
- Target role must be `REFEREE` or `EVENT_ADMIN`.
- `REFEREE` can only receive `enter_scores`.
- `anon` has no execute grant on event-access admin RPCs.
- `authenticated` has execute grant, but RPCs enforce role/tenant/event checks internally.
