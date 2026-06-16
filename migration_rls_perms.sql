-- migration_rls_perms.sql

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
      -- Right from account
      EXISTS (
        SELECT 1 FROM account_permissions ap
        JOIN permissions p ON ap.permission_id = p.id
        WHERE ap.account_id = a.id AND p.name = perm_name
      )
      OR
      -- Right from role
      EXISTS (
        SELECT 1 FROM role_permissions rp
        JOIN permissions p ON rp.permission_id = p.id
        WHERE rp.role_id = a.role_id AND p.name = perm_name
      )
      OR 
      -- Role has '*' 
      EXISTS (
        SELECT 1 FROM role_permissions rp
        JOIN permissions p ON rp.permission_id = p.id
        WHERE rp.role_id = a.role_id AND p.name = '*'
      )
    )
  );
$$;

-- 6. RLS: Bảng EVENTS
DROP POLICY IF EXISTS "events_rls" ON events;
CREATE POLICY "events_rls"
ON events FOR ALL
USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR public.has_event_access(id)
        OR public.has_permission('manage_events')
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
        OR public.has_permission('manage_events')
     )
  )
);

-- 7. RLS: Bảng TEAMS
DROP POLICY IF EXISTS "teams_rls" ON teams;
CREATE POLICY "teams_rls"
ON teams FOR ALL
USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR public.has_event_access(event_id)
        OR public.has_permission('manage_teams')
        OR public.has_permission('manage_events')
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
        OR public.has_permission('manage_teams')
        OR public.has_permission('manage_events')
     )
  )
);

-- 8. RLS: Bảng GROUPS
DROP POLICY IF EXISTS "groups_rls" ON groups;
CREATE POLICY "groups_rls"
ON groups FOR ALL
USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR public.has_event_access(event_id)
        OR public.has_permission('manage_groups')
        OR public.has_permission('manage_events')
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
        OR public.has_permission('manage_groups')
        OR public.has_permission('manage_events')
     )
  )
);

-- 9. RLS: Bảng MATCHES
DROP POLICY IF EXISTS "matches_rls" ON matches;
CREATE POLICY "matches_rls"
ON matches FOR ALL
USING (
  public.current_role_name() = 'SUPER_ADMIN' 
  OR (
     tenant_id = public.current_tenant_id()
     AND (
        public.current_role_name() = 'TENANT_ADMIN' 
        OR public.has_event_access(event_id)
        OR public.has_permission('manage_matches')
        OR public.has_permission('enter_score')
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
        OR public.has_permission('manage_matches')
        OR public.has_permission('enter_score')
     )
  )
);
