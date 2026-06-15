-- migration.sql
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
          FROM account_permissions ap
          JOIN permissions p ON ap.permission_id = p.id
          WHERE ap.account_id = a.id
        ),
        '[]'::json
      ) AS permissions
    FROM accounts a
    LEFT JOIN roles r ON a.role_id = r.id
    WHERE a.user_id = auth.uid()
    LIMIT 1
  ) t;
$$;
