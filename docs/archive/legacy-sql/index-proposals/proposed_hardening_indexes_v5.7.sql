-- ====================================================================================================
-- PROPOSED DATABASE HARDENING & PERFORMANCE INDEX MIGRATION SCRIPT (Tournament Manager Enterprise V5.7)
-- ====================================================================================================
-- This SQL script contains optimal index schema upgrades designed to secure high-concurrency 
-- performance, prevent Full Table (Sequential) Scans, and harden tenant data isolation boundaries.
--
-- STATUS: Proposed / Pending Audit Approval.
-- DO NOT EXECUTE DIRECTLY - Keep this for database administrator inspection.
-- ====================================================================================================

-- ----------------------------------------------------------------------------------------------------
-- 1. ACCELERATING WORKSPACE ARCHIVING & CASCADE OPERATIONS
-- ----------------------------------------------------------------------------------------------------
-- Prevents seq scans on the public.groups table during bulk soft-deletes of tournament workspaces
-- which are invoked by public.archive_tournament_workspace_v6().
CREATE INDEX IF NOT EXISTS idx_groups_tournament_id 
ON public.groups(tournament_id);

-- ----------------------------------------------------------------------------------------------------
-- 2. PARTIAL CLUSTER INDEXES FOR SUB-DATA RETRIEVAL (deleted_at IS NULL filter optimization)
-- ----------------------------------------------------------------------------------------------------
-- Highly optimized B-tree partial indexes. These filter out soft-deleted records, keeping the index 
-- sizes extremely compact and fast to read for active events.
CREATE INDEX IF NOT EXISTS idx_groups_event_id_partial
ON public.groups(event_id) 
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_teams_event_id_partial
ON public.teams(event_id) 
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_matches_event_id_partial
ON public.matches(event_id) 
WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------------------------------
-- 3. PERMISSIONS, ROLES JOIN & OWNER RESOLUTION LAYER HARDENING
-- ----------------------------------------------------------------------------------------------------
-- Maximizes speed of owner resolution calls via public.get_tournament_owner() which joins event 
-- permissions and active accounts to find the owner of a workspace.
CREATE INDEX IF NOT EXISTS idx_acct_event_perms_event_partial
ON public.account_event_permissions(event_id) 
WHERE deleted_at IS NULL;

-- Accelerates relational joins between public.accounts and public.roles
CREATE INDEX IF NOT EXISTS idx_accounts_role_id
ON public.accounts(role_id);

-- ----------------------------------------------------------------------------------------------------
-- 4. IMMUTABLE AUDIT LOG & PERFORMANCE LOGGER ACCELERATION
-- ----------------------------------------------------------------------------------------------------
-- Facilitates zero-overhead backward scans for the audit logger timeline which queries logs using:
-- WHERE tenant_id = ? ORDER BY id DESC LIMIT 200.
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id_id_desc
ON public.audit_logs(tenant_id, id DESC);

-- ----------------------------------------------------------------------------------------------------
-- 5. SAAS ACCOUNT SUBSCRIPTIONS & TRANSACTIONAL BILLING ACCELERATION
-- ----------------------------------------------------------------------------------------------------
-- Optimizes historical charge retrieval and billing history sorts on the billing page.
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_date_desc
ON public.invoices(tenant_id, invoice_date DESC);

-- Accelerates tenant active subscription guard validations triggered on every workspace insert.
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_active_partial
ON public.tenant_subscriptions(tenant_id) 
WHERE status = 'active';

-- ====================================================================================================
-- END OF PROPOSED SCHEMA MIGRATION V5.7
-- ====================================================================================================
