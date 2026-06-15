-- PHASE 4: PRODUCTION LOCKDOWN

-- 1. Lock down Audit Logs (Insert Only via triggers conceptually, Select via Admins)
-- Using a simpler boolean evaluation to prevent complex view evaluations if needed
CREATE POLICY "AuditLogs_Select" ON public.audit_logs FOR SELECT TO authenticated
USING ( 
  tenant_id::TEXT = public.current_tenant_id()::TEXT AND public.current_role() = 'TENANT_ADMIN' OR
  public.current_role() = 'SUPER_ADMIN'
);

-- Force row level security explicitly on all tables 
ALTER TABLE public.tournament FORCE ROW LEVEL SECURITY;
ALTER TABLE public.events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.teams FORCE ROW LEVEL SECURITY;
ALTER TABLE public.groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.matches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.account_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.account_event_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.active_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.login_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;

-- 2. Audit trigger integration
CREATE OR REPLACE FUNCTION public.system_audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id TEXT;
  v_details JSONB;
BEGIN
  -- Handle system deletions or updates quietly if no auth is present
  BEGIN
    v_tenant_id := public.current_tenant_id()::TEXT;
  EXCEPTION WHEN OTHERS THEN
    v_tenant_id := 'SYSTEM_OR_ORPHANED';
  END;

  IF TG_OP = 'INSERT' THEN
    v_details := row_to_json(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_details := jsonb_build_object('old', row_to_json(OLD), 'new', row_to_json(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    v_details := row_to_json(OLD);
  END IF;

  INSERT INTO public.audit_logs (tenant_id, timestamp, action, details, created_at)
  VALUES (v_tenant_id, extract(epoch from now())::text, TG_OP || '_' || TG_TABLE_NAME, v_details::text, now());

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_accounts ON public.accounts;
CREATE TRIGGER audit_accounts AFTER INSERT OR UPDATE OR DELETE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.system_audit_trigger();
