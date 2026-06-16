-- migration_get_profile.sql
-- Nâng cấp và đồng bộ hoá hàm get_current_profile để nó trả về toàn bộ role_permissions chuẩn

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
      a.user_id,
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
