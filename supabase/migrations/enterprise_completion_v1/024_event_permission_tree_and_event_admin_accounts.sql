-- Event permission tree and scoped EVENT_ADMIN account management.
-- No data reset. No auth.users changes.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS created_by_account_id uuid REFERENCES public.accounts(id);

ALTER TABLE public.account_event_permissions
  ADD COLUMN IF NOT EXISTS created_by_account_id uuid REFERENCES public.accounts(id);

INSERT INTO public.permissions (id, name, description)
SELECT gen_random_uuid(), permission_name, description
FROM (
  VALUES
    ('view_event', 'View assigned event'),
    ('manage_event_config', 'Configure assigned event'),
    ('manage_schedule', 'Manage assigned event schedule'),
    ('manage_standings', 'Manage assigned event standings'),
    ('manage_knockout', 'Manage assigned event knockout bracket'),
    ('manage_referees', 'Manage referees in assigned event')
) AS p(permission_name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM public.permissions existing WHERE existing.name = p.permission_name
);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.name IN (
  'view_event',
  'manage_event_config',
  'manage_schedule',
  'manage_standings',
  'manage_knockout',
  'manage_referees'
)
WHERE r.name = 'EVENT_ADMIN'
  AND NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
  );

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
    WHERE e.id = check_event_id
      AND e.deleted_at IS NULL
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
          AND EXISTS (
            SELECT 1
            FROM public.account_event_permissions aep
            WHERE aep.account_id = cc.account_id
              AND aep.event_id = te.id
              AND COALESCE(aep.tenant_id, te.tenant_id) = te.tenant_id
              AND aep.deleted_at IS NULL
              AND (
                COALESCE(aep.permission, 'enter_scores') = check_permission
                OR COALESCE(aep.permission, 'enter_scores') = 'manage_events'
              )
          )
          THEN true
        ELSE false
      END
    FROM current_context cc
    CROSS JOIN target_event te
  ), false);
$$;

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

  IF v_role = 'EVENT_ADMIN'
    AND (
      public.has_event_permission(p_event_id, 'manage_events')
      OR public.has_event_permission(p_event_id, 'manage_referees')
    )
  THEN
    RETURN v_event;
  END IF;

  RAISE EXCEPTION 'Permission denied: manage event access required';
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
  v_actor_id uuid;
  v_actor_role text;
  v_account_id uuid;
  v_permission text;
  v_rows integer := 0;
BEGIN
  v_event := public.ensure_manage_event_access_v1(p_event_id);
  v_actor_id := public.current_account_id();
  v_actor_role := public.current_role_name();
  v_account_id := p_account_id::uuid;
  v_permission := COALESCE(NULLIF(btrim(p_permission), ''), 'enter_scores');

  IF v_actor_role = 'EVENT_ADMIN'
    AND NOT public.has_event_permission(p_event_id, 'manage_referees')
  THEN
    RAISE EXCEPTION 'Permission denied: manage_referees required';
  END IF;

  UPDATE public.account_event_permissions aep
  SET deleted_at = now()
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  WHERE aep.account_id = a.id
    AND aep.account_id = v_account_id
    AND aep.event_id = p_event_id
    AND aep.tenant_id = v_event.tenant_id
    AND COALESCE(aep.permission, 'enter_scores') = v_permission
    AND aep.deleted_at IS NULL
    AND a.tenant_id = v_event.tenant_id
    AND (
      v_actor_role <> 'EVENT_ADMIN'
      OR (
        r.name = 'REFEREE'
        AND (
          aep.created_by_account_id = v_actor_id
          OR public.has_event_permission(p_event_id, 'manage_referees')
        )
      )
    );
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

