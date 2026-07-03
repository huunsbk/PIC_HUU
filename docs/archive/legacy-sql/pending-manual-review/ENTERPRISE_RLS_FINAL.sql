-- 1. Helper Security Definer Functions
CREATE OR REPLACE FUNCTION get_auth_account_id() RETURNS UUID AS $$
  SELECT id FROM accounts WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_auth_account_tenant_id() RETURNS UUID AS $$
  SELECT tenant_id FROM accounts WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_auth_account_role() RETURNS VARCHAR AS $$
  SELECT r.name FROM accounts a JOIN roles r ON a.role_id = r.id WHERE a.user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 2. ENABLE RLS
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_event_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament ENABLE ROW LEVEL SECURITY;

-- 3. DROP OLD POLICIES FOR CLEAN START
DROP POLICY IF EXISTS "Public_Select_Tournament" ON tournament;
DROP POLICY IF EXISTS "Admin1_Full_Tournament" ON tournament;
DROP POLICY IF EXISTS "Admin2_Tenant_Tournament" ON tournament;
DROP POLICY IF EXISTS "Public_Select_Events" ON events;
DROP POLICY IF EXISTS "Public_Select_Groups" ON groups;
DROP POLICY IF EXISTS "Public_Select_Teams" ON teams;
DROP POLICY IF EXISTS "Admin1_Full_Events" ON events;
DROP POLICY IF EXISTS "Admin1_Full_Groups" ON groups;
DROP POLICY IF EXISTS "Admin1_Full_Teams" ON teams;
DROP POLICY IF EXISTS "Admin2_Tenant_Events" ON events;
DROP POLICY IF EXISTS "Admin2_Tenant_Groups" ON groups;
DROP POLICY IF EXISTS "Admin2_Tenant_Teams" ON teams;
DROP POLICY IF EXISTS "Public_Select_Matches" ON matches;
DROP POLICY IF EXISTS "Admin1_Full_Matches" ON matches;
DROP POLICY IF EXISTS "Admin2_Tenant_Matches" ON matches;
DROP POLICY IF EXISTS "Admin3_Restricted_Matches" ON matches;
DROP POLICY IF EXISTS "Users_Read_Own_Account" ON accounts;
DROP POLICY IF EXISTS "Users_Manage_Own_Sessions" ON active_sessions;
DROP POLICY IF EXISTS "Users_Read_Own_Login_Logs" ON login_logs;

-- ACCOUNTS
CREATE POLICY "Accounts_Isolation" ON accounts FOR ALL TO authenticated
USING (
  get_auth_account_role() = 'SUPER_ADMIN' OR
  tenant_id = get_auth_account_tenant_id()
);

-- ACTIVE_SESSIONS (người dùng chỉ thấy session của mình)
CREATE POLICY "ActiveSessions_Isolation" ON active_sessions FOR ALL TO authenticated
USING (
  account_id = get_auth_account_id()
);

-- LOGIN_LOGS (tenant không xem được log tenant khác)
CREATE POLICY "LoginLogs_Isolation" ON login_logs FOR ALL TO authenticated
USING (
  get_auth_account_role() = 'SUPER_ADMIN' OR
  account_id IN (SELECT id FROM accounts WHERE tenant_id = get_auth_account_tenant_id())
);

-- GROUPS
CREATE POLICY "Groups_Isolation" ON groups FOR ALL TO authenticated
USING (
  get_auth_account_role() = 'SUPER_ADMIN' OR
  (get_auth_account_role() = 'TENANT_ADMIN' AND tenant_id = get_auth_account_tenant_id()) OR
  (get_auth_account_role() = 'EVENT_ADMIN' AND tenant_id = get_auth_account_tenant_id() AND event_id IN (SELECT event_id FROM account_event_permissions WHERE account_id = get_auth_account_id()))
);

-- TEAMS
CREATE POLICY "Teams_Isolation" ON teams FOR ALL TO authenticated
USING (
  get_auth_account_role() = 'SUPER_ADMIN' OR
  (get_auth_account_role() = 'TENANT_ADMIN' AND tenant_id = get_auth_account_tenant_id()) OR
  (get_auth_account_role() = 'EVENT_ADMIN' AND tenant_id = get_auth_account_tenant_id() AND event_id IN (SELECT event_id FROM account_event_permissions WHERE account_id = get_auth_account_id()))
);

-- MATCHES
CREATE POLICY "Matches_Isolation" ON matches FOR ALL TO authenticated
USING (
  get_auth_account_role() = 'SUPER_ADMIN' OR
  (get_auth_account_role() = 'TENANT_ADMIN' AND tenant_id = get_auth_account_tenant_id()) OR
  (get_auth_account_role() = 'EVENT_ADMIN' AND tenant_id = get_auth_account_tenant_id() AND event_id IN (SELECT event_id FROM account_event_permissions WHERE account_id = get_auth_account_id()))
);

-- ACCOUNT_PERMISSIONS (tenant không sửa permission tenant khác)
CREATE POLICY "AcctPerms_Isolation" ON account_permissions FOR ALL TO authenticated
USING (
  get_auth_account_role() = 'SUPER_ADMIN' OR
  (get_auth_account_role() = 'TENANT_ADMIN' AND account_id IN (SELECT id FROM accounts WHERE tenant_id = get_auth_account_tenant_id()))
);

-- ACCOUNT_EVENT_PERMISSIONS (event admin không tự cấp quyền)
CREATE POLICY "AcctEvtPerms_Isolation" ON account_event_permissions FOR ALL TO authenticated
USING (
  get_auth_account_role() = 'SUPER_ADMIN' OR
  account_id IN (SELECT id FROM accounts WHERE tenant_id = get_auth_account_tenant_id())
) WITH CHECK (
  get_auth_account_role() = 'SUPER_ADMIN' OR
  (get_auth_account_role() = 'TENANT_ADMIN' AND account_id IN (SELECT id FROM accounts WHERE tenant_id = get_auth_account_tenant_id())) OR
  (get_auth_account_role() = 'EVENT_ADMIN' AND account_id != get_auth_account_id() AND account_id IN (SELECT id FROM accounts WHERE tenant_id = get_auth_account_tenant_id()))
);

-- TOURNAMENT
CREATE POLICY "Tournament_Isolation" ON tournament FOR ALL TO authenticated
USING (
  get_auth_account_role() = 'SUPER_ADMIN' OR
  tenant_id = get_auth_account_tenant_id()
);
