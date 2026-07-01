# Root SQL Cleanup Audit - PIC_HUU

## Summary

This audit reviews SQL files that were located at the repository root after the first cleanup pass.

Production-safe rules used:

- No Supabase production migration was run.
- No official migration under `supabase/migrations/` was moved.
- No Supabase Edge Function was changed.
- Root SQL files were not deleted.
- Only low-risk manual/debug SQL files were archived away from root.
- Large historical SQL files remain in root until a DB diff or migration-by-migration comparison confirms they are fully superseded.

## Evidence Checked

- `package.json`: no root SQL file is called by npm scripts.
- `vite.config.ts`: no root SQL file is used by Vite.
- `vercel.json`: no root SQL file is used by Vercel.
- `.github/workflows/deploy.yml`: no root SQL file is used by GitHub Actions.
- `src/`, `api/`, `scripts/`, `supabase/`, `docs/`: search found references mostly in historical docs/archive, not runtime imports.
- `supabase/migrations/`: official migrations remain the source of truth.

## Archived In This Pass

These files were moved because they are manual/debug/rollback/verification SQL and have high risk if left in the root where they can be executed by mistake.

| Original Path | New Path | Reason | Production Risk |
|---|---|---|---|
| `debug_accounts.sql` | `docs/archive/legacy-sql/debug-sql/debug_accounts.sql` | Manual diagnostic SQL | High if executed against production |
| `debug_active_sessions.sql` | `docs/archive/legacy-sql/debug-sql/debug_active_sessions.sql` | Manual diagnostic SQL | High |
| `debug_auth_accounts.sql` | `docs/archive/legacy-sql/debug-sql/debug_auth_accounts.sql` | Manual diagnostic SQL | High |
| `debug_login_logs.sql` | `docs/archive/legacy-sql/debug-sql/debug_login_logs.sql` | Manual diagnostic SQL | High |
| `debug_trigger.sql` | `docs/archive/legacy-sql/debug-sql/debug_trigger.sql` | Manual diagnostic SQL | High |
| `bypass_user_limit.sql` | `docs/archive/legacy-sql/debug-sql/bypass_user_limit.sql` | Manual bypass SQL, not a migration | Critical if executed unintentionally |
| `rollback.sql` | `docs/archive/legacy-sql/rollback/rollback.sql` | Rollback SQL should not live in root | High |
| `rollback_phase5.sql` | `docs/archive/legacy-sql/rollback/rollback_phase5.sql` | Rollback SQL should not live in root | High |
| `auth_verification.sql` | `docs/archive/legacy-sql/manual-verification/auth_verification.sql` | Manual verification SQL | Medium |
| `production_verification.sql` | `docs/archive/legacy-sql/manual-verification/production_verification.sql` | Manual verification SQL | Medium |
| `verification_phase5.sql` | `docs/archive/legacy-sql/manual-verification/verification_phase5.sql` | Manual verification SQL | Medium |
| `fix_login_logs_rls.sql` | `docs/archive/legacy-sql/manual-fixes/fix_login_logs_rls.sql` | Manual fix SQL, not official migration path | High |
| `fix_rls_login.sql` | `docs/archive/legacy-sql/manual-fixes/fix_rls_login.sql` | Manual fix SQL, not official migration path | High |
| `sync_missing_accounts.sql` | `docs/archive/legacy-sql/manual-fixes/sync_missing_accounts.sql` | Manual data repair SQL | High |
| `performance_indexes.sql` | `docs/archive/legacy-sql/index-proposals/performance_indexes.sql` | Index proposal superseded by dedicated index hardening migration track | Medium |
| `proposed_hardening_indexes_v5.7.sql` | `docs/archive/legacy-sql/index-proposals/proposed_hardening_indexes_v5.7.sql` | Proposal file; official path is `supabase/migrations/phase_3a_index_hardening_v57_staging.sql` | Medium |

## Kept At Root For Now

These files are still root-level SQL debt, but they were not moved in this pass because they appear to be large historical schema/migration snapshots or potentially important migration drafts. They need DB-level diff before archive.

