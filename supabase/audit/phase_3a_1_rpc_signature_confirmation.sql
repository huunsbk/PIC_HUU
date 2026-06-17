-- =====================================================================================
-- PHASE 3A.1 - RPC SIGNATURE CONFIRMATION
-- Project: Tournament Manager Enterprise SaaS V5.7
-- Supabase Project Ref: ykckqcykxfhpfqptckxk
-- Environment: Staging / Evidence Collection
--
-- Purpose:
-- Confirm the real function signatures before running EXPLAIN ANALYZE.
-- Do not assume RPC parameters from frontend code or old documentation.
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