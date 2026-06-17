-- ====================================================================================================
-- TOURNAMENT MANAGER ENTERPRISE V5.7
-- DATABASE AUDIT: INDEX USAGE MONITORING (3-7 DAYS METRICS POST-DEPLOYMENT)
-- ====================================================================================================
-- Path: /supabase/audit/phase_3a_index_usage_after_3_7_days.sql
-- Goal: Retrieve actual telemetry of index usages directly from PostgreSQL system catalog tables
-- to verify which indexes are highly utilized and which are eligible drop candidates if unused.
-- ====================================================================================================

SELECT
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
ORDER BY idx_scan DESC;