| Path | Current Classification | Reason To Keep Pending | Next Check |
|---|---|---|---|
| `ENTERPRISE_ACCOUNT_SQL.sql` | Pending archive | Large account schema/history SQL | Compare tables/functions against migrations 001, 003, 011, 024-031 |
| `ENTERPRISE_ACCOUNT_SQL_v2.sql` | Pending archive | Large account schema/history SQL | Compare against official account/permission migrations |
| `ENTERPRISE_RLS_FINAL.sql` | Pending archive | Historical RLS final script | Compare policies/functions against current RLS migrations |
| `enterprise_v4.sql` | Pending archive | Historical enterprise schema | Compare object list against `enterprise_completion_v1` |
| `enterprise_v5_tournament_manager.sql` | Pending archive | Historical tournament schema | Compare with migrations 006-008 |
| `final_architecture_updates.sql` | Pending archive | Historical architecture update SQL | Extract function/table names before archive |
| `migration.sql` | Pending archive | Generic migration name, high ambiguity | Compare object names before archive |
| `migration_event_management.sql` | Pending archive | Event management draft | Compare with migration 008 |
| `migration_get_profile.sql` | Pending archive | Profile RPC/auth draft | Compare with auth/account migrations |
| `migration_phase4.sql` | Pending archive | Historical phase SQL | Compare against official migrations |
| `migration_phase5.sql` | Pending archive | Historical phase SQL | Compare against official migrations |
| `migration_rbac.sql` | Pending archive | RBAC draft | Compare against permission migrations |
| `migration_rls_enterprise.sql` | Pending archive | RLS draft | Compare against RLS migrations |
| `migration_rls_perms.sql` | Pending archive | Permission RLS draft | Compare against permission migrations |
| `migration_safe_v4.sql` | Pending archive | Historical safe migration | Compare against official migrations |
| `migration_v5_2.sql` | Pending archive | Historical v5 migration | Compare object names |
| `migration_v5_3.sql` | Pending archive | Historical v5 migration | Compare object names |
| `migration_v5_4.sql` | Pending archive | Historical v5 migration | Compare object names |
| `migration_v5_5.sql` | Pending archive | Historical v5 migration | Compare object names |
| `migration_v5_6.sql` | Pending archive | Historical v5 migration | Compare object names |
| `PHASE_1_SAFE_FIXES.sql` | Pending archive | Phase hardening script | Compare against official hardening migrations |
| `PHASE_2_TENANT_ISOLATION.sql` | Pending archive | Tenant isolation script | Compare against context/tenant migrations |
| `PHASE_3_PERMISSION_HARDENING.sql` | Pending archive | Permission hardening script | Compare against migrations 024-031 |
| `PHASE_4_PRODUCTION_LOCKDOWN.sql` | Pending archive | Production lockdown script | Compare against current RLS/security state |
| `RLS_DEPLOYMENT_SQL.sql` | Pending archive | RLS deployment script | Compare policies/functions against current DB |
| `rpc_create_event_admin.sql` | Pending archive | RPC draft | Compare against account/event admin migrations |
| `rpc_record_login.sql` | Pending archive | RPC draft | Compare against login/session migrations |
| `supabase_fk_cascade.sql` | Pending archive | FK/cascade schema draft | Compare with current DB constraints |
| `supabase_knockout_schema.sql` | Pending archive | KO schema draft | Compare with KO migrations 018-023 |
| `supabase_rpc.sql` | Pending archive | RPC draft | Compare with current RPC list |
| `SUPABASE_SCHEMA_REFERENCE.sql` | Pending archive | Schema snapshot/reference | Keep until a fresh schema reference replaces it |
| `supabase_setup.sql` | Pending archive | Setup/schema draft | Compare with current DB state |
| `supabase_trigger_knockout.sql` | Pending archive | KO trigger draft | Compare with KO slot migrations |
| `supabase_view_standings.sql` | Pending archive | Standings view draft | Compare with scoring/standings migrations |

## Do Not Touch

- `supabase/migrations/`
- `supabase/functions/`
- `supabase/hotfixes/`
- `supabase/diagnostics/`
- `supabase/audit/`

## Next SQL Cleanup Step

The next safe step is to generate an object inventory for each remaining root SQL file:

- tables created/altered
- functions created/replaced
- policies created/altered
- triggers created/altered
- indexes created

Then compare that inventory against `supabase/migrations/enterprise_completion_v1/` and the live Supabase schema. Only after that comparison should the remaining root SQL files be archived.
