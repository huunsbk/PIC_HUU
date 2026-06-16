-- enterprise_v4.sql

-- ==============================================================================
-- 1. FUNCTIONS
-- ==============================================================================

-- 1.1 Hàm lấy Account ID hiện tại
CREATE OR REPLACE FUNCTION public.current_account_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM accounts WHERE user_id = auth.uid() LIMIT 1;
$$;

-- 1.2 Hàm lấy Tenant ID hiện tại
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM accounts WHERE user_id = auth.uid() LIMIT 1;
$$;

-- 1.3 Hàm lấy Role Name hiện tại
CREATE OR REPLACE FUNCTION public.current_role_name()
RETURNS VARCHAR
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.name 
  FROM accounts a 
  JOIN roles r ON a.role_id = r.id 
  WHERE a.user_id = auth.uid() 
  LIMIT 1;
$$;

-- 1.4 Hàm check quyền của Account
CREATE OR REPLACE FUNCTION public.has_permission(perm_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM accounts a
    WHERE a.user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM account_permissions ap
        JOIN permissions p ON ap.permission_id = p.id
        WHERE ap.account_id = a.id AND p.name = perm_name
      )
      OR
      EXISTS (
        SELECT 1 FROM role_permissions rp
        JOIN permissions p ON rp.permission_id = p.id
        WHERE rp.role_id = a.role_id AND p.name = perm_name
      )
      OR 
      EXISTS (
        SELECT 1 FROM role_permissions rp
        JOIN permissions p ON rp.permission_id = p.id
        WHERE rp.role_id = a.role_id AND p.name = '*'
      )
    )
  );
$$;

-- 1.5 Hàm check Event Scope Access
CREATE OR REPLACE FUNCTION public.has_event_access(check_event_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM account_event_permissions 
    WHERE account_id = public.current_account_id() 
    AND event_id = check_event_id
  );
$$;

-- ==============================================================================
-- 2. AUTO EVENT ASSIGNMENT TRIGGER
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.trigger_auto_assign_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  v_account_id := public.current_account_id();
  IF v_account_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.account_event_permissions WHERE account_id = v_account_id AND event_id = NEW.id) THEN
      INSERT INTO public.account_event_permissions (id, account_id, event_id, created_at)
      VALUES (gen_random_uuid(), v_account_id, NEW.id, now());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_assign_event_after_insert ON public.events;
CREATE TRIGGER trg_auto_assign_event_after_insert
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.trigger_auto_assign_event();

-- ==============================================================================
-- 3. AUDIT LOG TRIGGER
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.audit_matches_changes_v4()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_details TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_tenant_id := NEW.tenant_id;
    v_details := '{"target_id":"' || NEW.id || '", "event_id":"' || NEW.event_id || '"}';
    INSERT INTO public.audit_logs (tenant_id, action, details, timestamp, created_at)
    VALUES (v_tenant_id, 'CREATE_MATCH', v_details, to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), now());
    RETURN NEW;
    
  ELSIF TG_OP = 'UPDATE' THEN
    v_tenant_id := NEW.tenant_id;
    -- Chỉ audit nếu score hoặc status bị đổi
    IF NEW.score_a IS DISTINCT FROM OLD.score_a OR NEW.score_b IS DISTINCT FROM OLD.score_b OR NEW.status IS DISTINCT FROM OLD.status THEN
      v_details := '{"target_id":"' || NEW.id || '", "event_id":"' || NEW.event_id || '", "status":"' || NEW.status || '"}';
      INSERT INTO public.audit_logs (tenant_id, action, details, timestamp, created_at)
      VALUES (v_tenant_id, 'UPDATE_MATCH_SCORE', v_details, to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), now());
    END IF;
    RETURN NEW;
    
  ELSIF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id;
    v_details := '{"target_id":"' || OLD.id || '", "event_id":"' || OLD.event_id || '"}';
    INSERT INTO public.audit_logs (tenant_id, action, details, timestamp, created_at)
    VALUES (v_tenant_id, 'DELETE_MATCH', v_details, to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), now());
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_matches_v4 ON public.matches;
CREATE TRIGGER trg_audit_matches_v4
AFTER INSERT OR UPDATE OR DELETE ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.audit_matches_changes_v4();

-- ==============================================================================
-- 4. SOFT DELETE STRATEGY (ADD COLUMNS)
-- ==============================================================================
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ==============================================================================
-- 5. RLS POLICIES (TÁCH BIỆT CRUD)
-- ==============================================================================

-- Kiểm tra Enable RLS
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

-- 5.1 EVENTS
DROP POLICY IF EXISTS "events_rls" ON public.events;
DROP POLICY IF EXISTS "events_select" ON public.events;
DROP POLICY IF EXISTS "events_insert" ON public.events;
DROP POLICY IF EXISTS "events_update" ON public.events;
DROP POLICY IF EXISTS "events_delete" ON public.events;

CREATE POLICY "events_select" ON public.events FOR SELECT USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR tenant_id = public.current_tenant_id()
);

CREATE POLICY "events_insert" ON public.events FOR INSERT WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
    tenant_id = public.current_tenant_id() 
    AND (
      public.current_role_name() = 'TENANT_ADMIN' 
      OR public.has_permission('manage_events')
    )
  )
);

CREATE POLICY "events_update" ON public.events FOR UPDATE USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
    tenant_id = public.current_tenant_id() 
    AND (
      public.current_role_name() = 'TENANT_ADMIN' 
      OR (public.has_permission('manage_events') AND public.has_event_access(id))
    )
  )
);

