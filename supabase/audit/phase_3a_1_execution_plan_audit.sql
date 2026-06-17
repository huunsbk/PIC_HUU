-- ====================================================================================================
-- TOURNAMENT MANAGER ENTERPRISE V5.7
-- DATABASE AUDIT: PHASE 3A EXECUTION PLAN EVALUATION
-- ====================================================================================================
-- Path: /supabase/audit/phase_3a_1_execution_plan_audit.sql
-- Goal: Record and assert the query optimizer execution plan changes before and after indexing.
-- Usage: Execute each block on the PostgreSQL / Supabase SQL Editor on Staging.
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- STEP 1: FUNCTION SIGNATURE RECONNAISSANCE
-- Run this query first to inspect the exact argument types and return settings of key functions.
-- This guarantees we do not execute with invalid signatures that would halt the query execution analyzer.
-- ----------------------------------------------------------------------------------------------------
SELECT
    p.proname,
    pg_get_function_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS result_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
AND p.proname IN (
    'get_tournament_workspace_dashboard_v6',
    'archive_tournament_workspace_v6',
    'get_tournament_owner'
);


-- ----------------------------------------------------------------------------------------------------
-- EXPLAIN AUDIT 1: CORE DASHBOARD KPI RETRIEVAL (get_tournament_workspace_dashboard_v6)
-- ----------------------------------------------------------------------------------------------------
-- Measures performance of retrieving high-concurrency stats, checking for Index Scans on public.matches
-- and public.teams instead of Sequential Scans.
-- This function expects a timestamp (timestamptz) limit cursor and an integer count limitation.

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
SELECT * FROM public.get_tournament_workspace_dashboard_v6(
    NULL::timestamptz,  -- p_cursor
    50                  -- p_limit
);


-- ----------------------------------------------------------------------------------------------------
-- EXPLAIN AUDIT 2: SCALE-BOUND ARMED ARCHIVE CASCADE (archive_tournament_workspace_v6)
-- ----------------------------------------------------------------------------------------------------
-- Validates the presence of Index Scan on public.groups(tournament_id) through idx_groups_tournament_id,
-- mitigating the critical Seq Scan risk on cascading deletions.
-- 
-- SECURITY WARNING: This function MUTATES state by soft-deleting corresponding rows. 
-- It MUST be safety-wrapped inside a transaction block with an immediate ROLLBACK to ensure 
-- staging data records are never permanently modified or altered during performance audit tasks.
-- ONLY run on sandbox/staging test dataset records.

BEGIN;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
SELECT * FROM public.archive_tournament_workspace_v6(
    'test_tournament_id' -- p_tournament_id (Place string ID of a staging test tournament here)
);

ROLLBACK;


-- ----------------------------------------------------------------------------------------------------
-- EXPLAIN AUDIT 3: SYSTEM PERMISSIONS / WORKSPACE RESOLUTION (get_tournament_owner)
-- ----------------------------------------------------------------------------------------------------
-- Audits nested join structures on permission checks, asserting index scans on idx_accounts_role_id
-- and idx_acct_event_perms_event_partial instead of Seq Scans on large account clusters.
-- This function resolves event owners. It expects p_event_id, NOT a tournament_id.

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
SELECT * FROM public.get_tournament_owner(
    'test_event_id' -- p_event_id (Place string ID of a staging test event here)
);
