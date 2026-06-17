-- =====================================================================================
-- PHASE 3A.1 - EXECUTION PLAN AUDIT
-- Project: Tournament Manager Enterprise SaaS V5.7
-- Supabase Project Ref: ykckqcykxfhpfqptckxk
-- Environment: Staging / Evidence Collection
--
-- Status:
-- STAGING REPORT ACCEPTED FOR EVIDENCE COLLECTION
-- PRODUCTION STATUS: NOT APPROVED YET
--
-- Purpose:
-- Capture raw EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
-- for critical RPCs before/after V5.7 index hardening.
--
-- IMPORTANT:
-- 1. Run only on Staging/test data.
-- 2. Do not run archive_tournament_workspace_v6 on real tournament data.
-- 3. archive_tournament_workspace_v6 must be wrapped in BEGIN ... ROLLBACK.
-- 4. Save each JSON output into docs/audit/phase_3a_1/.
-- =====================================================================================


-- =====================================================================================
-- 0. CONFIRM RPC SIGNATURES BEFORE RUNNING EXPLAIN
-- =====================================================================================

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


-- =====================================================================================
-- 1. DASHBOARD RPC AUDIT
-- Function:
-- public.get_tournament_workspace_dashboard_v6(
--   p_cursor timestamptz DEFAULT NULL,
--   p_limit integer DEFAULT 50
-- )
--
-- Save output as:
-- docs/audit/phase_3a_1/before_get_tournament_workspace_dashboard_v6.json
-- docs/audit/phase_3a_1/after_get_tournament_workspace_dashboard_v6.json
-- =====================================================================================

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
SELECT public.get_tournament_workspace_dashboard_v6(
    NULL::timestamptz,
    50
);


-- Optional cursor-based pagination test.
-- Replace __TEST_CURSOR__ with a real created_at timestamp if needed.
--
-- EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
-- SELECT public.get_tournament_workspace_dashboard_v6(
--     '__TEST_CURSOR__'::timestamptz,
--     50
-- );


-- =====================================================================================
-- 2. OWNER RESOLUTION RPC AUDIT
-- Function:
-- public.get_tournament_owner(
--   p_event_id text
-- )
--
-- Before running:
-- Replace __TEST_EVENT_ID__ with a real staging event id.
--
-- Save output as:
-- docs/audit/phase_3a_1/before_get_tournament_owner.json
-- docs/audit/phase_3a_1/after_get_tournament_owner.json
-- =====================================================================================

-- Helper: find a safe test event_id.
SELECT
    e.id AS test_event_id,
    e.name AS event_name,
    e.tenant_id,
    e.tournament_id,
    e.created_at
FROM public.events e
WHERE e.deleted_at IS NULL
ORDER BY e.created_at DESC
LIMIT 10;

-- Replace __TEST_EVENT_ID__ before running this EXPLAIN.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
SELECT public.get_tournament_owner(
    '__TEST_EVENT_ID__'::text
);


-- =====================================================================================
-- 3. ARCHIVE WORKSPACE RPC AUDIT - SAFE TEMPLATE ONLY
-- Function:
-- public.archive_tournament_workspace_v6(
--   p_tournament_id text
-- )
--
-- DANGER:
-- This RPC changes data because it archives/soft-deletes a tournament workspace.
-- Only run on a staging test tournament.
-- Must be wrapped in BEGIN ... ROLLBACK.
--
-- Save output as:
-- docs/audit/phase_3a_1/before_archive_tournament_workspace_v6.json
-- docs/audit/phase_3a_1/after_archive_tournament_workspace_v6.json
-- =====================================================================================

-- Helper: find a safe test tournament_id.
SELECT
    t.id AS test_tournament_id,
    t.name,
    t.tenant_id,
    t.status,
    t.created_at
FROM public.tournament t
WHERE t.deleted_at IS NULL
ORDER BY t.created_at DESC
LIMIT 10;

-- Replace __TEST_TOURNAMENT_ID__ with a disposable staging tournament id.
-- Do NOT run on real/important tournament data.
--
-- BEGIN;
--
-- EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
-- SELECT public.archive_tournament_workspace_v6(
--     '__TEST_TOURNAMENT_ID__'::text
-- );
--
-- ROLLBACK;


-- =====================================================================================
-- 4. OPTIONAL: CREATE WORKSPACE RPC AUDIT
-- Function:
-- public.create_tournament_workspace_v6(
--   p_tournament_name text,
--   p_slug text,
--   p_plan text,
--   p_account_id uuid
-- )
--
-- This is optional for later Commercial Beta evidence.
-- It writes data, so run only in a transaction and rollback unless intentionally creating test data.
-- =====================================================================================

-- Helper: find a safe test account_id.
SELECT
    a.id AS test_account_id,
    a.username,
    a.display_name,
    a.tenant_id,
    a.status
FROM public.accounts a
WHERE a.deleted_at IS NULL
ORDER BY a.created_at DESC
LIMIT 10;

-- Optional template only:
--
-- BEGIN;
--
-- EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
-- SELECT public.create_tournament_workspace_v6(
--     'PHASE 3A TEST TOURNAMENT'::text,
--     'phase-3a-test-' || extract(epoch from now())::text,
--     'free'::text,
--     '__TEST_ACCOUNT_ID__'::uuid
-- );
--
-- ROLLBACK;


-- =====================================================================================
-- 5. OPTIONAL: TRANSFER OWNER RPC AUDIT
-- Function:
-- public.transfer_tournament_owner_v6(
--   p_tournament_id text,
--   p_new_account_id uuid
-- )
--
-- This writes permission data. Run only in BEGIN ... ROLLBACK on staging test data.
-- =====================================================================================

-- Optional template only:
--
-- BEGIN;
--
-- EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
-- SELECT public.transfer_tournament_owner_v6(
--     '__TEST_TOURNAMENT_ID__'::text,
--     '__TEST_NEW_ACCOUNT_ID__'::uuid
-- );
--
-- ROLLBACK;


-- =====================================================================================
-- 6. INDEX USAGE MONITORING AFTER 3-7 DAYS
-- =====================================================================================

SELECT
    now() AS captured_at,
    schemaname,
    relname AS table_name,
    indexrelname AS index_name,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE indexrelname IN (
    'idx_groups_tournament_id',
    'idx_groups_event_id_partial',
    'idx_teams_event_id_partial',
    'idx_matches_event_id_partial',
    'idx_acct_event_perms_event_partial',
    'idx_accounts_role_id',
    'idx_audit_logs_tenant_id_id_desc',
    'idx_invoices_tenant_date_desc',
    'idx_tenant_subscriptions_active_partial'
)
ORDER BY idx_scan DESC, indexrelname ASC;