-- Fix RLS for login_logs and active_sessions to ensure users can log in
DROP POLICY IF EXISTS "LoginLogs_Isolation" ON login_logs;
DROP POLICY IF EXISTS "LoginLogs_Insert" ON login_logs;

CREATE POLICY "LoginLogs_Isolation" ON login_logs FOR SELECT TO authenticated
USING (
  account_id = get_auth_account_id() OR
  (get_auth_account_role() IN ('SUPER_ADMIN', 'TENANT_ADMIN') AND 
   account_id IN (SELECT id FROM accounts WHERE tenant_id = get_auth_account_tenant_id()))
);

CREATE POLICY "LoginLogs_Insert" ON login_logs FOR INSERT TO authenticated
WITH CHECK (
  account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "ActiveSessions_Isolation" ON active_sessions;
DROP POLICY IF EXISTS "ActiveSessions_Insert" ON active_sessions;

CREATE POLICY "ActiveSessions_Isolation" ON active_sessions FOR SELECT TO authenticated
USING (
  account_id = get_auth_account_id() OR
  (get_auth_account_role() IN ('SUPER_ADMIN', 'TENANT_ADMIN') AND 
   account_id IN (SELECT id FROM accounts WHERE tenant_id = get_auth_account_tenant_id()))
);

CREATE POLICY "ActiveSessions_Insert" ON active_sessions FOR INSERT TO authenticated
WITH CHECK (
  account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid())
);

CREATE POLICY "ActiveSessions_Delete" ON active_sessions FOR DELETE TO authenticated
USING (
  account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid())
);

CREATE POLICY "ActiveSessions_Update" ON active_sessions FOR UPDATE TO authenticated
USING (
  account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid())
);
