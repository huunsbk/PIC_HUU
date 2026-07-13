-- Phase 5E: persist backend workspace denials without flooding audit storage.

CREATE OR REPLACE FUNCTION public.record_security_audit_v1(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_result text,
  p_reason text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid := public.current_account_id();
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_role text := public.current_role_name();
  v_payload jsonb := public.sanitize_audit_payload_v1(COALESCE(p_payload, '{}'::jsonb));
  v_audit_id bigint;
BEGIN
  IF auth.uid() IS NULL OR v_account_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'skipped', true, 'reason', 'UNAUTHENTICATED');
  END IF;

  IF p_action <> 'WORKSPACE_ACCESS_DENIED'
     OR p_result <> 'deny'
     OR NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'INVALID_SECURITY_AUDIT_EVENT';
  END IF;

  SELECT id
  INTO v_audit_id
  FROM public.audit_logs
  WHERE actor_account_id = v_account_id
    AND action = p_action
    AND entity_type IS NOT DISTINCT FROM NULLIF(btrim(p_entity_type), '')
    AND entity_id IS NOT DISTINCT FROM NULLIF(btrim(p_entity_id), '')
    AND result = p_result
    AND reason = p_reason
    AND created_at >= now() - interval '5 minutes'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_audit_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'deduplicated', true, 'audit_id', v_audit_id);
  END IF;

  INSERT INTO public.audit_logs (
    timestamp,
    action,
    details,
    created_at,
    tenant_id,
    actor_account_id,
    actor_role,
    category,
    entity_type,
    entity_id,
    result,
    reason,
    details_json
  ) VALUES (
    to_char(now(), 'HH24:MI:SS DD/MM/YYYY'),
    p_action,
    jsonb_build_object(
      'account_id', v_account_id,
      'actor_role', v_actor_role,
      'entity_type', p_entity_type,
      'entity_id', p_entity_id,
      'result', p_result,
      'reason', p_reason,
      'payload', v_payload
    )::text,
    now(),
    v_tenant_id,
    v_account_id,
    v_actor_role,
    'security',
    NULLIF(btrim(p_entity_type), ''),
    NULLIF(btrim(p_entity_id), ''),
    p_result,
    p_reason,
    v_payload
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object('success', true, 'deduplicated', false, 'audit_id', v_audit_id);
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
    PERFORM public.record_security_audit_v1(
      'WORKSPACE_ACCESS_DENIED',
      'workspace',
      NULL,
      'deny',
      'invalid_workspace_slug',
      '{}'::jsonb
    );
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
    PERFORM public.record_security_audit_v1(
      'WORKSPACE_ACCESS_DENIED',
      'workspace',
      p_slug,
      'deny',
      'workspace_not_available',
      '{}'::jsonb
    );
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
    PERFORM public.record_security_audit_v1(
      'WORKSPACE_ACCESS_DENIED',
      'workspace',
      p_slug,
      'deny',
      'permission_denied',
      jsonb_build_object('requested_tournament_id', v_workspace.tournament_id)
    );
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

REVOKE ALL ON FUNCTION public.record_security_audit_v1(text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_access_workspace_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_workspace_v1(text) TO authenticated;