CREATE OR REPLACE FUNCTION public.list_account_access_summary_v1(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_role_name text;
  v_tenant_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_actor_id := public.current_account_id();
  v_role_name := public.current_role_name();
  v_tenant_id := public.current_tenant_id();

  IF v_role_name = 'SUPER_ADMIN' THEN
    v_tenant_id := p_tenant_id;
  ELSIF v_role_name = 'TENANT_ADMIN' OR public.has_permission('manage_accounts') THEN
    v_tenant_id := public.current_tenant_id();
  ELSIF v_role_name <> 'EVENT_ADMIN' OR NOT public.has_permission('manage_referees') THEN
    RAISE EXCEPTION 'Permission denied: account scope required';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'account_id', a.id,
        'id', a.id,
        'user_id', a.user_id,
        'username', a.username,
        'display_name', a.display_name,
        'tenant_id', a.tenant_id,
        'tenant_name', ten.name,
        'role_name', r.name,
        'status', a.status,
        'created_at', a.created_at,
        'created_by_account_id', a.created_by_account_id,
        'event_grants', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', aep.id,
              'event_id', e.id,
              'event_name', e.name,
              'tournament_id', t.id,
              'tournament_name', t.name,
              'tournament_slug', t.slug,
              'permission', COALESCE(aep.permission, 'enter_scores'),
              'created_by_account_id', aep.created_by_account_id
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
      AND (
        (v_role_name = 'SUPER_ADMIN' AND (v_tenant_id IS NULL OR a.tenant_id = v_tenant_id))
        OR (v_role_name = 'TENANT_ADMIN' AND a.tenant_id = v_tenant_id)
        OR (
          v_role_name = 'EVENT_ADMIN'
          AND a.tenant_id = public.current_tenant_id()
          AND (
            a.id = v_actor_id
            OR (
              r.name = 'REFEREE'
              AND (
                a.created_by_account_id = v_actor_id
                OR EXISTS (
                  SELECT 1
                  FROM public.account_event_permissions target_perm
                  WHERE target_perm.account_id = a.id
                    AND target_perm.deleted_at IS NULL
                    AND public.has_event_permission(target_perm.event_id, 'manage_referees')
                )
              )
            )
          )
        )
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_permission_tree_v1(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_role text;
  v_tenant_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_role := public.current_role_name();
  v_tenant_id := public.current_tenant_id();

  IF v_role = 'SUPER_ADMIN' THEN
    v_tenant_id := p_tenant_id;
  ELSIF v_role NOT IN ('TENANT_ADMIN', 'EVENT_ADMIN') THEN
    RAISE EXCEPTION 'Permission denied: permission tree unavailable';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'tournament_id', t.id,
        'tournament_name', t.name,
        'tournament_slug', t.slug,
        'tenant_id', t.tenant_id,
        'tenant_name', ten.name,
        'events', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'event_id', e.id,
              'event_name', e.name,
              'allowed_permissions', CASE
                WHEN v_role IN ('SUPER_ADMIN', 'TENANT_ADMIN') THEN to_jsonb(ARRAY[
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
                ])
                ELSE (
                  SELECT COALESCE(jsonb_agg(DISTINCT COALESCE(aep.permission, 'enter_scores')), '[]'::jsonb)
                  FROM public.account_event_permissions aep
                  WHERE aep.account_id = public.current_account_id()
                    AND aep.event_id = e.id
                    AND aep.deleted_at IS NULL
                )
              END
            )
            ORDER BY e.name
          )
          FROM public.events e
          WHERE e.tournament_id = t.id
            AND e.deleted_at IS NULL
            AND (
              v_role IN ('SUPER_ADMIN', 'TENANT_ADMIN')
              OR public.has_event_access(e.id)
            )
        ), '[]'::jsonb)
      )
      ORDER BY ten.name, t.created_at DESC
    ), '[]'::jsonb)
    FROM public.tournament t
    JOIN public.tenants ten ON ten.id = t.tenant_id
    WHERE t.deleted_at IS NULL
      AND ten.deleted_at IS NULL
      AND (
        (v_role = 'SUPER_ADMIN' AND (v_tenant_id IS NULL OR t.tenant_id = v_tenant_id))
        OR (v_role = 'TENANT_ADMIN' AND t.tenant_id = v_tenant_id)
        OR (
          v_role = 'EVENT_ADMIN'
          AND EXISTS (
            SELECT 1
            FROM public.events e
            WHERE e.tournament_id = t.id
              AND e.deleted_at IS NULL
              AND public.has_event_access(e.id)
          )
        )
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.has_event_permission(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_permission_tree_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_event_permission(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.list_permission_tree_v1(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.has_event_permission(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_permission_tree_v1(uuid) TO authenticated;
