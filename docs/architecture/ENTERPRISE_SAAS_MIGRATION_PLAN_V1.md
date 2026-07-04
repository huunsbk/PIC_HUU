# Enterprise SaaS Migration Plan V1

Project: PIC_HUU / Tournament Manager Enterprise

Status: phased migration plan, not code implementation

This document controls implementation scope. It exists to prevent the enterprise SaaS access architecture from being implemented as one wide, risky change.

General rules:

- Do not implement code in Phase 0.
- Do not change runtime files in Phase 0.
- Do not create a physical `access_grants` table in Phase 1.
- Do not create a new permission schema in Phase 1.
- Do not refactor the entire `store.ts` in Phase 1.
- Do not modify scoring, bracket, team, group, schedule, or multi-sport rules in Phase 1.
- Every phase must pass its own exit criteria before moving forward.

## Phase 0: Documentation Sign-off

### Goal

Create the official architecture and migration plan documents.

### Scope

- Create `docs/architecture/ENTERPRISE_SAAS_ACCESS_ARCHITECTURE_V1.md`.
- Create `docs/architecture/ENTERPRISE_SAAS_MIGRATION_PLAN_V1.md`.
- Do not change code.
- Do not change database.
- Do not create migrations.

### Files Likely Touched

- `docs/architecture/ENTERPRISE_SAAS_ACCESS_ARCHITECTURE_V1.md`
- `docs/architecture/ENTERPRISE_SAAS_MIGRATION_PLAN_V1.md`

### Files Not Allowed

- `src/**`
- `api/**`
- `server.ts`
- `package.json`
- `vite.config.ts`
- `vercel.json`
- `supabase/migrations/**`
- `supabase/functions/**`

### Exit Criteria

- `ENTERPRISE_SAAS_ACCESS_ARCHITECTURE_V1.md` is created.
- `ENTERPRISE_SAAS_MIGRATION_PLAN_V1.md` is created.
- No runtime files are changed.
- No database files are changed.
- No migration is created.

### Test Matrix

Not applicable. This phase is documentation-only.

Verification:

- `git status --short` shows only documentation files changed/added.

### Rollback Note

Revert the documentation commit if the architecture or migration plan is rejected.

### Risks

- Architecture may be mistaken for an implementation prompt.
- Scope may be interpreted too broadly.

### What Not To Do

- Do not implement Phase 1.
- Do not edit source code.
- Do not edit Supabase migrations.
- Do not change deployment configuration.

## Phase 1: Login / Workspace Guard

### Goal

Standardize login and workspace access so accounts enter only authorized workspaces.

### Source of Truth

Primary:

- `get_current_profile`
- `list_accessible_workspaces_v1`

Optional:

- `can_access_workspace_v1(p_slug)` only if truly needed because existing data is insufficient or unsafe for access decisions.

### Scope

- Add `workspaceAccessService`.
- Add route guard for workspace routes.
- Add safe workspace context commit.
- Redirect wrong workspace URLs to Workspace Directory.
- Ensure REFEREE can see Workspace Directory.
- Add minimal auth/access state.
- Use `pendingWorkspaceContext` if needed.
- Preserve public `/tournament/:slug`.

### Files Likely Touched

- `src/App.tsx`
- `src/store.ts`
- `src/components/AuthModal.tsx`
- `src/components/TournamentWorkspaceListPage.tsx`
- `src/hooks/useTournamentWorkspaces.ts`
- possible new file: `src/lib/auth/workspaceAccessService.ts`
- possible new file: `src/lib/auth/accessState.ts`

If absolutely required:

- one read-only Supabase RPC migration for `can_access_workspace_v1(p_slug)`.

### Files Not Allowed

- scoring components except if only imported types are needed;
- bracket/knockout components;
- team/group/schedule business components;
- multi-sport configuration;
- Vercel/GitHub Pages config;
- package files;
- physical permission schema files;
- migrations that create `access_grants`.

### Exit Criteria

- User opening an unauthorized workspace URL is redirected to Workspace Directory.
- REFEREE sees assigned workspace list.
- REFEREE does not see Tournament Management features.
- Main business modules do not render before `WORKSPACE_CONTEXT_READY`.
- Active context is not committed before `WORKSPACE_ACCESS_CONFIRMED`.
- Refresh URL after permission loss does not keep stale workspace context.
- Public `/tournament/:slug` is not affected.
- `npm run build` passes.
- `npm run lint` passes.
- Vercel Preview passes for login/workspace guard scenarios.

