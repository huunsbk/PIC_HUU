-- Deduplicate event lists after event permissions became one row per permission.
-- Also expose per-event effective permissions so the frontend can enforce the
-- account-management checkbox state as the final source of truth.

CREATE OR REPLACE FUNCTION public.get_current_profile()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public, pg_temp
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
      COALESCE((
        SELECT json_agg(p.name ORDER BY p.name)
        FROM public.role_permissions rp
        JOIN public.permissions p ON rp.permission_id = p.id
        WHERE rp.role_id = a.role_id
      ), '[]'::json) AS role_permissions,
      COALESCE((
        SELECT json_agg(p.name ORDER BY p.name)
        FROM public.account_permissions ap
        JOIN public.permissions p ON ap.permission_id = p.id
        WHERE ap.account_id = a.id
      ), '[]'::json) AS account_permissions,
      COALESCE((
        SELECT json_agg(event_id ORDER BY event_id)
        FROM (
          SELECT DISTINCT aep.event_id
          FROM public.account_event_permissions aep
          JOIN public.events e ON e.id = aep.event_id
          WHERE aep.account_id = a.id
            AND aep.deleted_at IS NULL
            AND e.deleted_at IS NULL
        ) scoped_events
      ), '[]'::json) AS event_ids,
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'event_id', event_id,
            'permissions', permissions
          )
          ORDER BY event_id
        )
        FROM (
          SELECT
            aep.event_id,
            json_agg(DISTINCT COALESCE(aep.permission, 'enter_scores') ORDER BY COALESCE(aep.permission, 'enter_scores')) AS permissions
          FROM public.account_event_permissions aep
          JOIN public.events e ON e.id = aep.event_id
          WHERE aep.account_id = a.id
            AND aep.deleted_at IS NULL
            AND e.deleted_at IS NULL
          GROUP BY aep.event_id
        ) event_permission_rows
      ), '[]'::json) AS event_permissions
    FROM public.accounts a
    LEFT JOIN public.roles r ON a.role_id = r.id
    WHERE a.user_id = auth.uid()
      AND a.deleted_at IS NULL
      AND a.status = 'active'
    LIMIT 1
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.list_events_by_tournament_v1(p_tournament_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_tournament public.tournament%ROWTYPE;
  v_role text;
  v_account_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_tournament
  FROM public.tournament
  WHERE id = p_tournament_id
    AND deleted_at IS NULL;

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'Tournament not found';
  END IF;

  v_role := public.current_role_name();
  v_account_id := public.current_account_id();

  IF v_role = 'SUPER_ADMIN'
    OR (v_role = 'TENANT_ADMIN' AND v_tournament.tenant_id = public.current_tenant_id())
  THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.name), '[]'::jsonb)
      FROM public.events e
      WHERE e.tournament_id = p_tournament_id
        AND e.deleted_at IS NULL
    );
  END IF;

  IF v_role IN ('EVENT_ADMIN', 'REFEREE') THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.name), '[]'::jsonb)
      FROM public.events e
      WHERE e.tournament_id = p_tournament_id
        AND e.deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.account_event_permissions aep
          WHERE aep.event_id = e.id
            AND aep.account_id = v_account_id
            AND aep.deleted_at IS NULL
            AND COALESCE(aep.tenant_id, v_tournament.tenant_id) = v_tournament.tenant_id
        )
    );
  END IF;

  RAISE EXCEPTION 'Permission denied for list_events_by_tournament_v1';
END;
$$;

REVOKE ALL ON FUNCTION public.get_current_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_events_by_tournament_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_current_profile() FROM anon;
REVOKE ALL ON FUNCTION public.list_events_by_tournament_v1(text) FROM anon;

GRANT EXECUTE ON FUNCTION public.get_current_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_events_by_tournament_v1(text) TO authenticated;
