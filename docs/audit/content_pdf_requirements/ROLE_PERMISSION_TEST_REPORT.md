# Content PDF Requirements - Role Permission Test Report

Date: 2026-06-26

Passwords are intentionally omitted.

## Accounts To Test

| Account | Role | Status |
| --- | --- | --- |
| Admin | SUPER_ADMIN | Pending production E2E |
| cocdan | TENANT_ADMIN | Pending production E2E |
| eventcocdan | EVENT_ADMIN | Pending production E2E |
| evencocdan2 | EVENT_ADMIN | Pending production E2E |
| aa | REFEREE | Pending production E2E |
| trongtaicocdan | REFEREE | Pending production E2E |
| tt | REFEREE | Pending production E2E |

## Permission Expectations

- SUPER_ADMIN: all management menus and operations.
- TENANT_ADMIN: tenant-scoped tournament/event/account operations.
- EVENT_ADMIN: event-scoped team/group/match/score operations where granted.
- REFEREE: score entry only for granted events.

## Result

CHUA DAT BAN GIAO PRODUCTION

Role E2E must be completed on the production deployment after main deploy.
