-- Prompt: accessible workspace list and account scope visibility.
-- Adds read-only RPCs for role-scoped tournament access and account permission summaries.

CREATE OR REPLACE FUNCTION public.list_accessible_workspaces_v1(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
  v_role_name text;
  v_tenant_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_account_id := public.current_account_id();
  v_role_name := public.current_role_name();
  v_tenant_id := public.current_tenant_id();

  IF v_account_id IS NULL OR v_role_name IS NULL THEN
    RAISE EXCEPTION 'Account context not found';
  END IF;

  IF v_role_name = 'SUPER_ADMIN' THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'tenant_name', row_data->>'created_at' DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'tournament_id', t.id,
          'id', t.id,
          'tenant_id', t.tenant_id,
          'tenant_name', ten.name,
          'name', t.name,
          'slug', t.slug,
          'location', t.location,
          'start_date', COALESCE(t.start_date::text, t.date),
          'status', COALESCE(t.status, 'active'),
          'created_at', t.created_at,
          'updated_at', t.updated_at,
          'events_count', (SELECT count(*) FROM public.events e WHERE e.tournament_id = t.id AND e.deleted_at IS NULL),
          'teams_count', (SELECT count(*) FROM public.teams tm WHERE tm.tournament_id = t.id AND tm.deleted_at IS NULL),
          'matches_count', (SELECT count(*) FROM public.matches m WHERE m.tournament_id = t.id AND m.deleted_at IS NULL),
          'access_scope', 'system'
        ) AS row_data
        FROM public.tournament t
        JOIN public.tenants ten ON ten.id = t.tenant_id
        WHERE t.deleted_at IS NULL
          AND ten.deleted_at IS NULL
          AND (p_tenant_id IS NULL OR t.tenant_id = p_tenant_id)
      ) rows
    );
  END IF;

  IF v_role_name = 'TENANT_ADMIN' OR public.has_permission('manage_tournaments') THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'created_at' DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'tournament_id', t.id,
          'id', t.id,
          'tenant_id', t.tenant_id,
          'tenant_name', ten.name,
          'name', t.name,
          'slug', t.slug,
          'location', t.location,
          'start_date', COALESCE(t.start_date::text, t.date),
          'status', COALESCE(t.status, 'active'),
          'created_at', t.created_at,
          'updated_at', t.updated_at,
          'events_count', (SELECT count(*) FROM public.events e WHERE e.tournament_id = t.id AND e.deleted_at IS NULL),
          'teams_count', (SELECT count(*) FROM public.teams tm WHERE tm.tournament_id = t.id AND tm.deleted_at IS NULL),
          'matches_count', (SELECT count(*) FROM public.matches m WHERE m.tournament_id = t.id AND m.deleted_at IS NULL),
          'access_scope', 'tenant'
        ) AS row_data
        FROM public.tournament t
        JOIN public.tenants ten ON ten.id = t.tenant_id
        WHERE t.deleted_at IS NULL
          AND ten.deleted_at IS NULL
          AND t.tenant_id = v_tenant_id
      ) rows
    );
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'tenant_name', row_data->>'created_at' DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'tournament_id', t.id,
        'id', t.id,
        'tenant_id', t.tenant_id,
        'tenant_name', ten.name,
        'name', t.name,
        'slug', t.slug,
        'location', t.location,
        'start_date', COALESCE(t.start_date::text, t.date),
        'status', COALESCE(t.status, 'active'),
        'created_at', t.created_at,
        'updated_at', t.updated_at,
        'events_count', count(DISTINCT e.id),
        'teams_count', (SELECT count(*) FROM public.teams tm WHERE tm.tournament_id = t.id AND tm.deleted_at IS NULL),
        'matches_count', (SELECT count(*) FROM public.matches m WHERE m.tournament_id = t.id AND m.deleted_at IS NULL),
        'access_scope', 'event'
      ) AS row_data
      FROM public.account_event_permissions aep
      JOIN public.events e ON e.id = aep.event_id
      JOIN public.tournament t ON t.id = e.tournament_id
      JOIN public.tenants ten ON ten.id = t.tenant_id
      WHERE aep.account_id = v_account_id
        AND aep.deleted_at IS NULL
        AND e.deleted_at IS NULL
        AND t.deleted_at IS NULL
        AND ten.deleted_at IS NULL
        AND aep.tenant_id = t.tenant_id
      GROUP BY t.id, t.tenant_id, ten.name, t.name, t.slug, t.location, t.start_date, t.date, t.status, t.created_at, t.updated_at
    ) rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_account_access_summary_v1(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_role_name text;
  v_tenant_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_role_name := public.current_role_name();
  v_tenant_id := public.current_tenant_id();

  IF v_role_name = 'SUPER_ADMIN' THEN
    v_tenant_id := p_tenant_id;
  ELSIF v_role_name = 'TENANT_ADMIN' OR public.has_permission('manage_accounts') THEN
    v_tenant_id := public.current_tenant_id();
  ELSE
    RAISE EXCEPTION 'Permission denied: manage_accounts required';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'account_id', a.id,
        'username', a.username,
        'display_name', a.display_name,
        'tenant_id', a.tenant_id,
        'tenant_name', ten.name,
        'role_name', r.name,
        'status', a.status,
        'event_grants', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'event_id', e.id,
              'event_name', e.name,
              'tournament_id', t.id,
              'tournament_name', t.name,
              'tournament_slug', t.slug,
              'permission', COALESCE(aep.permission, 'enter_scores')
            )
            ORDER BY t.name, e.name, COALESCE(aep.permission, 'enter_scores')
          )
          FROM public.account_event_permissions aep
          JOIN public.events e ON e.id = aep.event_id
          JOIN public.tournament t ON t.id = e.tournament_id
          WHERE aep.account_id = a.id
            AND aep.deleted_at IS NULL
            AND e.deleted_at IS NULL
            AND t.deleted_at IS NULL
        ), '[]'::jsonb)
      )
      ORDER BY ten.name, r.name, a.display_name, a.username
    ), '[]'::jsonb)
    FROM public.accounts a
    JOIN public.roles r ON r.id = a.role_id
    LEFT JOIN public.tenants ten ON ten.id = a.tenant_id
    WHERE a.deleted_at IS NULL
      AND (v_tenant_id IS NULL OR a.tenant_id = v_tenant_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_accessible_workspaces_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_account_access_summary_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_accessible_workspaces_v1(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.list_account_access_summary_v1(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.list_accessible_workspaces_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_access_summary_v1(uuid) TO authenticated;
