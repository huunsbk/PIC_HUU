-- Enforce the event permission tree for all event-scoped business operations.
-- This keeps legacy RPCs that still pass manage_matches aligned with the new UI tree.

CREATE OR REPLACE FUNCTION public.p10_normalize_event_permission_v1(
  p_permission text,
  p_rpc_name text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_permission = 'manage_events' THEN 'manage_event_config'
    WHEN p_permission = 'manage_matches'
      AND COALESCE(p_rpc_name, '') IN ('generate_schedule_v1') THEN 'manage_schedule'
    WHEN p_permission = 'manage_matches'
      AND COALESCE(p_rpc_name, '') IN (
        'generate_knockout_bracket_v1',
        'save_manual_knockout_bracket_v1',
        'clear_knockout_bracket_v1',
        'prepare_knockout_candidates_v1',
        'confirm_knockout_teams_v1'
      ) THEN 'manage_knockout'
    ELSE p_permission
  END;
$$;

CREATE OR REPLACE FUNCTION public.p10_has_event_permission_v1(
  p_event_id text,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  WITH target_event AS (
    SELECT e.id, e.tenant_id
    FROM public.events e
    JOIN public.tournament t ON t.id = e.tournament_id
    WHERE e.id = p_event_id
      AND e.deleted_at IS NULL
      AND COALESCE(e.status, 'active') <> 'archived'
      AND t.deleted_at IS NULL
      AND COALESCE(t.status, 'active') <> 'archived'
    LIMIT 1
  )
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM target_event te
    JOIN public.account_event_permissions aep
      ON aep.event_id = te.id
    WHERE aep.account_id = public.current_account_id()
      AND COALESCE(aep.tenant_id, te.tenant_id) = te.tenant_id
      AND aep.deleted_at IS NULL
      AND (
        COALESCE(aep.permission, 'enter_scores') = p_permission
        OR (p_permission = 'manage_event_config' AND COALESCE(aep.permission, 'enter_scores') = 'manage_events')
      )
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.has_event_permission(
  check_event_id text,
  check_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  WITH current_context AS (
    SELECT
      a.id AS account_id,
      a.tenant_id,
      r.name AS role_name
    FROM public.accounts a
    JOIN public.roles r ON r.id = a.role_id
    WHERE a.user_id = auth.uid()
      AND a.deleted_at IS NULL
      AND a.status = 'active'
    LIMIT 1
  ),
  target_event AS (
    SELECT e.id, e.tenant_id
    FROM public.events e
    JOIN public.tournament t ON t.id = e.tournament_id
    WHERE e.id = check_event_id
      AND e.deleted_at IS NULL
      AND COALESCE(e.status, 'active') <> 'archived'
      AND t.deleted_at IS NULL
      AND COALESCE(t.status, 'active') <> 'archived'
    LIMIT 1
  )
  SELECT COALESCE((
    SELECT
      CASE
        WHEN cc.account_id IS NULL THEN false
        WHEN te.id IS NULL THEN false
        WHEN cc.role_name = 'SUPER_ADMIN' THEN true
        WHEN cc.role_name = 'TENANT_ADMIN' AND te.tenant_id = cc.tenant_id THEN true
        WHEN cc.role_name IN ('EVENT_ADMIN', 'REFEREE')
          AND te.tenant_id = cc.tenant_id
          AND public.p10_has_event_permission_v1(te.id, public.p10_normalize_event_permission_v1(check_permission, NULL))
          THEN true
        ELSE false
      END
    FROM current_context cc
    CROSS JOIN target_event te
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.p10_require_event_admin_v1(
  p_event_id text,
  p_permission text,
  p_rpc_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_role_name text;
  v_required_permission text;
BEGIN
  v_ctx := public.p10_validate_event_context_v1(p_event_id);
  v_role_name := v_ctx->>'role_name';
  v_required_permission := public.p10_normalize_event_permission_v1(p_permission, p_rpc_name);

  IF v_role_name IN ('REFEREE', 'VIEWER') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  IF NOT (
    v_role_name = 'SUPER_ADMIN'
    OR (v_role_name = 'TENANT_ADMIN' AND (v_ctx->>'tenant_id')::uuid = public.current_tenant_id())
    OR (
      v_role_name = 'EVENT_ADMIN'
      AND public.p10_has_event_permission_v1(p_event_id, v_required_permission)
    )
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  RETURN v_ctx || jsonb_build_object(
    'rpc_name', p_rpc_name,
    'required_permission', v_required_permission
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.p06_require_event_admin_v1(
  p_event_id text,
  p_permission text,
  p_rpc_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  RETURN public.p10_require_event_admin_v1(p_event_id, p_permission, p_rpc_name);
END;
$$;

REVOKE ALL ON FUNCTION public.p10_normalize_event_permission_v1(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.p10_has_event_permission_v1(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_event_permission(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.p10_require_event_admin_v1(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.p06_require_event_admin_v1(text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.p10_normalize_event_permission_v1(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p10_has_event_permission_v1(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_event_permission(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p10_require_event_admin_v1(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.p06_require_event_admin_v1(text, text, text) TO authenticated;
