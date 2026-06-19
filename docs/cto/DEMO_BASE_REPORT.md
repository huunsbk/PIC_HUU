# Demo Base Report

## Scope

Prompt 07-BASE created a clean SaaS demo foundation after business data reset and migrations 005-006-007.

No database reset was performed in this step. No `auth.users`, `accounts`, `roles`, `permissions`, `role_permissions`, or `sports` rows were deleted.

## Demo Tenant

| Field | Value |
|---|---|
| name | `CLB Thắng Oanh` |
| slug | `clb-thang-oanh` |
| id | `49fdb58c-1c70-4bb6-8ffc-d6ffe711195b` |
| status | `active` |
| creation path | `create_tenant_v1` if missing; reused if already present |

## Demo Subscription

| Field | Value |
|---|---|
| tenant | `CLB Thắng Oanh` |
| status | `active` |
| plan | `Enterprise` |
| plan_id | `8e88d676-023d-4861-82d9-addd1b4d5783` |
| end_date | current time + 1 year |
| creation path | direct insert into `tenant_subscriptions` |

Reason for direct insert: no billing/subscription RPC exists yet. The insert was scoped only to the demo tenant and used an existing active `subscription_plans` row.

## Demo Tournament

| Field | Value |
|---|---|
| name | `Giải Pickleball Thắng Oanh 2026` |
| slug | `thang-oanh` |
| id | `tournament-ee121f28-e882-466b-acfc-866179df715a` |
| tenant_id | `49fdb58c-1c70-4bb6-8ffc-d6ffe711195b` |
| location | `CLB Thắng Oanh` |
| start_date | `2026-06-30` |
| creation path | `create_tournament_v1` if missing; reused if already present |

## Data Intentionally Not Created

| Table | Count |
|---|---:|
| `events` | 0 |
| `teams` | 0 |

Events, teams, groups, and matches are intentionally left empty for Prompt 07-G.

## RPC Verification

`get_workspace_context_v1('thang-oanh')` returned:

```json
{
  "tenant_id": "49fdb58c-1c70-4bb6-8ffc-d6ffe711195b",
  "tenant_name": "CLB Thắng Oanh",
  "tournament_id": "tournament-ee121f28-e882-466b-acfc-866179df715a",
  "tournament_name": "Giải Pickleball Thắng Oanh 2026",
  "tournament_slug": "thang-oanh",
  "user_role": "SUPER_ADMIN",
  "permissions": ["*"]
}
```

`list_tenants_v1` includes `CLB Thắng Oanh`.

`list_tournaments_v1` includes `Giải Pickleball Thắng Oanh 2026`.

## Safety Checks

| Check | Result |
|---|---:|
| `auth.users` count | 8 |
| active SUPER_ADMIN count | 1 |
| demo tenant count | 1 |
| demo tournament count | 1 |
| demo active subscription count | 1 |

## Build And Lint

| Command | Result |
|---|---|
| `npm.cmd run build` | Pass, existing chunk-size warning remains |
| `npm.cmd run lint` | Pass |

## Manual Browser Test

Not executed in this turn because no browser-control tool was available in the active toolset.

Expected manual checks:

- Login SUPER_ADMIN.
- Open `Quản lý đơn vị`: see `CLB Thắng Oanh`.
- Open `Quản lý giải đấu`: see `Giải Pickleball Thắng Oanh 2026`.
- Open `/PIC_HUU/admin/workspace/thang-oanh`.
- URL must not return to `#/11111111...`.
- Header shows Đơn vị / Giải / Nội dung thi đấu.
- Nội dung thi đấu shows an empty/no-content state.

## Readiness

The SaaS demo base is ready for Prompt 07-G.

## Prompt 07-G Event Demo Update

Prompt 07-G created the first demo event/content rows for tournament `thang-oanh`:

| Name | Event id | groupCount | scoring |
|---|---|---:|---|
| Đôi Nam | `evt_6da72de38f5c469d8e829348c92dfde2` | 4 | single set |
| Đôi Nữ | `evt_4b8ff313ce2c43fb8aa796cf6a9da464` | 2 | single set |
| Đôi Nam Nữ | `evt_86d3121231e2486c99590615a11d5407` | 2 | single set |

No teams, groups, or matches were created in Prompt 07-G.
