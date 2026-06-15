-- migration_final.sql

-- =========================
-- HELPER FUNCTIONS
-- =========================

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT tenant_id
  FROM public.accounts
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_role_name()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT r.name
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  WHERE a.user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_role_name() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_role_name() TO authenticated;

-- =========================
-- ACCOUNTS UNIQUE USER
-- =========================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'accounts_user_id_key'
  ) THEN
    ALTER TABLE public.accounts
    ADD CONSTRAINT accounts_user_id_key UNIQUE(user_id);
  END IF;
END;
$$;

-- =========================
-- ENABLE RLS
-- =========================

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_event_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- =========================
-- DROP OLD POLICIES
-- =========================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
      SELECT schemaname, tablename, policyname
      FROM pg_policies
      WHERE schemaname='public'
  LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        r.policyname,
        r.tablename
      );
  END LOOP;
END;
$$;

-- =========================
-- EVENTS
-- =========================

CREATE POLICY events_rls
ON public.events
FOR ALL
TO authenticated
USING (
  public.current_role_name() = 'SUPER_ADMIN'
  OR tenant_id = public.current_tenant_id()
)
WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN'
  OR tenant_id = public.current_tenant_id()
);

-- =========================
-- GROUPS
-- =========================

CREATE POLICY groups_rls
ON public.groups
FOR ALL
TO authenticated
USING (
  public.current_role_name() = 'SUPER_ADMIN'
  OR tenant_id = public.current_tenant_id()
)
WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN'
  OR tenant_id = public.current_tenant_id()
);

-- =========================
-- TEAMS
-- =========================

CREATE POLICY teams_rls
ON public.teams
FOR ALL
TO authenticated
USING (
  public.current_role_name() = 'SUPER_ADMIN'
  OR tenant_id = public.current_tenant_id()
)
WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN'
  OR tenant_id = public.current_tenant_id()
);

-- =========================
-- MATCHES
-- =========================

CREATE POLICY matches_rls
ON public.matches
FOR ALL
TO authenticated
USING (
  public.current_role_name() = 'SUPER_ADMIN'
  OR tenant_id = public.current_tenant_id()
)
WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN'
  OR tenant_id = public.current_tenant_id()
);

-- =========================
-- AUDIT LOGS
-- =========================

CREATE POLICY audit_logs_rls
ON public.audit_logs
FOR ALL
TO authenticated
USING (
  public.current_role_name() = 'SUPER_ADMIN'
  OR tenant_id = public.current_tenant_id()
)
WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN'
  OR tenant_id = public.current_tenant_id()
);

-- =========================
-- ACCOUNTS
-- =========================

CREATE POLICY accounts_select
ON public.accounts
FOR SELECT
TO authenticated
USING (
  public.current_role_name() = 'SUPER_ADMIN'
  OR (
      public.current_role_name() = 'TENANT_ADMIN'
      AND tenant_id = public.current_tenant_id()
  )
  OR user_id = auth.uid()
);

CREATE POLICY accounts_insert
ON public.accounts
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_role_name() IN ('SUPER_ADMIN','TENANT_ADMIN')
);

CREATE POLICY accounts_update
ON public.accounts
FOR UPDATE
TO authenticated
USING (
  public.current_role_name() = 'SUPER_ADMIN'
  OR (
      public.current_role_name() = 'TENANT_ADMIN'
      AND tenant_id = public.current_tenant_id()
  )
)
WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN'
  OR (
      public.current_role_name() = 'TENANT_ADMIN'
      AND tenant_id = public.current_tenant_id()
  )
);

CREATE POLICY accounts_delete
ON public.accounts
FOR DELETE
TO authenticated
USING (
  public.current_role_name() = 'SUPER_ADMIN'
  OR (
      public.current_role_name() = 'TENANT_ADMIN'
      AND tenant_id = public.current_tenant_id()
  )
);

-- =========================
-- ACCOUNT PERMISSIONS
-- =========================

CREATE POLICY account_permissions_rls
ON public.account_permissions
FOR ALL
TO authenticated
USING (
  public.current_role_name() = 'SUPER_ADMIN'
)
WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN'
);

-- =========================
-- ACCOUNT EVENT PERMISSIONS
-- =========================

CREATE POLICY account_event_permissions_rls
ON public.account_event_permissions
FOR ALL
TO authenticated
USING (
  public.current_role_name() = 'SUPER_ADMIN'
)
WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN'
);

-- =========================
-- ACTIVE SESSIONS
-- =========================

CREATE POLICY active_sessions_rls
ON public.active_sessions
FOR ALL
TO authenticated
USING (
  account_id IN (
    SELECT id
    FROM public.accounts
    WHERE user_id = auth.uid()
  )
  OR public.current_role_name()='SUPER_ADMIN'
)
WITH CHECK (
  account_id IN (
    SELECT id
    FROM public.accounts
    WHERE user_id = auth.uid()
  )
  OR public.current_role_name()='SUPER_ADMIN'
);

-- =========================
-- LOGIN LOGS
-- =========================

CREATE POLICY login_logs_rls
ON public.login_logs
FOR ALL
TO authenticated
USING (
  public.current_role_name()='SUPER_ADMIN'
)
WITH CHECK (
  public.current_role_name()='SUPER_ADMIN'
);

-- =========================
-- ROLES
-- =========================

CREATE POLICY roles_read
ON public.roles
FOR SELECT
TO authenticated
USING (true);

-- =========================
-- PERMISSIONS
-- =========================

CREATE POLICY permissions_read
ON public.permissions
FOR SELECT
TO authenticated
USING (true);

-- =========================
-- TENANTS
-- =========================

CREATE POLICY tenants_read
ON public.tenants
FOR SELECT
TO authenticated
USING (
  id = public.current_tenant_id()
  OR public.current_role_name()='SUPER_ADMIN'
);

-- =========================
-- VERIFY
-- =========================

SELECT
    tablename,
    policyname
FROM pg_policies
WHERE schemaname='public'
ORDER BY tablename, policyname;