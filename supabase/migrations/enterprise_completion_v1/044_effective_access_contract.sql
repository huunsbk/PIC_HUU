-- Phase 5C: normalize current role and event permissions into a read-only
-- effective access contract without introducing a parallel grant table.

CREATE OR REPLACE FUNCTION public.list_my_effective_access_grants_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid := public.current_account_id();
  v_tenant_id uuid := public.current_tenant_id();
  v_role text := public.current_role_name();
  v_grants jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_account_id IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF v_role = 'SUPER_ADMIN' THEN
    v_grants := jsonb_build_array(jsonb_build_object(
      'subject_id', v_account_id,
      'action', '*',
      'resource_type', 'system',
      'resource_id', '*',
      'scope_type', 'system',
      'scope_id', '*',
      'tenant_id', NULL,
      'tournament_id', NULL,
      'event_id', NULL,
      'source', 'role',
      'starts_at', NULL,
      'ends_at', NULL,
      'status', 'active',
      'result', 'allow',
      'conditions', jsonb_build_object('account_active', true)
    ));
  ELSIF v_role = 'TENANT_ADMIN' THEN
    v_grants := jsonb_build_array(jsonb_build_object(
      'subject_id', v_account_id,
      'action', '*',
      'resource_type', 'tenant',
      'resource_id', v_tenant_id,
      'scope_type', 'tenant',
      'scope_id', v_tenant_id,
      'tenant_id', v_tenant_id,
      'tournament_id', NULL,
      'event_id', NULL,
      'source', 'role',
      'starts_at', NULL,
      'ends_at', NULL,
      'status', 'active',
      'result', 'allow',
      'conditions', jsonb_build_object('account_active', true, 'tenant_active', true)
    ));
  ELSE
    SELECT COALESCE(jsonb_agg(grant_row ORDER BY grant_row->>'tournament_id', grant_row->>'event_id', grant_row->>'action'), '[]'::jsonb)
    INTO v_grants
    FROM (
      SELECT DISTINCT jsonb_build_object(
        'subject_id', v_account_id,
        'action', COALESCE(aep.permission, 'enter_scores'),
        'resource_type', 'event',
        'resource_id', e.id,
        'scope_type', 'event',
        'scope_id', e.id,
        'tenant_id', t.tenant_id,
        'tournament_id', t.id,
        'event_id', e.id,
        'source', 'account_event_permission',
        'starts_at', aep.created_at,
        'ends_at', NULL,
        'status', 'active',
        'result', 'allow',
        'conditions', jsonb_build_object(
          'account_active', true,
          'tenant_active', true,
          'tournament_active', true,
          'event_active', true
        )
      ) AS grant_row
      FROM public.account_event_permissions aep
      JOIN public.events e ON e.id = aep.event_id
      JOIN public.tournament t ON t.id = e.tournament_id
      JOIN public.tenants ten ON ten.id = t.tenant_id
      WHERE aep.account_id = v_account_id
        AND aep.deleted_at IS NULL
        AND COALESCE(aep.tenant_id, t.tenant_id) = t.tenant_id
        AND e.deleted_at IS NULL
        AND COALESCE(e.status, 'active') <> 'archived'
        AND t.deleted_at IS NULL
        AND COALESCE(t.status, 'active') <> 'archived'
        AND ten.deleted_at IS NULL
        AND COALESCE(ten.status, 'active') <> 'archived'
    ) effective_rows;
  END IF;

  RETURN jsonb_build_object(
    'contract_version', 1,
    'account_id', v_account_id,
    'role', v_role,
    'generated_at', now(),
    'grants', v_grants
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_workspace_v1(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid := public.current_account_id();
  v_account_tenant_id uuid := public.current_tenant_id();
  v_role text := public.current_role_name();
  v_workspace record;
  v_allowed boolean := false;
  v_scope text;
BEGIN
  IF auth.uid() IS NULL OR v_account_id IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF NULLIF(btrim(p_slug), '') IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'WORKSPACE_NOT_AVAILABLE');
  END IF;

  SELECT
    t.id AS tournament_id,
    t.tenant_id,
    t.name AS tournament_name,
    t.slug AS tournament_slug,
    ten.name AS tenant_name
  INTO v_workspace
  FROM public.tournament t
  JOIN public.tenants ten ON ten.id = t.tenant_id
  WHERE t.deleted_at IS NULL
    AND COALESCE(t.status, 'active') <> 'archived'
    AND ten.deleted_at IS NULL
    AND COALESCE(ten.status, 'active') <> 'archived'
    AND (
      t.slug = p_slug
      OR t.id = p_slug
      OR ten.slug = p_slug
      OR ten.id::text = p_slug
    )
  ORDER BY
    CASE WHEN t.slug = p_slug OR t.id = p_slug THEN 0 ELSE 1 END,
    CASE WHEN COALESCE(t.status, 'active') = 'active' THEN 0 ELSE 1 END,
    t.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_workspace.tournament_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'WORKSPACE_NOT_AVAILABLE');
  END IF;

  IF v_role = 'SUPER_ADMIN' THEN
    v_allowed := true;
    v_scope := 'system';
  ELSIF v_role = 'TENANT_ADMIN' AND v_account_tenant_id = v_workspace.tenant_id THEN
    v_allowed := true;
    v_scope := 'tenant';
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
  ) THEN
    v_allowed := true;
    v_scope := 'event';
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'WORKSPACE_NOT_AVAILABLE');
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reason', 'ACCESS_GRANTED',
    'access_scope', v_scope,
    'workspace', jsonb_build_object(
      'tenant_id', v_workspace.tenant_id,
      'tenant_name', v_workspace.tenant_name,
      'tournament_id', v_workspace.tournament_id,
      'tournament_name', v_workspace.tournament_name,
      'slug', v_workspace.tournament_slug
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_effective_access_grants_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_workspace_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_effective_access_grants_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_workspace_v1(text) TO authenticated;