CREATE POLICY "events_delete" ON public.events FOR DELETE USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
    tenant_id = public.current_tenant_id() 
    AND (
      public.current_role_name() = 'TENANT_ADMIN' 
      OR (public.has_permission('manage_events') AND public.has_event_access(id))
    )
  )
);

-- 5.2 TEAMS
DROP POLICY IF EXISTS "teams_rls" ON public.teams;
DROP POLICY IF EXISTS "teams_select" ON public.teams;
DROP POLICY IF EXISTS "teams_insert" ON public.teams;
DROP POLICY IF EXISTS "teams_update" ON public.teams;
DROP POLICY IF EXISTS "teams_delete" ON public.teams;

CREATE POLICY "teams_select" ON public.teams FOR SELECT USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR tenant_id = public.current_tenant_id()
);

CREATE POLICY "teams_insert" ON public.teams FOR INSERT WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
    tenant_id = public.current_tenant_id() 
    AND (
      public.current_role_name() = 'TENANT_ADMIN' 
      OR (public.has_permission('manage_teams') AND public.has_event_access(event_id))
    )
  )
);

CREATE POLICY "teams_update" ON public.teams FOR UPDATE USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
    tenant_id = public.current_tenant_id() 
    AND (
      public.current_role_name() = 'TENANT_ADMIN' 
      OR (public.has_permission('manage_teams') AND public.has_event_access(event_id))
    )
  )
);

CREATE POLICY "teams_delete" ON public.teams FOR DELETE USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
    tenant_id = public.current_tenant_id() 
    AND (
      public.current_role_name() = 'TENANT_ADMIN' 
      OR (public.has_permission('manage_teams') AND public.has_event_access(event_id))
    )
  )
);

-- 5.3 GROUPS
DROP POLICY IF EXISTS "groups_rls" ON public.groups;
DROP POLICY IF EXISTS "groups_select" ON public.groups;
DROP POLICY IF EXISTS "groups_insert" ON public.groups;
DROP POLICY IF EXISTS "groups_update" ON public.groups;
DROP POLICY IF EXISTS "groups_delete" ON public.groups;

CREATE POLICY "groups_select" ON public.groups FOR SELECT USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR tenant_id = public.current_tenant_id()
);

CREATE POLICY "groups_insert" ON public.groups FOR INSERT WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
    tenant_id = public.current_tenant_id() 
    AND (
      public.current_role_name() = 'TENANT_ADMIN' 
      OR (public.has_permission('manage_groups') AND public.has_event_access(event_id))
    )
  )
);

CREATE POLICY "groups_update" ON public.groups FOR UPDATE USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
    tenant_id = public.current_tenant_id() 
    AND (
      public.current_role_name() = 'TENANT_ADMIN' 
      OR (public.has_permission('manage_groups') AND public.has_event_access(event_id))
    )
  )
);

CREATE POLICY "groups_delete" ON public.groups FOR DELETE USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
    tenant_id = public.current_tenant_id() 
    AND (
      public.current_role_name() = 'TENANT_ADMIN' 
      OR (public.has_permission('manage_groups') AND public.has_event_access(event_id))
    )
  )
);

-- 5.4 MATCHES
DROP POLICY IF EXISTS "matches_rls" ON public.matches;
DROP POLICY IF EXISTS "matches_select" ON public.matches;
DROP POLICY IF EXISTS "matches_insert" ON public.matches;
DROP POLICY IF EXISTS "matches_update" ON public.matches;
DROP POLICY IF EXISTS "matches_delete" ON public.matches;

CREATE POLICY "matches_select" ON public.matches FOR SELECT USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR tenant_id = public.current_tenant_id()
);

CREATE POLICY "matches_insert" ON public.matches FOR INSERT WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
    tenant_id = public.current_tenant_id() 
    AND (
      public.current_role_name() = 'TENANT_ADMIN' 
      OR (public.has_permission('manage_matches') AND public.has_event_access(event_id))
    )
  )
);

CREATE POLICY "matches_update" ON public.matches FOR UPDATE USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
    tenant_id = public.current_tenant_id() 
    AND (
      public.current_role_name() = 'TENANT_ADMIN' 
      OR ((public.has_permission('manage_matches') OR public.has_permission('enter_score')) AND public.has_event_access(event_id))
    )
  )
);

CREATE POLICY "matches_delete" ON public.matches FOR DELETE USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
    tenant_id = public.current_tenant_id() 
    AND (
      public.current_role_name() = 'TENANT_ADMIN' 
      OR (public.has_permission('manage_matches') AND public.has_event_access(event_id))
    )
  )
);

-- ==============================================================================
-- 6. TỐI ƯU HÓA ENTERPRISE INDEXES (HỖ TRỢ 1000+ CCU)
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_events_tenant_id ON public.events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_teams_event_id ON public.teams(event_id);
CREATE INDEX IF NOT EXISTS idx_teams_tenant_id ON public.teams(tenant_id);
CREATE INDEX IF NOT EXISTS idx_groups_event_id ON public.groups(event_id);
CREATE INDEX IF NOT EXISTS idx_groups_tenant_id ON public.groups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_matches_event_id ON public.matches(event_id);
CREATE INDEX IF NOT EXISTS idx_matches_tenant_id ON public.matches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_account_event_perms_account_id ON public.account_event_permissions(account_id);
CREATE INDEX IF NOT EXISTS idx_account_event_perms_event_id ON public.account_event_permissions(event_id);

