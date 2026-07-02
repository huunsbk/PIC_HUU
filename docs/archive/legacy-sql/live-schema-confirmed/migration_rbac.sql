-- migration_rbac.sql

-- 1. Tạo bảng role_permissions (nếu chưa có)
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 2. Tạo bảng account_event_permissions (nếu chưa có)
CREATE TABLE IF NOT EXISTS account_event_permissions (
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    event_id TEXT,
    PRIMARY KEY (account_id, event_id)
);

-- 3. Cập nhật hàm get_current_profile
CREATE OR REPLACE FUNCTION get_current_profile()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(t)
  FROM (
    SELECT 
      a.id AS account_id,
      a.username,
      a.display_name,
      a.tenant_id,
      r.name AS role,
      COALESCE(
        (
          SELECT json_agg(p.name)
          FROM role_permissions rp
          JOIN permissions p ON rp.permission_id = p.id
          WHERE rp.role_id = a.role_id
        ),
        '[]'::json
      ) AS role_permissions,
      COALESCE(
        (
          SELECT json_agg(p.name)
          FROM account_permissions ap
          JOIN permissions p ON ap.permission_id = p.id
          WHERE ap.account_id = a.id
        ),
        '[]'::json
      ) AS account_permissions,
      COALESCE(
        (
          SELECT json_agg(aep.event_id)
          FROM account_event_permissions aep
          WHERE aep.account_id = a.id
        ),
        '[]'::json
      ) AS event_ids
    FROM accounts a
    LEFT JOIN roles r ON a.role_id = r.id
    WHERE a.user_id = auth.uid()
    LIMIT 1
  ) t;
$$;

-- 4. Tự động seed dữ liệu role_permissions
-- Giả sử ta lấy các permission có sẵn
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'TENANT_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'EVENT_ADMIN' 
  AND p.name IN ('manage_events', 'manage_matches', 'manage_scores', 'manage_brackets')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'REFEREE' 
  AND p.name IN ('manage_scores')
ON CONFLICT DO NOTHING;
