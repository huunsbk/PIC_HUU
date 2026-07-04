# Enterprise SaaS Access Architecture V1

Project: PIC_HUU / Tournament Manager Enterprise

Status: Architecture target and design principles

Important notice:

> Tai lieu nay la kien truc dich va nguyen tac thiet ke. Day khong phai prompt trien khai. Khong trien khai toan bo noi dung nay trong mot PR. Moi trien khai phai di theo ENTERPRISE_SAAS_MIGRATION_PLAN_V1.md.

## 1. Executive Summary

PIC_HUU is moving toward an enterprise SaaS model for tournament operations across multiple tenants, tournaments, events, roles, and eventually multiple sports.

The access architecture must solve four core problems:

1. A logged-in account must only enter workspaces it is authorized to access.
2. Workspace access must not imply full permission inside every event.
3. UI visibility must align with effective permissions, but backend/RLS must remain the real enforcement boundary.
4. The system must support future expansion without rewriting the current production permission model in one risky step.

The agreed strategy:

- Use the current production sources in Phase 1: `get_current_profile` and `list_accessible_workspaces_v1`.
- Treat AccessGrant as the target architecture concept now.
- Do not create a physical `access_grants` table in Phase 1.
- Use service/policy boundaries so future contracts such as `effective_access_grants_v1` can be adopted without wide UI rewrites.

## 2. SaaS Domain Model

Core domain objects:

| Object | Responsibility |
|---|---|
| Tenant | Organization/unit that owns tournaments and accounts. |
| Account | Authenticated enterprise user mapped to a role and tenant/scope. |
| Role | Default responsibility class such as SUPER_ADMIN, TENANT_ADMIN, EVENT_ADMIN, REFEREE, VIEWER. |
| Permission | Named capability such as enter_scores, manage_teams, manage_knockout. |
| AccessGrant | Architectural concept describing effective access by subject, action, resource, scope, condition, time, and result. |
| Tournament / Workspace | Operational container for one tournament. |
| Event | Competition content/category inside a tournament. |
| Team / Participant | Competing unit inside an event. |
| Group | Round-robin group within an event. |
| Match | Scheduled match in group stage or knockout. |
| MatchSet | Set-level score record for a match. |
| Standing | Ranking result derived from match outcomes. |
| KnockoutBracket | Bracket and slot structure for knockout rounds. |
| AuditLog | Evidence record for security and business decisions. |

Relationship summary:

```text
Tenant
  -> Account
  -> Tournament / Workspace
      -> Event
          -> Team / Participant
          -> Group
          -> Match
              -> MatchSet
          -> Standing
          -> KnockoutBracket
```

## 3. AccessGrant Concept

AccessGrant is a required architecture concept.

AccessGrant must not be simplified to "role" or "permission". The correct model is:

```text
Subject + Action + Resource + Scope + Condition + Time + Result
```

Example:

```text
Subject:
  tt1

Action:
  enter_scores

Resource:
  match M12

Scope:
  event E1, tournament T1, tenant A

Condition:
  grant is active
  account is active
  event is not archived
  match is not finalized/locked
  tournament is not locked

Time:
  within the active grant window

Result:
  allow / deny
```

Architecture rules:

- AccessGrant answers: does the user have baseline access?
- Business rule answers: is the current operation valid now?
- AccessGrant does not replace business rules.
- AccessGrant does not replace backend RPC enforcement.
- AccessGrant does not replace RLS/constraints.
- A physical `access_grants` table is not created in Phase 1.

Current production can continue using `account_event_permissions` while new code is shaped around the AccessGrant concept.

## 4. `effective_access_grants_v1` Contract

`effective_access_grants_v1` is the medium-term technical contract for effective access.

It may be implemented as:

- a view;
- an RPC;
- a combination of view and RPC.

It is not locked to a database view.

Recommended contract direction:

```text
effective_access_grants_v1
  Internal normalized contract for effective access.

list_my_effective_access_grants_v1()
  RPC returning effective access for the current authenticated user.

can_access_workspace_v1(p_slug)
  Optional read-only guard RPC if existing workspace list data is not sufficient.
```

Frontend rule:

- Frontend should prefer RPCs scoped to the current user.
- Frontend should not query arbitrary permission views directly.
- Frontend should not infer security decisions from local-only data.

## 5. Phase 1 Source of Truth

Phase 1 uses the current production sources:

- `get_current_profile`
- `list_accessible_workspaces_v1`

Optional:

- `can_access_workspace_v1(p_slug)` only if truly needed.

Rules:

- Do not create a physical `access_grants` table.
- Do not create a new permission schema.
- Do not create parallel permission contracts too early.
- Prefer existing contracts unless they force unsafe frontend inference.

## 6. Workspace Access Model

Workspace access confirms only that a user may enter a tournament/workspace.

It does not mean:

