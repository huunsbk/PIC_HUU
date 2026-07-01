-- ROLLBACK MIGRATION FOR RLS

-- 1. DROP NEW POLICIES
DROP POLICY IF EXISTS "Events_Tenant_Isolation" ON public.events;
DROP POLICY IF EXISTS "Groups_Tenant_Isolation" ON public.groups;
DROP POLICY IF EXISTS "Teams_Tenant_Isolation" ON public.teams;
DROP POLICY IF EXISTS "Matches_Tenant_Isolation" ON public.matches;
DROP POLICY IF EXISTS "AuditLogs_Tenant_Isolation" ON public.audit_logs;
DROP POLICY IF EXISTS "LoginLogs_Tenant_Isolation" ON public.login_logs;

DROP POLICY IF EXISTS "Accounts_Select" ON public.accounts;
DROP POLICY IF EXISTS "Accounts_Insert" ON public.accounts;
DROP POLICY IF EXISTS "Accounts_Update" ON public.accounts;
DROP POLICY IF EXISTS "Accounts_Delete" ON public.accounts;

DROP POLICY IF EXISTS "AccountPermissions_Select" ON public.account_permissions;
DROP POLICY IF EXISTS "AccountPermissions_Insert" ON public.account_permissions;
DROP POLICY IF EXISTS "AccountPermissions_Update" ON public.account_permissions;
DROP POLICY IF EXISTS "AccountPermissions_Delete" ON public.account_permissions;

DROP POLICY IF EXISTS "AccountEventPermissions_Select" ON public.account_event_permissions;
DROP POLICY IF EXISTS "AccountEventPermissions_Insert" ON public.account_event_permissions;
DROP POLICY IF EXISTS "AccountEventPermissions_Update" ON public.account_event_permissions;
DROP POLICY IF EXISTS "AccountEventPermissions_Delete" ON public.account_event_permissions;

DROP POLICY IF EXISTS "ActiveSessions_Select" ON public.active_sessions;
DROP POLICY IF EXISTS "ActiveSessions_Insert" ON public.active_sessions;
DROP POLICY IF EXISTS "ActiveSessions_Update" ON public.active_sessions;
DROP POLICY IF EXISTS "ActiveSessions_Delete" ON public.active_sessions;

DROP POLICY IF EXISTS "Roles_Select" ON public.roles;
DROP POLICY IF EXISTS "Permissions_Select" ON public.permissions;
DROP POLICY IF EXISTS "Tenants_Select" ON public.tenants;

-- 2. DISABLE RLS
ALTER TABLE public.events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_permissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_event_permissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants DISABLE ROW LEVEL SECURITY;

-- 3. DROP HELPER FUNCTIONS
DROP FUNCTION IF EXISTS public.current_tenant_id();
DROP FUNCTION IF EXISTS public.current_role();
DROP FUNCTION IF EXISTS public.update_my_profile(VARCHAR);

-- Note: We disabled RLS to return to the unprotected state. Restoring explicit development policies like `WITH CHECK (true)` is not necessary unless your setup specifically requires it.
