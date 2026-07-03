-- migration_rls_enterprise.sql

-- Xóa các hàm cũ trên schema auth nếu vô tình tạo ra
-- DROP FUNCTION IF EXISTS auth.get_account_tenant();
-- DROP FUNCTION IF EXISTS auth.get_account_role();

-- 1. Helper Function: Lấy Account ID hiện tại
CREATE OR REPLACE FUNCTION public.current_account_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM accounts WHERE user_id = auth.uid() LIMIT 1;
$$;

-- 2. Helper Function: Lấy Tenant ID hiện tại (SỬA: RETURN kiểu UUID)
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM accounts WHERE user_id = auth.uid() LIMIT 1;
$$;

-- 3. Helper Function: Lấy Role Name hiện tại
CREATE OR REPLACE FUNCTION public.current_role_name()
RETURNS TEXT
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

-- 4. Helper Function: Kiểm tra quyền truy cập vào Event cụ thể (event_id là varchar/text)
CREATE OR REPLACE FUNCTION public.has_event_access(check_event_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM account_event_permissions aep
    WHERE aep.account_id = public.current_account_id() 
      AND aep.event_id = check_event_id
  );
$$;

-- 5. LÀM SẠCH CÁC POLICY CŨ
DROP POLICY IF EXISTS "events_rls" ON events;
DROP POLICY IF EXISTS "groups_rls" ON groups;
DROP POLICY IF EXISTS "teams_rls" ON teams;
DROP POLICY IF EXISTS "matches_rls" ON matches;
DROP POLICY IF EXISTS "Strict Tenant Isolation For Events" ON events;
DROP POLICY IF EXISTS "Strict Tenant Isolation For Teams" ON teams;
DROP POLICY IF EXISTS "Strict Tenant Isolation For Groups" ON groups;
DROP POLICY IF EXISTS "Strict Tenant Isolation For Matches" ON matches;

-- 6. RLS: Bảng EVENTS
CREATE POLICY "events_rls"
ON events FOR ALL
USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR public.has_event_access(id)
     )
  )
)
WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR public.has_event_access(id)
     )
  )
);

-- 7. RLS: Bảng TEAMS
CREATE POLICY "teams_rls"
ON teams FOR ALL
USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR public.has_event_access(event_id)
     )
  )
)
WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR public.has_event_access(event_id)
     )
  )
);

-- 8. RLS: Bảng GROUPS
CREATE POLICY "groups_rls"
ON groups FOR ALL
USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR public.has_event_access(event_id)
     )
  )
)
WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR public.has_event_access(event_id)
     )
  )
);

-- 9. RLS: Bảng MATCHES
CREATE POLICY "matches_rls"
ON matches FOR ALL
USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR public.has_event_access(event_id)
     )
  )
)
WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR public.has_event_access(event_id)
     )
  )
);

