-- Canonical post-login workspace decision and strict slug guard.
-- Additive V2 contract: V1 functions remain available during rollout.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_post_login_destination_v2()
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
  v_can_create_tournament boolean := false;
  v_operational_count integer := 0;
  v_operational_rows jsonb := '[]'::jsonb;
  v_has_history boolean := false;
  v_empty_reason text := 'NO_ACCESSIBLE_WORKSPACE';
BEGIN
  IF auth.uid() IS NULL OR v_account_id IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
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

  IF v_role = 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object(
      'kind', 'DIRECTORY',
      'initial_filter', 'all'
    );
  END IF;

  IF v_tenant_type = 'self_service_customer'
     AND NOT public.business_access_active_v1(v_tenant_id)
  THEN
    RETURN jsonb_build_object('kind', 'COMMERCIAL_REQUIRED');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.self_service_customer_profiles sscp
    WHERE sscp.account_id = v_account_id
      AND sscp.tenant_id = v_tenant_id
      AND sscp.onboarding_status = 'ready'
  )
  INTO v_is_self_service_owner;

  v_can_create_tournament :=
    v_tenant_type <> 'self_service_customer'
    AND (
      v_role = 'TENANT_ADMIN'
      OR public.has_permission('manage_tournaments')
    );

  SELECT
    count(*)::integer,
    COALESCE(jsonb_agg(to_jsonb(candidate) ORDER BY candidate.created_at DESC, candidate.tournament_id DESC), '[]'::jsonb)
  INTO v_operational_count, v_operational_rows
  FROM (
    SELECT
      t.id AS tournament_id,
      t.tenant_id,
      t.slug,
      t.name,
      COALESCE(t.status, 'active') AS status,
      t.created_at,
      CASE
        WHEN v_role = 'TENANT_ADMIN' OR public.has_permission('manage_tournaments') THEN 'tenant'
        WHEN v_is_self_service_owner THEN 'self_service_owner'
        ELSE 'event'
      END AS effective_scope
    FROM public.tournament t
    JOIN public.tenants ten ON ten.id = t.tenant_id
    WHERE t.deleted_at IS NULL
      AND NULLIF(btrim(t.slug), '') IS NOT NULL
      AND COALESCE(t.status, 'active') IN ('active', 'draft')
      AND ten.deleted_at IS NULL
      AND COALESCE(ten.status, 'active') = 'active'
      AND (
        (
          t.tenant_id = v_tenant_id
          AND (
            v_role = 'TENANT_ADMIN'
            OR public.has_permission('manage_tournaments')
            OR v_is_self_service_owner
          )
        )
        OR EXISTS (
          SELECT 1
          FROM public.account_event_permissions aep
          JOIN public.events e ON e.id = aep.event_id
          WHERE aep.account_id = v_account_id
            AND aep.deleted_at IS NULL
            AND e.tournament_id = t.id
            AND e.deleted_at IS NULL
            AND COALESCE(e.status, 'active') IN ('active', 'draft')
            AND COALESCE(aep.tenant_id, t.tenant_id) = t.tenant_id
        )
      )
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT 2
  ) candidate;

  IF v_operational_count = 1 THEN
    RETURN jsonb_build_object(
      'kind', 'AUTO_ENTER',
      'workspace', (v_operational_rows -> 0) - 'created_at'
    );
  END IF;

  IF v_operational_count > 1 THEN
    RETURN jsonb_build_object(
      'kind', 'DIRECTORY',
      'initial_filter', 'operational'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.tournament t
    JOIN public.tenants ten ON ten.id = t.tenant_id
    WHERE t.deleted_at IS NULL
      AND NULLIF(btrim(t.slug), '') IS NOT NULL
      AND COALESCE(t.status, 'active') = 'completed'
      AND ten.deleted_at IS NULL
      AND COALESCE(ten.status, 'active') = 'active'
      AND (
        (
          t.tenant_id = v_tenant_id
          AND (
            v_role = 'TENANT_ADMIN'
            OR public.has_permission('manage_tournaments')
            OR v_is_self_service_owner
          )
        )
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
  INTO v_has_history;

  IF v_has_history THEN
    RETURN jsonb_build_object(
      'kind', 'DIRECTORY',
      'initial_filter', 'history'
    );
  END IF;

  IF v_is_self_service_owner THEN
    v_empty_reason := 'PROVISIONING_REQUIRED';
  ELSIF v_role = 'TENANT_ADMIN' OR public.has_permission('manage_tournaments') THEN
    v_empty_reason := 'TENANT_HAS_NO_WORKSPACE';
  ELSIF v_role IN ('EVENT_ADMIN', 'REFEREE', 'VIEWER') THEN
    v_empty_reason := 'NO_ACTIVE_ASSIGNMENT';
  END IF;

  RETURN jsonb_build_object(
    'kind', 'EMPTY',
    'reason', v_empty_reason,
    'can_create_tournament', v_can_create_tournament
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_accessible_workspace_by_slug_v2(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid := public.current_account_id();
  v_account_tenant_id uuid := public.current_tenant_id();
  v_role text := public.current_role_name();
  v_slug text := lower(NULLIF(btrim(p_slug), ''));
  v_workspace record;
  v_allowed boolean := false;
  v_effective_scope text;
  v_access_mode text := 'read_only';
BEGIN
  IF auth.uid() IS NULL OR v_account_id IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF v_slug IS NULL THEN
    PERFORM public.record_security_audit_v1(
      'WORKSPACE_ACCESS_DENIED', 'workspace', NULL, 'deny',
      'invalid_workspace_slug', '{}'::jsonb
    );
    RETURN jsonb_build_object('allowed', false);
  END IF;

  SELECT
    t.id AS tournament_id,
    t.tenant_id,
    t.name AS tournament_name,
    t.slug AS canonical_slug,
    COALESCE(t.status, 'active') AS tournament_status,
    ten.name AS tenant_name,
    ten.tenant_type
  INTO v_workspace
  FROM public.tournament t
  JOIN public.tenants ten ON ten.id = t.tenant_id
  WHERE t.slug = v_slug
    AND t.deleted_at IS NULL
    AND COALESCE(t.status, 'active') IN ('active', 'draft', 'completed')
    AND ten.deleted_at IS NULL
    AND COALESCE(ten.status, 'active') = 'active'
  LIMIT 1;

  IF v_workspace.tournament_id IS NULL THEN
    PERFORM public.record_security_audit_v1(
      'WORKSPACE_ACCESS_DENIED', 'workspace', v_slug, 'deny',
      'workspace_not_available', '{}'::jsonb
    );
    RETURN jsonb_build_object('allowed', false);
  END IF;

  IF v_role <> 'SUPER_ADMIN'
     AND v_workspace.tenant_type = 'self_service_customer'
     AND NOT public.business_access_active_v1(v_workspace.tenant_id)
  THEN
    PERFORM public.record_security_audit_v1(
      'WORKSPACE_ACCESS_DENIED', 'workspace', v_slug, 'deny',
      'commercial_access_required',
      jsonb_build_object('requested_tournament_id', v_workspace.tournament_id)
    );
    RETURN jsonb_build_object('allowed', false);
  END IF;

  IF v_role = 'SUPER_ADMIN' THEN
    v_allowed := true;
    v_effective_scope := 'system';
    v_access_mode := CASE WHEN v_workspace.tournament_status = 'completed' THEN 'read_only' ELSE 'manage' END;
  ELSIF v_account_tenant_id = v_workspace.tenant_id
    AND (
      v_role = 'TENANT_ADMIN'
      OR public.has_permission('manage_tournaments')
    )
  THEN
    v_allowed := true;
    v_effective_scope := 'tenant';
    v_access_mode := CASE WHEN v_workspace.tournament_status = 'completed' THEN 'read_only' ELSE 'manage' END;
  ELSIF v_role = 'EVENT_ADMIN'
    AND v_workspace.tenant_type = 'self_service_customer'
    AND v_account_tenant_id = v_workspace.tenant_id
    AND EXISTS (
      SELECT 1
      FROM public.self_service_customer_profiles sscp
      WHERE sscp.account_id = v_account_id
        AND sscp.tenant_id = v_workspace.tenant_id
        AND sscp.onboarding_status = 'ready'
    )
  THEN
    v_allowed := true;
    v_effective_scope := 'self_service_owner';
    v_access_mode := CASE WHEN v_workspace.tournament_status = 'completed' THEN 'read_only' ELSE 'manage' END;
  ELSIF EXISTS (
    SELECT 1
    FROM public.account_event_permissions aep
    JOIN public.events e ON e.id = aep.event_id
    WHERE aep.account_id = v_account_id
      AND aep.deleted_at IS NULL
      AND e.tournament_id = v_workspace.tournament_id
      AND e.deleted_at IS NULL
      AND COALESCE(e.status, 'active') <> 'archived'
      AND COALESCE(aep.tenant_id, v_workspace.tenant_id) = v_workspace.tenant_id
  )
  THEN
    v_allowed := true;
    v_effective_scope := 'event';

    IF v_workspace.tournament_status = 'completed' THEN
      v_access_mode := 'read_only';
    ELSIF EXISTS (
      SELECT 1
      FROM public.account_event_permissions aep
      JOIN public.events e ON e.id = aep.event_id
      WHERE aep.account_id = v_account_id
        AND aep.deleted_at IS NULL
        AND e.tournament_id = v_workspace.tournament_id
        AND e.deleted_at IS NULL
        AND COALESCE(e.status, 'active') <> 'archived'
        AND (
          COALESCE(aep.permission, 'enter_scores') LIKE 'manage\_%' ESCAPE '\'
          OR COALESCE(aep.permission, '') IN ('create_events', 'archive_events')
        )
    ) THEN
      v_access_mode := 'manage';
    ELSIF EXISTS (
      SELECT 1
      FROM public.account_event_permissions aep
      JOIN public.events e ON e.id = aep.event_id
      WHERE aep.account_id = v_account_id
        AND aep.deleted_at IS NULL
        AND e.tournament_id = v_workspace.tournament_id
        AND e.deleted_at IS NULL
        AND COALESCE(e.status, 'active') <> 'archived'
        AND COALESCE(aep.permission, 'enter_scores') = 'enter_scores'
    ) THEN
      v_access_mode := 'operate';
    END IF;
  END IF;

  IF NOT v_allowed THEN
    PERFORM public.record_security_audit_v1(
      'WORKSPACE_ACCESS_DENIED', 'workspace', v_slug, 'deny',
      'permission_denied',
      jsonb_build_object('requested_tournament_id', v_workspace.tournament_id)
    );
    RETURN jsonb_build_object('allowed', false);
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'workspace', jsonb_build_object(
      'tournament_id', v_workspace.tournament_id,
      'tenant_id', v_workspace.tenant_id,
      'tenant_name', v_workspace.tenant_name,
      'tournament_name', v_workspace.tournament_name,
      'canonical_slug', v_workspace.canonical_slug,
      'status', v_workspace.tournament_status,
      'phase', CASE
        WHEN v_workspace.tournament_status IN ('active', 'draft') THEN 'operational'
        ELSE 'history'
      END,
      'effective_scope', v_effective_scope,
      'access_mode', v_access_mode
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_post_login_destination_v2()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_post_login_destination_v2()
  TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_accessible_workspace_by_slug_v2(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_accessible_workspace_by_slug_v2(text)
  TO authenticated;

COMMIT;
