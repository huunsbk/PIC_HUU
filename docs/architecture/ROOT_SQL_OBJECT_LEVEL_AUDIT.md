# Root SQL Object-Level Audit - PIC_HUU

## Summary

This pass performed an object-level inventory of the remaining root-level SQL files and compared extracted objects against official SQL under `supabase/migrations/`.

No SQL was executed.

Generated evidence files:

- `docs/architecture/root_sql_objects.csv`
- `docs/architecture/migration_sql_objects.csv`
- `docs/architecture/root_sql_object_match_summary.csv`

## GitHub CLI Status

`gh` was installed successfully with winget:

```text
GitHub CLI 2.95.0
```

Authentication is still blocked because this machine is not logged in to GitHub CLI:

```text
You are not logged into any GitHub hosts. To log in, run: gh auth login
```

Until the owner completes `gh auth login`, PR creation from CLI remains blocked.

## Method

The audit extracted these SQL object categories:

- `CREATE FUNCTION`
- `CREATE TABLE`
- `CREATE VIEW`
- `CREATE POLICY`
- `CREATE TRIGGER`
- `CREATE INDEX`
- `ALTER TABLE`
- `DROP ...`

The extracted root objects were compared against extracted objects from:

```text
supabase/migrations/**/*.sql
```

This comparison is intentionally conservative. Exact object-name matches are useful evidence, but lack of exact match does not prove a file is obsolete.

## Files Archived In This Pass

| Original Path | New Path | Evidence | Decision |
|---|---|---|---|
| `migration_get_profile.sql` | `docs/archive/legacy-sql/superseded-by-migrations/migration_get_profile.sql` | Exact function match: `get_current_profile`; official migration `supabase/migrations/enterprise_completion_v1/026_event_scoped_effective_permissions.sql` recreates `public.get_current_profile()` | Archive |
| `supabase_knockout_schema.sql` | `docs/archive/legacy-sql/superseded-by-migrations/supabase_knockout_schema.sql` | Exact `ALTER TABLE matches` object match and newer official knockout/match migrations manage current KO schema: `012_score_schedule_knockout_fix.sql`, `018-023` KO migrations, `033/036` scoring migrations | Archive |

## Files Kept At Root

These files remain at root because exact-match evidence was not strong enough to archive safely.

| File | Object Count | Matched In Migrations | Match Ratio | Decision |
|---|---:|---:|---:|---|
| `ENTERPRISE_ACCOUNT_SQL.sql` | 28 | 0 | 0.00 | Keep pending DB diff |
| `ENTERPRISE_ACCOUNT_SQL_v2.sql` | 31 | 0 | 0.00 | Keep pending DB diff |
| `ENTERPRISE_RLS_FINAL.sql` | 22 | 5 | 0.23 | Keep pending RLS policy diff |
| `RLS_DEPLOYMENT_SQL.sql` | 35 | 3 | 0.09 | Keep pending RLS policy diff |
| `SUPABASE_SCHEMA_REFERENCE.sql` | 19 | 0 | 0.00 | Keep until fresh schema snapshot replaces it |
| `enterprise_v4.sql` | 41 | 7 | 0.17 | Keep pending schema diff |
| `enterprise_v5_tournament_manager.sql` | 2 | 0 | 0.00 | Keep pending function/index comparison |
| `final_architecture_updates.sql` | 13 | 0 | 0.00 | Keep pending object-by-object review |
| `migration.sql` | 32 | 8 | 0.25 | Keep due generic/high-ambiguity migration name |
| `migration_event_management.sql` | 4 | 1 | 0.25 | Keep pending comparison with event migrations |
| `migration_phase4.sql` | 27 | 0 | 0.00 | Keep pending phase comparison |
| `migration_phase5.sql` | 37 | 0 | 0.00 | Keep pending phase comparison |
| `migration_rbac.sql` | 3 | 1 | 0.33 | Keep pending RBAC/permission diff |
| `migration_rls_enterprise.sql` | 10 | 4 | 0.40 | Keep pending RLS diff |
| `migration_rls_perms.sql` | 6 | 1 | 0.17 | Keep pending permission RLS diff |
| `migration_safe_v4.sql` | 36 | 2 | 0.06 | Keep pending schema diff |
| `migration_v5_2.sql` | 18 | 2 | 0.11 | Keep pending schema diff |
| `migration_v5_3.sql` | 5 | 0 | 0.00 | Keep pending function/index comparison |
| `migration_v5_4.sql` | 9 | 0 | 0.00 | Keep pending function/index comparison |
| `migration_v5_5.sql` | 7 | 2 | 0.29 | Keep pending function/index comparison |
| `migration_v5_6.sql` | 6 | 1 | 0.17 | Keep pending function comparison |
| `PHASE_1_SAFE_FIXES.sql` | 13 | 5 | 0.38 | Keep pending hardening diff |
| `PHASE_2_TENANT_ISOLATION.sql` | 6 | 0 | 0.00 | Keep pending tenant-isolation diff |
| `PHASE_3_PERMISSION_HARDENING.sql` | 10 | 0 | 0.00 | Keep pending permission diff |
| `PHASE_4_PRODUCTION_LOCKDOWN.sql` | 18 | 7 | 0.39 | Keep pending production-lockdown diff |
| `rpc_create_event_admin.sql` | 1 | 0 | 0.00 | Keep pending RPC signature diff |
| `rpc_record_login.sql` | 1 | 0 | 0.00 | Keep pending RPC signature diff |
| `supabase_fk_cascade.sql` | 2 | 1 | 0.50 | Keep because only partial exact match |
| `supabase_rpc.sql` | 1 | 0 | 0.00 | Keep pending RPC comparison |
| `supabase_setup.sql` | 44 | 5 | 0.11 | Keep pending schema diff |
| `supabase_trigger_knockout.sql` | 3 | 0 | 0.00 | Keep pending trigger/function comparison |
| `supabase_view_standings.sql` | 1 | 0 | 0.00 | Keep pending view comparison |

## Risk Notes

- Exact match on one object is not enough for large SQL files that also modify many unmatched objects.
- RLS/policy files require manual review against live Supabase policies, not only text comparison.
- Generic files such as `migration.sql` are high ambiguity and should not be archived without a full object inventory sign-off.

## Next Recommended Step

Complete a live-schema comparison against Supabase:

1. Export current live schema object list from Supabase.
2. Compare remaining root SQL object names against live tables/functions/policies/triggers/indexes.
3. Archive files only when every meaningful object is confirmed to exist in official migrations or live schema.
4. After the owner logs in with `gh auth login`, create PRs through GitHub CLI instead of bypass-pushing `main`.
