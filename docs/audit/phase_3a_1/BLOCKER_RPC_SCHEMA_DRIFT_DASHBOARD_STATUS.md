# Blocker: Dashboard RPC Schema Drift

Phase: 3A.1
Environment: staging
Supabase project ref: `ykckqcykxfhpfqptckxk`

## Summary

`public.get_tournament_workspace_dashboard_v6` references `public.tournament.status`, but `public.tournament` does not expose a `status` column in staging.

## Impact

The dashboard RPC can fail at runtime when the query path resolves `t.status`. This blocks reliable capture of commercial beta evidence for the dashboard workspace endpoint.

## Required Hotfix

Apply `supabase/hotfixes/phase_3a_1_fix_dashboard_rpc_status_drift.sql` in staging after DBA review.

The hotfix must:

- Keep the existing RPC signature.
- Use `CREATE OR REPLACE FUNCTION`.
- Return `'draft'::text AS status`.
- Remove all references to `t.status`.
- Avoid altering `public.tournament`.
- Avoid adding a `status` column.

## Evidence Needed After Hotfix

Replace the before/after JSON placeholders in this folder with raw `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)` output captured from Supabase Staging.

## Commercial Beta V1 Release Boundary

Commercial Beta V1 target: up to 100 active tournaments.

Scale beyond 100 active tournaments requires benchmark evidence. 100-300 tournaments is no longer the current target, 300-800 tournaments is future expansion only, and 1000+ tournaments is not approved.

Production remains NOT APPROVED until the Staging hotfix, raw EXPLAIN evidence, and RLS isolation checks pass.
