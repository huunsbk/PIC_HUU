-- Prompt 07-H: event scoped access for referees and event admins.

ALTER TABLE public.account_event_permissions
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

ALTER TABLE public.account_event_permissions
  ADD COLUMN IF NOT EXISTS permission text DEFAULT 'enter_scores';

UPDATE public.account_event_permissions aep
SET tenant_id = e.tenant_id
FROM public.events e
WHERE aep.event_id = e.id
  AND aep.tenant_id IS NULL;

UPDATE public.account_event_permissions
SET permission = 'enter_scores'
WHERE permission IS NULL OR btrim(permission) = '';

UPDATE public.account_event_permissions aep
SET deleted_at = now()
FROM public.accounts a
JOIN public.roles r ON r.id = a.role_id
WHERE aep.account_id = a.id
  AND aep.deleted_at IS NULL
  AND r.name NOT IN ('REFEREE', 'EVENT_ADMIN');

CREATE INDEX IF NOT EXISTS idx_account_event_permissions_event_active
  ON public.account_event_permissions(event_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_account_event_permissions_account_active
  ON public.account_event_permissions(account_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS account_event_permissions_active_permission_uidx
  ON public.account_event_permissions(account_id, event_id, permission)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.ensure_manage_event_access_v1(p_event_id text)
RETURNS public.events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  v_role := public.current_role_name();

  IF v_role = 'SUPER_ADMIN' OR public.has_permission('*') THEN
    RETURN v_event;
  END IF;

  IF v_role = 'TENANT_ADMIN'
    AND v_event.tenant_id = public.current_tenant_id()
    AND public.has_permission('manage_events')
  THEN
    RETURN v_event;
  END IF;

  IF public.has_permission('manage_events')
    AND public.has_event_access(p_event_id)
  THEN
    RETURN v_event;
  END IF;

  RAISE EXCEPTION 'Permission denied: manage_events required';
END;
$$;

CREATE OR REPLACE FUNCTION public.list_event_access_v1(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
BEGIN
  v_event := public.ensure_manage_event_access_v1(p_event_id);

  RETURN jsonb_build_object(
    'success', true,
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'tenant_id', v_event.tenant_id,
      'tournament_id', v_event.tournament_id
    ),
    'grants', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', aep.id,
          'event_id', aep.event_id,
          'account_id', a.id,
          'username', a.username,
          'display_name', a.display_name,
          'role_name', r.name,
          'permission', COALESCE(aep.permission, 'enter_scores'),
          'created_at', aep.created_at
        )
        ORDER BY r.name, a.display_name, a.username
      )
      FROM public.account_event_permissions aep
      JOIN public.accounts a ON a.id = aep.account_id
      JOIN public.roles r ON r.id = a.role_id
      WHERE aep.event_id = p_event_id
        AND aep.deleted_at IS NULL
        AND a.deleted_at IS NULL
        AND a.status = 'active'
    ), '[]'::jsonb),
    'eligible_accounts', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'account_id', a.id,
          'username', a.username,
          'display_name', a.display_name,
          'role_name', r.name
        )
        ORDER BY r.name, a.display_name, a.username
      )
      FROM public.accounts a
      JOIN public.roles r ON r.id = a.role_id
      WHERE a.tenant_id = v_event.tenant_id
        AND a.deleted_at IS NULL
        AND a.status = 'active'
        AND r.name IN ('REFEREE', 'EVENT_ADMIN')
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_event_access_v1(
  p_event_id text,
  p_account_id text,
  p_permission text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_account_id uuid;
  v_account record;
  v_permission text;
  v_grant public.account_event_permissions%ROWTYPE;
BEGIN
  v_event := public.ensure_manage_event_access_v1(p_event_id);
  v_account_id := p_account_id::uuid;
  v_permission := COALESCE(NULLIF(btrim(p_permission), ''), 'enter_scores');

  IF v_permission NOT IN ('enter_scores', 'manage_events') THEN
    RAISE EXCEPTION 'Invalid event permission: %', p_permission;
  END IF;

  SELECT a.id, a.tenant_id, a.username, a.display_name, r.name AS role_name
  INTO v_account
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  WHERE a.id = v_account_id
    AND a.deleted_at IS NULL
    AND a.status = 'active';

  IF v_account.id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF v_account.tenant_id <> v_event.tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant event access grant is not allowed';
  END IF;

  IF v_account.role_name NOT IN ('REFEREE', 'EVENT_ADMIN') THEN
    RAISE EXCEPTION 'Account role must be REFEREE or EVENT_ADMIN';
  END IF;

  IF v_account.role_name = 'REFEREE' AND v_permission <> 'enter_scores' THEN
    RAISE EXCEPTION 'REFEREE can only receive enter_scores';
  END IF;

  INSERT INTO public.account_event_permissions (
    account_id,
    event_id,
    tenant_id,
    permission,
    created_at,
    deleted_at
  )
  VALUES (
    v_account_id,
    p_event_id,
    v_event.tenant_id,
    v_permission,
    now(),
    NULL
  )
  ON CONFLICT (account_id, event_id, permission) WHERE deleted_at IS NULL
  DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    deleted_at = NULL
  RETURNING * INTO v_grant;

  PERFORM public.log_audit_event_v1(
    'GRANT_EVENT_ACCESS',
    'event',
    p_event_id,
    jsonb_build_object(
      'target_account_id', v_account_id,
      'permission', v_permission,
      'role_name', v_account.role_name
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'account_id', v_account_id,
    'permission', v_permission,
    'grant_id', v_grant.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_event_access_v1(
  p_event_id text,
  p_account_id text,
  p_permission text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_account_id uuid;
  v_permission text;
  v_rows integer := 0;
BEGIN
  v_event := public.ensure_manage_event_access_v1(p_event_id);
  v_account_id := p_account_id::uuid;
  v_permission := COALESCE(NULLIF(btrim(p_permission), ''), 'enter_scores');

  UPDATE public.account_event_permissions aep
  SET deleted_at = now()
  FROM public.accounts a
  WHERE aep.account_id = a.id
    AND aep.account_id = v_account_id
    AND aep.event_id = p_event_id
    AND aep.tenant_id = v_event.tenant_id
    AND COALESCE(aep.permission, 'enter_scores') = v_permission
    AND aep.deleted_at IS NULL
    AND a.tenant_id = v_event.tenant_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  PERFORM public.log_audit_event_v1(
    'REVOKE_EVENT_ACCESS',
    'event',
    p_event_id,
    jsonb_build_object(
      'target_account_id', v_account_id,
      'permission', v_permission,
      'revoked_rows', v_rows
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'account_id', v_account_id,
    'permission', v_permission,
    'revoked_rows', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_manage_event_access_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_event_access_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_event_access_v1(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_event_access_v1(text, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.ensure_manage_event_access_v1(text) FROM anon;
REVOKE ALL ON FUNCTION public.list_event_access_v1(text) FROM anon;
REVOKE ALL ON FUNCTION public.grant_event_access_v1(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_event_access_v1(text, text, text) FROM anon;

GRANT EXECUTE ON FUNCTION public.list_event_access_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_event_access_v1(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_event_access_v1(text, text, text) TO authenticated;
