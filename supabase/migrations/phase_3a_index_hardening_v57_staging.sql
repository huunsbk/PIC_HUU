-- ====================================================================================================
-- TOURNAMENT MANAGER ENTERPRISE V5.7
-- DATABASE MIGRATION: PHASE 3A INDEX HARDENING & HIGH-CONCURRENCY OPTIMIZATION (STAGING DEPLOYMENT)
-- ====================================================================================================
-- STATUS: APPROVED FOR STAGING DEPLOYMENT
-- TARGET: Staging Environment
-- RISK LEVEL: LOW (Using CONCURRENTLY execution pattern to avoid locking table reads/writes)
-- ====================================================================================================

-- IMPORTANT NOTE FOR PG/SUPABASE DEPLOYERS:
-- Since CREATE INDEX CONCURRENTLY cannot run inside a multi-statement transaction block in PostgreSQL,
-- this file must be run with autocommit turned on (not in a BEGIN/COMMIT block).

-- 1. Accelerate Group Queries via Tournament ID (Essential for Workspace Archival Cascade)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_groups_tournament_id
ON public.groups(tournament_id);

-- 2. Optimize Active Groups Sub-Retrieval (Excluding Soft-deleted Rows)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_groups_event_id_partial
ON public.groups(event_id)
WHERE deleted_at IS NULL;

-- 3. Optimize Team Listings (Crucial for Standings & Match Up Generation)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_event_id_partial
ON public.teams(event_id)
WHERE deleted_at IS NULL;

-- 4. Accelerate Match Board Retrieval (Filters Soft-Deleted Rows)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matches_event_id_partial
ON public.matches(event_id)
WHERE deleted_at IS NULL;

-- 5. Accelerate Actionable Workspace/Event Permissions Check
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_acct_event_perms_event_partial
ON public.account_event_permissions(event_id)
WHERE deleted_at IS NULL;

-- 6. Accelerate Relational Foreign-Key Joins on Accounts Roles
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_role_id
ON public.accounts(role_id);

-- 7. Optimize Backward-Scanning on Big Timeline Audit Logs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_tenant_id_id_desc
ON public.audit_logs(tenant_id, id DESC);

-- 8. Accelerate Billing Page Invoice History Sorts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_tenant_date_desc
ON public.invoices(tenant_id, invoice_date DESC);

-- 9. Protect New Workspace Workspace Creation Limits via Subscription Guard Checks
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_subscriptions_active_partial
ON public.tenant_subscriptions(tenant_id)
WHERE status = 'active';

-- ====================================================================================================
-- DATABASE STATISTICS UPDATE (ANALYZE)
-- ====================================================================================================
-- Forces PostgreSQL Query Planner to immediately register the new cardinality changes and structural
-- gains instead of waiting for auto-vacuum/auto-analyze routines.
ANALYZE public.groups;
ANALYZE public.teams;
ANALYZE public.matches;
ANALYZE public.account_event_permissions;
ANALYZE public.audit_logs;
ANALYZE public.tenant_subscriptions;
ANALYZE public.invoices;
