-- Materialize EVENT_ADMIN default event permissions so account scope UI and RPC checks
-- read one consistent source: public.account_event_permissions.
-- No auth.users changes. No data reset.

CREATE OR REPLACE FUNCTION public.event_admin_default_permissions_v1()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'view_event',
    'manage_event_config',
    'manage_teams',
    'manage_groups',
    'manage_schedule',
    'enter_scores',
    'manage_standings',
    'manage_knockout',
    'manage_referees'
  ]::text[];
$$;

ALTER TABLE public.account_event_permissions
  DROP CONSTRAINT IF EXISTS account_event_permissions_account_id_event_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS account_event_permissions_active_permission_uidx
  ON public.account_event_permissions (account_id, event_id, permission)
  WHERE deleted_at IS NULL;

WITH event_admin_event_scope AS (
  SELECT
    aep.account_id,
    aep.event_id,
    COALESCE(aep.tenant_id, e.tenant_id) AS tenant_id,
    (array_agg(aep.created_by_account_id ORDER BY aep.created_at))[1] AS created_by_account_id
  FROM public.account_event_permissions aep
  JOIN public.accounts a ON a.id = aep.account_id
  JOIN public.roles r ON r.id = a.role_id
  JOIN public.events e ON e.id = aep.event_id
  WHERE r.name = 'EVENT_ADMIN'
    AND a.status = 'active'
    AND a.deleted_at IS NULL
    AND aep.deleted_at IS NULL
    AND e.deleted_at IS NULL
  GROUP BY aep.account_id, aep.event_id, COALESCE(aep.tenant_id, e.tenant_id)
)
INSERT INTO public.account_event_permissions (
  account_id,
  event_id,
  tenant_id,
  permission,
  created_by_account_id,
  created_at,
  deleted_at
)
SELECT
  scope.account_id,
  scope.event_id,
  scope.tenant_id,
  permission_name,
  scope.created_by_account_id,
  now(),
  NULL
FROM event_admin_event_scope scope
CROSS JOIN unnest(public.event_admin_default_permissions_v1()) AS permission_name
ON CONFLICT (account_id, event_id, permission) WHERE deleted_at IS NULL
DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  deleted_at = NULL;

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
  v_actor_id uuid;
  v_actor_role text;
  v_account_id uuid;
  v_account record;
  v_permission text;
  v_allowed_permissions text[] := ARRAY[
    'view_event',
    'manage_event_config',
    'manage_teams',
    'manage_groups',
    'manage_schedule',
    'enter_scores',
    'manage_standings',
    'manage_knockout',
    'manage_referees',
    'manage_events'
  ];
  v_referee_permissions text[] := ARRAY['view_event', 'enter_scores'];
  v_grant public.account_event_permissions%ROWTYPE;
  v_existing_event_scope_count integer := 0;
BEGIN
  v_event := public.ensure_manage_event_access_v1(p_event_id);
  v_actor_id := public.current_account_id();
  v_actor_role := public.current_role_name();
  v_account_id := p_account_id::uuid;
  v_permission := COALESCE(NULLIF(btrim(p_permission), ''), 'enter_scores');

  IF NOT v_permission = ANY(v_allowed_permissions) THEN
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

  IF v_account.role_name = 'REFEREE' AND NOT v_permission = ANY(v_referee_permissions) THEN
    RAISE EXCEPTION 'REFEREE can only receive view_event or enter_scores';
  END IF;

  IF v_actor_role = 'EVENT_ADMIN' THEN
    IF v_account.role_name <> 'REFEREE' THEN
      RAISE EXCEPTION 'EVENT_ADMIN can only grant permissions to REFEREE accounts';
    END IF;

    IF NOT public.has_event_permission(p_event_id, 'manage_referees') THEN
      RAISE EXCEPTION 'Permission denied: manage_referees required';
    END IF;

    IF v_permission <> 'view_event'
      AND NOT public.has_event_permission(p_event_id, v_permission)
    THEN
      RAISE EXCEPTION 'Cannot grant permission outside actor scope: %', v_permission;
    END IF;
  END IF;

  SELECT count(*)::integer
  INTO v_existing_event_scope_count
  FROM public.account_event_permissions aep
  WHERE aep.account_id = v_account_id
    AND aep.event_id = p_event_id
    AND aep.tenant_id = v_event.tenant_id
    AND aep.deleted_at IS NULL;

  INSERT INTO public.account_event_permissions (
    account_id,
    event_id,
    tenant_id,
    permission,
    created_by_account_id,
    created_at,
    deleted_at
  )
  VALUES (
    v_account_id,
    p_event_id,
    v_event.tenant_id,
    v_permission,
    v_actor_id,
    now(),
    NULL
  )
  ON CONFLICT (account_id, event_id, permission) WHERE deleted_at IS NULL
  DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    created_by_account_id = COALESCE(public.account_event_permissions.created_by_account_id, EXCLUDED.created_by_account_id),
    deleted_at = NULL
  RETURNING * INTO v_grant;

  IF v_account.role_name = 'EVENT_ADMIN' AND v_existing_event_scope_count = 0 THEN
    INSERT INTO public.account_event_permissions (
      account_id,
      event_id,
      tenant_id,
      permission,
      created_by_account_id,
      created_at,
      deleted_at
    )
    SELECT
      v_account_id,
      p_event_id,
      v_event.tenant_id,
      permission_name,
      v_actor_id,
      now(),
      NULL
    FROM unnest(public.event_admin_default_permissions_v1()) AS permission_name
    ON CONFLICT (account_id, event_id, permission) WHERE deleted_at IS NULL
    DO UPDATE SET
      tenant_id = EXCLUDED.tenant_id,
      created_by_account_id = COALESCE(public.account_event_permissions.created_by_account_id, EXCLUDED.created_by_account_id),
      deleted_at = NULL;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.event_admin_default_permissions_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_event_access_v1(text, text, text) TO authenticated;