### Test Matrix

| Scenario | Expected Result |
|---|---|
| SUPER_ADMIN opens authorized URL | Enters workspace. |
| SUPER_ADMIN opens existing other workspace | Enters workspace. |
| TENANT_ADMIN opens workspace in tenant | Enters workspace. |
| TENANT_ADMIN opens unauthorized tenant workspace | Redirects to Workspace Directory. |
| EVENT_ADMIN opens assigned workspace | Enters workspace with scoped menu/action visibility. |
| EVENT_ADMIN opens unauthorized workspace | Redirects to Workspace Directory. |
| REFEREE opens assigned workspace | Enters workspace and sees only allowed operations. |
| REFEREE opens unauthorized workspace | Redirects to Workspace Directory. |
| REFEREE opens `/admin/workspaces` | Sees assigned workspace list, not management features. |
| Account has no accessible workspace | Shows clear empty/access message. |
| Permission revoked then reload/route change | Redirects or clears stale context correctly. |
| Public `/tournament/:slug` | Continues to render public snapshot. |

### Rollback Note

Revert the Phase 1 PR if route guard causes login/workspace failures.

Do not rollback by manually editing database permissions.

### Risks

- Incorrect route guard may block valid users.
- Store context may be cleared too aggressively.
- REFEREE may accidentally receive management UI if Workspace Directory and Tournament Management are not separated.
- Public route could be affected if guard is applied too broadly.

### What Not To Do

- Do not create `access_grants`.
- Do not create a new permission schema.
- Do not refactor the entire `store.ts`.
- Do not modify scoring.
- Do not modify bracket/knockout.
- Do not modify team/group/schedule business flows.
- Do not expand multi-sport rules.

## Phase 2: Frontend Permission Policy

### Goal

Standardize menu, button, and action visibility through frontend policy functions.

Frontend policy is a UX guard. It does not replace backend/RLS enforcement.

### Scope

- Add permission policy helpers.
- Replace scattered role checks with named policy functions.
- Separate workspace-level visibility from event/action-level permissions.
- Ensure REFEREE and EVENT_ADMIN only see valid scoped actions.

### Files Likely Touched

- `src/App.tsx`
- `src/components/**` where menu/action visibility is currently checked
- `src/lib/auth/**` or `src/lib/permissions/**`
- `src/store.ts` only for minimal selector/helper integration

### Files Not Allowed

- Supabase schema/migrations unless separately approved.
- Scoring algorithm changes.
- Knockout algorithm changes.
- Data model rewrites.

### Exit Criteria

- Menus align with effective workspace/event permissions.
- Buttons are disabled/hidden according to action policy.
- Backend still blocks direct unauthorized calls.
- Existing authorized actions still work.

### Test Matrix

- SUPER_ADMIN sees full admin operations.
- TENANT_ADMIN sees tenant-scoped management.
- EVENT_ADMIN sees assigned event operations only.
- REFEREE sees scoring/public operations only.
- VIEWER/public sees read-only areas only.

### Rollback Note

Revert Phase 2 PR if authorized users lose required UI access or unauthorized users gain UI access.

### Risks

- UI may hide valid operations if policy mapping is wrong.
- UI may show invalid operations if event-level permission is not checked.

### What Not To Do

- Do not treat frontend policy as security.
- Do not remove backend permission checks.

## Phase 3: Effective Access Contract

### Goal

Standardize the technical contract for effective access using `effective_access_grants_v1` by view, RPC, or a combination.

### Scope

- Define normalized access output.
- Optionally add `list_my_effective_access_grants_v1()`.
- Update existing access list RPCs to read from the normalized contract where safe.
- Keep compatibility with current `account_event_permissions`.

### Files Likely Touched

- `supabase/migrations/**`
- `src/lib/auth/**`
- `src/hooks/useTournamentWorkspaces.ts`
- access-related tests/docs

### Files Not Allowed

- Physical `access_grants` table unless explicitly moved to Phase 6.
- Wide account/event UI rewrites in the same PR.

### Exit Criteria

- Effective access output includes account, scope, permissions, status, and source.
- Existing login/workspace guard still works.
- Existing event permissions still work.
- No migration of production permission data is required.

