-- PHASE 1: SAFE FIXES ONLY
-- 1. Enable RLS on all enterprise tables to immediately cut off implicit public access
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_event_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;

-- 2. Create foundational Security Definer Context functions
-- Note: Defined as plpgsql to prevent inlining, and SECURITY DEFINER to prevent recursive RLS execution
CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.accounts WHERE user_id = auth.uid();
  RETURN v_tenant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_role() RETURNS VARCHAR
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role VARCHAR;
BEGIN
  SELECT r.name INTO v_role FROM public.accounts a JOIN public.roles r ON a.role_id = r.id WHERE a.user_id = auth.uid();
  RETURN v_role;
END;
$$;

-- 3. Lock down RPC Functions
REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_role() TO authenticated;

-- 4. Fix missing Indexes
CREATE INDEX IF NOT EXISTS idx_active_sessions_token ON public.active_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_accounts_username ON public.accounts(username);
-- Ensure events reference is enforced (assumes event_id is matching)
CREATE INDEX IF NOT EXISTS idx_acct_evt_event_id ON public.account_event_permissions(event_id);
