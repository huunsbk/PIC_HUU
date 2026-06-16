-- Cấp quyền rõ ràng cho thao tác INSERT trên các bảng session và log
-- Bảng login_logs
DROP POLICY IF EXISTS "LoginLogs_Insert" ON login_logs;
CREATE POLICY "LoginLogs_Insert" ON login_logs FOR INSERT TO authenticated
WITH CHECK (
  account_id = get_auth_account_id() OR
  account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()) OR
  (SELECT user_id FROM accounts WHERE id = account_id) = auth.uid()
);

-- Bảng active_sessions
DROP POLICY IF EXISTS "ActiveSessions_Insert" ON active_sessions;
CREATE POLICY "ActiveSessions_Insert" ON active_sessions FOR INSERT TO authenticated
WITH CHECK (
  account_id = get_auth_account_id() OR
  account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()) OR
  (SELECT user_id FROM accounts WHERE id = account_id) = auth.uid()
);

-- Bảng accounts (Cho phép trigger tự động upsert nếu người dùng vừa được tạo bằng Auth signup)
DROP POLICY IF EXISTS "Accounts_Insert_Trigger" ON accounts;
CREATE POLICY "Accounts_Insert_Trigger" ON accounts FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid() OR get_auth_account_role() IN ('SUPER_ADMIN', 'TENANT_ADMIN')
);