### Test Matrix

- SUPER_ADMIN implicit access.
- TENANT_ADMIN tenant access.
- EVENT_ADMIN event access.
- REFEREE event access.
- Revoked/deleted/archived grants excluded.

### Rollback Note

Rollback contract migration and code usage together if access results are incorrect.

### Risks

- Contract may diverge from current RPC logic.
- Frontend may read a broader contract than intended.

### What Not To Do

- Do not migrate to a physical `access_grants` table in this phase.
- Do not remove `account_event_permissions`.

## Phase 4: Backend Enforcement Review

### Goal

Review backend RPC/RLS enforcement by business action.

### Scope

- Account create/update/delete/grant/revoke.
- Tournament create/update/archive/restore/hard delete.
- Event create/update/archive/restore/hard delete.
- Team create/update/archive/import.
- Group setup/assign/dissolve.
- Schedule generate/delete/status changes.
- Score update/finalize/reset.
- Standing and knockout management.
- TV/public snapshot access.

### Files Likely Touched

- `supabase/migrations/**`
- `src/lib/api/**`
- targeted UI files only when backend contract requires changed calls

### Files Not Allowed

- Unrelated UI redesign.
- Multi-sport rewrite.
- Full store rewrite.

### Exit Criteria

- Every mutation has a backend permission check.
- RLS/constraints protect tenant/event isolation where applicable.
- Unauthorized direct calls are rejected.
- Authorized calls still succeed.

### Test Matrix

- Role-by-role action tests.
- Cross-tenant denial tests.
- Cross-event denial tests.
- Archived/deleted object denial tests.

### Rollback Note

Rollback individual enforcement migrations if they block valid production workflows.

### Risks

- Over-strict enforcement can break valid workflows.
- Under-specified action mapping can leave gaps.

### What Not To Do

- Do not change unrelated frontend layout.
- Do not bundle audit standardization into every enforcement PR unless scoped.

## Phase 5: Audit Standardization

### Goal

Standardize security and business audit records.

### Scope

- Security audit:
  - login_success
  - login_failed
  - profile_load_failed
  - workspace_access_denied
  - permission_denied
  - permission_granted
  - permission_revoked
  - session_revoked
- Business audit:
  - score_updated
  - score_finalized
  - score_reset
  - bracket_created
  - bracket_deleted
  - team/group/schedule operations as needed

### Files Likely Touched

- `supabase/migrations/**`
- RPC functions that perform critical actions
- audit display/reporting components if needed

### Files Not Allowed

- Physical access grant migration.
- Unrelated UI redesign.

### Exit Criteria

- Critical success and denial events are auditable.
- Audit records have category/action/entity/result/reason where applicable.
- Audit volume is controlled.

### Test Matrix

- Successful login/access.
- Denied workspace access.
- Permission grant/revoke.
- Score update/finalize/reset.
- Bracket create/delete.

### Rollback Note

Rollback audit-only changes if they cause runtime errors or excessive write load.

### Risks

- Audit volume can grow quickly.
- Sensitive values must not be logged.

### What Not To Do

- Do not log passwords, tokens, service role keys, or secrets.
- Do not log excessive raw payloads by default.

## Phase 6: Optional Physical `access_grants` Migration

### Goal

Create a physical generalized `access_grants` model only if production needs justify it.

### Scope

- Design physical table.
- Add compatibility layer.
- Migrate existing grants.
- Keep old contracts working during transition.
- Full regression test.

### Files Likely Touched

- `supabase/migrations/**`
- access/profile/workspace RPCs
- account management UI
- permission policy code

### Files Not Allowed

- One-step removal of `account_event_permissions`.
- Migration without rollback/compatibility plan.

### Exit Criteria

- Production access behavior is unchanged from the user perspective.
- Data migration is verified.
- Compatibility layer works.
- Full role regression passes.

### Test Matrix

- All roles.
- All scopes.
- Revoked grants.
- Archived objects.
- Multi-tenant isolation.
- Existing event permissions.

### Rollback Note

Rollback requires compatibility preservation. Do not hard-cut from `account_event_permissions` without a tested rollback path.

### Risks

- Highest-risk phase.
- Data migration bugs can block production access.
- Wide regression surface.

### What Not To Do

- Do not run this phase until production access flow is stable.
- Do not combine this phase with UI redesign or scoring changes.
