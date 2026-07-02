# Live Schema And Legacy Cleanup Report - PIC_HUU

## Summary

This pass completed the next cleanup stage after the root SQL object audit.

Actions completed:

- Installed GitHub CLI (`gh`) on the machine.
- Confirmed `gh` is not authenticated yet and still requires owner login.
- Queried live Supabase metadata in read-only mode.
- Generated live-schema comparison CSV files.
- Archived root SQL files with 100% live-schema object match.
- Removed unused AI Studio/Gemini dependency from `package.json` and `package-lock.json`.
- Replaced AI Studio `.env.example` content with production Supabase-oriented env placeholders.
- Removed the remaining AI Studio wording from `vite.config.ts` comments.

No SQL was executed.

## GitHub CLI

Installed:

```text
gh 2.95.0
```

Current blocker:

```text
gh auth login
```

The owner must authenticate GitHub CLI before PR creation can happen without connector 403 errors or main-branch bypass pushes.

## Live Schema Evidence

Generated files:

- `docs/architecture/live_schema_objects.csv`
- `docs/architecture/root_sql_live_match_details.csv`
- `docs/architecture/root_sql_live_match_summary.csv`

Read-only metadata result:

- Live public schema objects found: 296
- Root SQL files compared before this pass: 32

## SQL Archived In This Pass

Archived to:

```text
docs/archive/legacy-sql/live-schema-confirmed/
```

Files:

- `SUPABASE_SCHEMA_REFERENCE.sql`
- `migration_event_management.sql`
- `migration_rbac.sql`
- `migration_v5_6.sql`
- `rpc_create_event_admin.sql`
- `supabase_fk_cascade.sql`
- `supabase_rpc.sql`

Reason: extracted SQL objects from these files had a 100% match against live Supabase public schema metadata. The files are kept in archive, not deleted.

## SQL Still Kept At Root

These remain because live-schema match is incomplete, or because RLS/policy semantics need manual review:

- `ENTERPRISE_ACCOUNT_SQL.sql`
- `ENTERPRISE_ACCOUNT_SQL_v2.sql`
- `ENTERPRISE_RLS_FINAL.sql`
- `PHASE_1_SAFE_FIXES.sql`
- `PHASE_2_TENANT_ISOLATION.sql`
- `PHASE_3_PERMISSION_HARDENING.sql`
- `PHASE_4_PRODUCTION_LOCKDOWN.sql`
- `RLS_DEPLOYMENT_SQL.sql`
- `enterprise_v4.sql`
- `enterprise_v5_tournament_manager.sql`
- `final_architecture_updates.sql`
- `migration.sql`
- `migration_phase4.sql`
- `migration_phase5.sql`
- `migration_rls_enterprise.sql`
- `migration_rls_perms.sql`
- `migration_safe_v4.sql`
- `migration_v5_2.sql`
- `migration_v5_3.sql`
- `migration_v5_4.sql`
- `migration_v5_5.sql`
- `rpc_record_login.sql`
- `supabase_setup.sql`
- `supabase_trigger_knockout.sql`
- `supabase_view_standings.sql`

## Legacy Dependency Cleanup

Removed:

- `@google/genai`
- `GEMINI_API_KEY` from `.env.example`
- AI Studio comments from `.env.example`
- AI Studio comment from `vite.config.ts`

Kept:

- GitHub Pages fallback scripts/workflow.

Reason: GitHub Pages is still a documented fallback path. Removing it should be a separate owner-approved decision.

## Validation Required

After commit, run:

- `npm run build`
- `npm run lint`
- Vercel preview or production smoke test after merge

## Next Remaining Cleanup

The remaining cleanup is no longer broad repo clutter. It is a database-history review:

1. Manually review remaining root SQL files that have partial/no live-schema match.
2. For RLS files, compare policy behavior, not only object names.
3. Archive only after each file is proven superseded by official migrations or live schema.
4. Authenticate `gh` so future work uses PRs instead of bypass pushes.