- the user can manage every event;
- the user can edit teams/groups/schedule;
- the user can enter scores for every event;
- the user can manage accounts;
- the user can manage knockout brackets.

Workspace access controls the doorway into a tournament/workspace.

Event/action permission controls operations inside the workspace.

Backend RPC/RLS remains the real enforcement boundary.

## 7. Workspace Directory vs Tournament Management

`/admin/workspaces` must be understood as a Workspace Directory for all authenticated accounts that have workspace access.

It is not always Tournament Management.

REFEREE can see:

- assigned tournament/workspace list;
- open workspace button;
- assigned event/match information if available.

REFEREE must not see:

- create tournament;
- update tournament;
- archive tournament;
- hard delete tournament;
- tenant administration;
- system configuration;
- account administration outside allowed scope.

Same route, different capability.

## 8. State Machine

Phase 1 does not require a state machine library.

It does require explicit state names and transition discipline.

State enum:

```text
UNAUTHENTICATED
AUTHENTICATING
PROFILE_LOADING
PROFILE_ERROR
ACCESS_LOADING
WORKSPACE_SELECT_REQUIRED
WORKSPACE_ACCESS_CONFIRMED
WORKSPACE_CONTEXT_LOADING
WORKSPACE_CONTEXT_READY
ACCESS_DENIED
SESSION_REVOKED
```

Core transition:

```text
UNAUTHENTICATED
  -> AUTHENTICATING
  -> PROFILE_LOADING
  -> ACCESS_LOADING
  -> WORKSPACE_SELECT_REQUIRED
  -> WORKSPACE_ACCESS_CONFIRMED
  -> WORKSPACE_CONTEXT_LOADING
  -> WORKSPACE_CONTEXT_READY
```

Error/revocation paths:

```text
PROFILE_LOADING -> PROFILE_ERROR
ACCESS_LOADING -> ACCESS_DENIED
ACCESS_LOADING -> SESSION_REVOKED
WORKSPACE_CONTEXT_READY -> SESSION_REVOKED
```

## 9. Context Rules

The resolver may use:

```text
pendingWorkspaceContext
```

for temporary slug/tenant/tournament checks.

It must not commit active business context before workspace access is confirmed.

Rules:

- Do not commit active workspace context to business store before `WORKSPACE_ACCESS_CONFIRMED`.
- Do not render main business modules before `WORKSPACE_CONTEXT_READY`.
- Commit `activeTenantId`, `activeTournamentId`, and `currentEventId` only after access is confirmed and context is valid.
- `currentEventId` must belong to the accessible events of the current workspace/user.

## 10. Policy Layers

The enterprise access model has four layers:

```text
Frontend Policy = UX guard
Backend RPC Policy = business/security decision
Database RLS / Constraint = data isolation
Audit = evidence layer across critical decisions
```

Meaning:

- Frontend helps users avoid invalid actions.
- Backend decides business validity and permission.
- Database protects data isolation and integrity.
- Audit records important successful and denied decisions.

Frontend policy is not the final security boundary.

## 11. Audit Model

Audit has two major categories:

```text
Security audit
Business audit
```

Security audit examples:

- login_success
- login_failed
- profile_load_failed
- workspace_access_denied
- permission_denied
- permission_granted
- permission_revoked
- session_revoked

Business audit examples:

- team_created
- team_updated
- team_archived
- group_generated
- schedule_generated
- score_updated
- score_finalized
- score_reset
- bracket_created
- bracket_deleted
- knockout_slot_changed

Audit should record both:

- important successful operations;
- important denied operations.

Recommended fields:

```text
category
action
actor_account_id
tenant_id
tournament_id
event_id
entity_type
entity_id
before_data
after_data
result
reason
created_at
```

Phase 1 does not implement full business audit.

## 12. Store Boundary

Phase 1 must not refactor the entire `store.ts`.

Allowed future Phase 1 touch points:

- `setAuthStatus`
- auth/access state
- workspace context setter or wrapper
- selectedTab default after login
- logout/session revoked handling
- `safeSetWorkspaceContext`
- workspace access resolver

Not allowed in Phase 1:

- moving scoring logic;
- moving team/group logic;
- moving knockout logic;
- changing large data shapes;
- rewriting the entire store.

Principle:

```text
Add minimal auth/access guard around the current store.
Do not rewrite the store.
```

## 13. Non-goals

Phase 1 non-goals:

- Do not create a physical `access_grants` table.
- Do not create a new permission schema.
- Do not refactor the entire `store.ts`.
- Do not rewrite scoring.
- Do not rewrite bracket/knockout.
- Do not rewrite team/group/schedule.
- Do not expand multi-sport architecture.
- Do not implement full business audit.
- Do not deploy the entire architecture in one PR.

All implementation must follow `ENTERPRISE_SAAS_MIGRATION_PLAN_V1.md`.
