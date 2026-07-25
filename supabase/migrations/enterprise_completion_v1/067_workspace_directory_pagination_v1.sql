-- Cursor-paginated workspace directory with account-derived access scope.
-- V1 list functions remain intact for rollback compatibility.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_tournament_directory_created
  ON public.tournament (created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tournament_directory_tenant_created
  ON public.tournament (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

DROP FUNCTION IF EXISTS public.list_accessible_workspaces_page_v1(
  uuid, text, text, timestamptz, uuid, integer
);

CREATE OR REPLACE FUNCTION public.list_accessible_workspaces_page_v1(
  p_tenant_id uuid DEFAULT NULL,
  p_phase text DEFAULT 'operational',
  p_search text DEFAULT NULL,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid := public.current_account_id();
  v_tenant_id uuid := public.current_tenant_id();
  v_role text := public.current_role_name();
  v_tenant_type text;
  v_is_self_service_owner boolean := false;
  v_has_workspace_scope boolean := false;
  v_phase text := lower(COALESCE(NULLIF(btrim(p_phase), ''), 'operational'));
  v_search text := NULLIF(btrim(p_search), '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_rows jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next_created_at timestamptz;
  v_next_id text;
BEGIN
  IF auth.uid() IS NULL OR v_account_id IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF v_phase NOT IN ('operational', 'history', 'all') THEN
    RAISE EXCEPTION 'INVALID_WORKSPACE_PHASE';
  END IF;

  IF (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'INVALID_WORKSPACE_CURSOR';
  END IF;

  SELECT ten.tenant_type
  INTO v_tenant_type
  FROM public.tenants ten
  WHERE ten.id = v_tenant_id
    AND ten.deleted_at IS NULL
    AND COALESCE(ten.status, 'active') = 'active';

  IF v_role <> 'SUPER_ADMIN' AND v_tenant_type IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_CONTEXT_NOT_ACTIVE';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.self_service_customer_profiles sscp
    JOIN public.tenants ten ON ten.id = sscp.tenant_id
    WHERE sscp.account_id = v_account_id
      AND sscp.tenant_id = v_tenant_id
      AND sscp.onboarding_status = 'ready'
      AND ten.tenant_type = 'self_service_customer'
      AND ten.deleted_at IS NULL
      AND COALESCE(ten.status, 'active') = 'active'
      AND public.business_access_active_v1(ten.id)
  )
  INTO v_is_self_service_owner;

  v_has_workspace_scope :=
    v_role = 'SUPER_ADMIN'
    OR v_role = 'TENANT_ADMIN'
    OR public.has_permission('manage_tournaments')
    OR v_is_self_service_owner;

  WITH accessible AS (
    SELECT
      t.id AS tournament_id,
      t.tenant_id,
      ten.name AS tenant_name,
      t.name,
      t.slug,
      t.location,
      COALESCE(t.start_date::text, t.date) AS start_date,
      COALESCE(t.status, 'active') AS status,
      t.created_at,
      (
        SELECT count(*)
        FROM public.events e
        WHERE e.tournament_id = t.id
          AND e.deleted_at IS NULL
          AND COALESCE(e.status, 'active') <> 'archived'
          AND (
            v_has_workspace_scope
            OR EXISTS (
              SELECT 1
              FROM public.account_event_permissions aep
              WHERE aep.account_id = v_account_id
                AND aep.event_id = e.id
                AND aep.deleted_at IS NULL
                AND COALESCE(aep.tenant_id, t.tenant_id) = t.tenant_id
            )
          )
      )::integer AS events_count,
      (
        SELECT count(*)
        FROM public.teams tm
        WHERE tm.tournament_id = t.id
          AND tm.deleted_at IS NULL
          AND (
            v_has_workspace_scope
            OR EXISTS (
              SELECT 1
              FROM public.account_event_permissions aep
              WHERE aep.account_id = v_account_id
                AND aep.event_id = tm.event_id
                AND aep.deleted_at IS NULL
                AND COALESCE(aep.tenant_id, t.tenant_id) = t.tenant_id
            )
          )
      )::integer AS teams_count,
      (
        SELECT count(*)
        FROM public.matches m
        WHERE m.tournament_id = t.id
          AND m.deleted_at IS NULL
          AND (
            v_has_workspace_scope
            OR EXISTS (
              SELECT 1
              FROM public.account_event_permissions aep
              WHERE aep.account_id = v_account_id
                AND aep.event_id = m.event_id
                AND aep.deleted_at IS NULL
                AND COALESCE(aep.tenant_id, t.tenant_id) = t.tenant_id
            )
          )
      )::integer AS matches_count,
      CASE
        WHEN v_role = 'SUPER_ADMIN' THEN 'system'
        WHEN v_is_self_service_owner THEN 'self_service_owner'
        WHEN t.tenant_id = v_tenant_id
          AND (v_role = 'TENANT_ADMIN' OR public.has_permission('manage_tournaments'))
          THEN 'tenant'
        ELSE 'event'
      END AS access_scope
    FROM public.tournament t
    JOIN public.tenants ten ON ten.id = t.tenant_id
    WHERE t.deleted_at IS NULL
      AND NULLIF(btrim(t.slug), '') IS NOT NULL
      AND ten.deleted_at IS NULL
      AND COALESCE(ten.status, 'active') = 'active'
      AND (
        (v_phase = 'operational' AND COALESCE(t.status, 'active') IN ('active', 'draft'))
        OR (v_phase = 'history' AND COALESCE(t.status, 'active') = 'completed')
        OR (v_phase = 'all' AND COALESCE(t.status, 'active') IN ('active', 'draft', 'completed'))
      )
      AND (
        v_search IS NULL
        OR t.name ILIKE '%' || v_search || '%'
        OR t.slug ILIKE '%' || v_search || '%'
        OR ten.name ILIKE '%' || v_search || '%'
      )
      AND (
        (v_role = 'SUPER_ADMIN' AND (p_tenant_id IS NULL OR t.tenant_id = p_tenant_id))
        OR (
          v_role <> 'SUPER_ADMIN'
          AND t.tenant_id = v_tenant_id
          AND (
            v_role = 'TENANT_ADMIN'
            OR public.has_permission('manage_tournaments')
            OR v_is_self_service_owner
            OR EXISTS (
              SELECT 1
              FROM public.account_event_permissions aep
              JOIN public.events e ON e.id = aep.event_id
              WHERE aep.account_id = v_account_id
                AND aep.deleted_at IS NULL
                AND e.tournament_id = t.id
                AND e.deleted_at IS NULL
                AND COALESCE(e.status, 'active') <> 'archived'
                AND COALESCE(aep.tenant_id, t.tenant_id) = t.tenant_id
            )
          )
        )
      )
      AND (
        p_cursor_created_at IS NULL
        OR (t.created_at, t.id) < (p_cursor_created_at, p_cursor_id)
      )
  ),
  page_plus_one AS (
    SELECT *
    FROM accessible
    ORDER BY created_at DESC, tournament_id DESC
    LIMIT v_limit + 1
  ),
  visible_page AS (
    SELECT *
    FROM page_plus_one
    ORDER BY created_at DESC, tournament_id DESC
    LIMIT v_limit
  )
  SELECT
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'tournament_id', row_data.tournament_id,
            'id', row_data.tournament_id,
            'tenant_id', row_data.tenant_id,
            'tenant_name', row_data.tenant_name,
            'name', row_data.name,
            'slug', row_data.slug,
            'location', row_data.location,
            'start_date', row_data.start_date,
            'status', row_data.status,
            'created_at', row_data.created_at,
            'events_count', row_data.events_count,
            'teams_count', row_data.teams_count,
            'matches_count', row_data.matches_count,
            'access_scope', row_data.access_scope
          )
          ORDER BY row_data.created_at DESC, row_data.tournament_id DESC
        )
        FROM visible_page row_data
      ),
      '[]'::jsonb
    ),
    (SELECT count(*) > v_limit FROM page_plus_one),
    (
      SELECT last_row.created_at
      FROM visible_page last_row
      ORDER BY last_row.created_at ASC, last_row.tournament_id ASC
      LIMIT 1
    ),
    (
      SELECT last_row.tournament_id
      FROM visible_page last_row
      ORDER BY last_row.created_at ASC, last_row.tournament_id ASC
      LIMIT 1
    )
  INTO v_rows, v_has_more, v_next_created_at, v_next_id;

  RETURN jsonb_build_object(
    'data', v_rows,
    'has_more', v_has_more,
    'next_cursor', CASE
      WHEN v_has_more AND v_next_created_at IS NOT NULL AND v_next_id IS NOT NULL
        THEN jsonb_build_object('created_at', v_next_created_at, 'id', v_next_id)
      ELSE NULL
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_accessible_workspaces_page_v1(
  uuid, text, text, timestamptz, text, integer
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.list_accessible_workspaces_page_v1(
  uuid, text, text, timestamptz, text, integer
) TO authenticated;

COMMIT;
