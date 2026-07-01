-- PHASE 3: SAAS PERFORMANCE INDEXES & SCHEMA UPGRADES

-- 1. Create missing indexes for tenant mapping acceleration
CREATE INDEX IF NOT EXISTS idx_events_tenant ON public.events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_groups_tenant ON public.groups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_teams_tenant ON public.teams(tenant_id);
CREATE INDEX IF NOT EXISTS idx_matches_tenant ON public.matches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_accounts_tenant ON public.accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON public.audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_account ON public.active_sessions(account_id);

-- 2. Add last_seen_at to active_sessions
ALTER TABLE public.active_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 3. Tenant Metrics for Billing
CREATE TABLE IF NOT EXISTS public.tenant_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    events_count INT DEFAULT 0,
    teams_count INT DEFAULT 0,
    matches_count INT DEFAULT 0,
    storage_bytes BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for Tenant Metrics
ALTER TABLE public.tenant_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_metrics FORCE ROW LEVEL SECURITY;

CREATE POLICY "TenantMetrics_Select" ON public.tenant_metrics FOR SELECT TO authenticated
USING (
  tenant_id::TEXT = public.current_tenant_id()::TEXT OR 
  public.current_role() = 'SUPER_ADMIN'
);
