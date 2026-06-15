-- PHASE 3: PERMISSION SYSTEM HARDENING
-- Drop dangerous legacy account rules
DROP POLICY IF EXISTS "Cho phép mọi người xem danh sách tài khoản" ON public.accounts;
DROP POLICY IF EXISTS "Cho phép ghi tự do cho accounts" ON public.accounts;

-- Protect System Catalogs
CREATE POLICY "Roles_Read_Only" ON public.roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Permissions_Read_Only" ON public.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Tenants_Read_Only" ON public.tenants FOR SELECT TO authenticated USING (true);

-- Harden Accounts
CREATE POLICY "Accounts_Select" ON public.accounts FOR SELECT TO authenticated
USING ( 
  public.current_role() = 'SUPER_ADMIN' OR
  (public.current_role() = 'TENANT_ADMIN' AND tenant_id = public.current_tenant_id()) OR
  user_id = auth.uid()
);

-- Deny insert unless Admin
CREATE POLICY "Accounts_Insert" ON public.accounts FOR INSERT TO authenticated
WITH CHECK (
  public.current_role() = 'SUPER_ADMIN' OR
  (public.current_role() = 'TENANT_ADMIN' AND tenant_id = public.current_tenant_id())
);

-- Deny Self-Escalation: Users cannot update their own account directly. 
-- Admins can update roles/tenant_id
CREATE POLICY "Accounts_Update" ON public.accounts FOR UPDATE TO authenticated
USING (
  public.current_role() = 'SUPER_ADMIN' OR
  (public.current_role() = 'TENANT_ADMIN' AND tenant_id = public.current_tenant_id())
)
WITH CHECK (
  public.current_role() = 'SUPER_ADMIN' OR
  (public.current_role() = 'TENANT_ADMIN' AND tenant_id = public.current_tenant_id())
);

-- Active Sessions Security
CREATE POLICY "Sessions_Select_Self" ON public.active_sessions FOR SELECT TO authenticated
USING (
  account_id = (SELECT id FROM public.accounts WHERE user_id = auth.uid()) OR
  public.current_role() = 'SUPER_ADMIN' OR
  account_id IN (SELECT id FROM public.accounts WHERE tenant_id = public.current_tenant_id() AND public.current_role() = 'TENANT_ADMIN')
);

-- Event Permissions Hardening
CREATE POLICY "AccountEventPerms_Select" ON public.account_event_permissions FOR SELECT TO authenticated
USING (
  account_id = (SELECT id FROM public.accounts WHERE user_id = auth.uid()) OR
  public.current_role() = 'SUPER_ADMIN' OR
  account_id IN (SELECT id FROM public.accounts WHERE tenant_id = public.current_tenant_id() AND public.current_role() = 'TENANT_ADMIN')
);

CREATE POLICY "AccountEventPerms_Modify" ON public.account_event_permissions FOR ALL TO authenticated
USING (
  public.current_role() = 'SUPER_ADMIN' OR
  (public.current_role() = 'TENANT_ADMIN' AND account_id IN (SELECT id FROM public.accounts WHERE tenant_id = public.current_tenant_id()))
)
WITH CHECK (
  public.current_role() = 'SUPER_ADMIN' OR
  (public.current_role() = 'TENANT_ADMIN' AND account_id IN (SELECT id FROM public.accounts WHERE tenant_id = public.current_tenant_id()))
);
