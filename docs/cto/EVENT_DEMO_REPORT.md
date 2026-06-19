# Event Demo Report

## Scope

Prompt 07-G completed event/content management RPCs and created demo events for the clean SaaS demo base.

## Migration

| Migration | Status |
|---|---|
| `supabase/migrations/enterprise_completion_v1/008_event_management_rpcs.sql` | Applied |

## RPCs

All expected RPCs exist. `authenticated` has `EXECUTE`; `anon` does not have `EXECUTE`.

- `list_events_by_tournament_v1`
- `create_event_v1`
- `update_event_v1`
- `archive_event_v1`
- `restore_event_v1`

## Demo Events

Tournament:

- name: `Giải Pickleball Thắng Oanh 2026`
- slug: `thang-oanh`
- id: `tournament-ee121f28-e882-466b-acfc-866179df715a`

Events:

| Name | Event id | Competition | Format | groupCount | scoring |
|---|---|---|---|---:|---|
| Đôi Nam | `evt_6da72de38f5c469d8e829348c92dfde2` | doubles | group_then_knockout | 4 | single set |
| Đôi Nữ | `evt_4b8ff313ce2c43fb8aa796cf6a9da464` | doubles | group_then_knockout | 2 | single set |
| Đôi Nam Nữ | `evt_86d3121231e2486c99590615a11d5407` | doubles | group_then_knockout | 2 | single set |

`mixed_doubles` was not used because the current validation contract supports `singles`, `doubles`, `team`, `individual_time`, and `custom`. `Đôi Nam Nữ` uses `doubles`.

## Safety Checks

| Check | Result |
|---|---:|
| Demo events in `thang-oanh` | 3 |
| Distinct tournament ids across demo events | 1 |
| `teams` count | 0 |
| `groups` count | 0 |
| `matches` count | 0 |
| `auth.users` count | 8 |
| active SUPER_ADMIN count | 1 |

## Frontend Wiring

| Flow | RPC |
|---|---|
| Event list | `list_events_by_tournament_v1` |
| Create event/content | `create_event_v1` |
| Archive event/content | `archive_event_v1` |
| Restore event/content | `restore_event_v1` |

`CreateEventModal` sets `selectedEventId` to the real event id returned by `create_event_v1`.

`useEvents` and `useEventsQuery` read events by `activeTournamentId`, not by tenant id alone.

## Verification

| Command/check | Result |
|---|---|
| SQL RPC existence/grants | Pass |
| SQL demo event state | Pass |
| `npm.cmd run build` | Pass |
| `npm.cmd run lint` | Pass |
| Static scan for direct event write in event UI flow | Pass |

Remaining direct `events.delete` references are in legacy `Dashboard` import/replace paths, not in the "Nội dung thi đấu" management flow.

## Manual Browser Test

Not executed in this turn because no browser-control tool was available in the active toolset.

Expected manual checks:

- Open `/PIC_HUU/admin/workspace/thang-oanh`.
- Open `Nội dung thi đấu`.
- See `Đôi Nam`, `Đôi Nữ`, `Đôi Nam Nữ`.
- Select `Đôi Nam` and `Đôi Nữ`; `selectedEventId` should be the real `evt_...` id.
- No `PLAN_LIMIT_EXCEEDED`.
- URL must not return to `#/11111111...`.

## Readiness

Prompt 07-G is ready for Prompt 07-H.
