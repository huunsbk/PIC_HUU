# Content PDF Requirements - Role Permission Test Report

Date: 2026-06-26

Passwords are intentionally omitted.

## Production Smoke Result

| Account | Role | Route | Result |
| --- | --- | --- | --- |
| Admin | SUPER_ADMIN | `/admin/workspace/thang-oanh` | PASS |
| cocdan | TENANT_ADMIN | `/admin/workspace/coc-dan` | PASS |
| eventcocdan | EVENT_ADMIN | `/admin/workspace/pic-cocdan` | PASS |
| evencocdan2 | EVENT_ADMIN | `/admin/workspace/hoc-sinh` | PASS |
| aa | REFEREE | `/admin/workspace/pic-cocdan` | PASS |
| trongtaicocdan | REFEREE | `/admin/workspace/pic-cocdan` | PASS |
| tt | REFEREE | `/admin/workspace/pic-cocdan` | PASS |

## Observed Permissions

- SUPER_ADMIN: full menu visible, including tenant, tournament, event, account, logs, KO, scoring, export.
- TENANT_ADMIN: tenant-scoped management menus visible; `Quản lý đơn vị` hidden.
- EVENT_ADMIN: event operations visible; account and tenant management hidden.
- REFEREE: narrowed menu visible, centered on score entry, standings, and TV dashboard.

## Console / Network

- No blocking production console errors were observed during role smoke.
- No `ReferenceError`, `Navigate is not defined`, `Chunk load failed`, or app crash was observed.

## Safety

- No password is stored in this report.
- No destructive account, bracket, score, or tournament operation was executed during role smoke.
