-- Phase 3A.1 Execution Plan Audit
-- Environment: Staging
-- Supabase project ref: ykckqcykxfhpfqptckxk
-- Production status: NOT APPROVED
-- Manual execution only in Supabase SQL Editor
-- Do not run from GitHub Actions
-- Do not run on Production

-- 1. RPC signature confirmation
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS result_type,
  p.prosecdef AS security_definer,
  CASE p.provolatile
    WHEN 'i' THEN 'IMMUTABLE'
    WHEN 's' THEN 'STABLE'
    WHEN 'v' THEN 'VOLATILE'
    ELSE p.provolatile::text
  END AS volatility
FROM pg_proc p
JOIN pg_namespace n
  ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_tournament_workspace_dashboard_v6',
    'archive_tournament_workspace_v6',
    'get_tournament_owner',
    'create_tournament_workspace_v6',
    'transfer_tournament_owner_v6'
  )
ORDER BY p.proname;

-- 2. Dashboard RPC audit
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
SELECT public.get_tournament_workspace_dashboard_v6(
NULL::timestamptz,
50
);

-- 3. Owner RPC audit
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
SELECT public.get_tournament_owner(
'**TEST_EVENT_ID**'::text
);

-- 4. Archive RPC audit
-- Use only disposable staging test tournament id.
-- Never run archive RPC on real data.
-- Never remove ROLLBACK unless explicitly approved.
BEGIN;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
SELECT public.archive_tournament_workspace_v6(
'**TEST_TOURNAMENT_ID**'::text
);

ROLLBACK;
