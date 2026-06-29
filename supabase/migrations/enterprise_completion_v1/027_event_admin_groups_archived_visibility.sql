-- Compact EVENT_ADMIN permissions and hide archived data from operational/public flows.
-- EVENT_ADMIN can create events only in tournaments where they already have scoped event access.

INSERT INTO public.permissions (id, name, description)
SELECT gen_random_uuid(), 'create_events', 'Create competition events inside assigned tournaments'
WHERE NOT EXISTS (
  SELECT 1 FROM public.permissions WHERE name = 'create_events'
);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.name = 'create_events'
WHERE r.name = 'EVENT_ADMIN'
  AND NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
  );

CREATE OR REPLACE FUNCTION public.event_admin_default_permissions_v1()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'view_event',
    'create_events',
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
  JOIN public.tournament t ON t.id = e.tournament_id
  WHERE r.name = 'EVENT_ADMIN'
    AND a.status = 'active'
    AND a.deleted_at IS NULL
    AND aep.deleted_at IS NULL
    AND e.deleted_at IS NULL
    AND COALESCE(e.status, 'active') <> 'archived'
    AND t.deleted_at IS NULL
    AND COALESCE(t.status, 'active') <> 'archived'
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

CREATE OR REPLACE FUNCTION public.has_event_access(check_event_id text)
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
          AND EXISTS (
            SELECT 1
            FROM public.account_event_permissions aep
            WHERE aep.account_id = cc.account_id
              AND aep.event_id = te.id
              AND COALESCE(aep.tenant_id, te.tenant_id) = te.tenant_id
              AND aep.deleted_at IS NULL
          )
          THEN true
        ELSE false
      END
    FROM current_context cc
    CROSS JOIN target_event te
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
          AND EXISTS (
            SELECT 1
            FROM public.account_event_permissions aep
            WHERE aep.account_id = cc.account_id
              AND aep.event_id = te.id
              AND COALESCE(aep.tenant_id, te.tenant_id) = te.tenant_id
              AND aep.deleted_at IS NULL
              AND (
                COALESCE(aep.permission, 'enter_scores') = check_permission
                OR (check_permission = 'manage_events' AND COALESCE(aep.permission, 'enter_scores') = 'manage_event_config')
              )
          )
          THEN true
        ELSE false
      END
    FROM current_context cc
    CROSS JOIN target_event te
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.ensure_manage_event_for_tournament_v1(p_tournament_id text)
RETURNS public.tournament
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
    AND deleted_at IS NULL
    AND COALESCE(status, 'active') <> 'archived';

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'Tournament not found or archived';
  END IF;

  v_role := public.current_role_name();
  v_account_id := public.current_account_id();

  IF v_role = 'SUPER_ADMIN' THEN
    RETURN v_tournament;
  END IF;

  IF v_role = 'TENANT_ADMIN'
    AND v_tournament.tenant_id = public.current_tenant_id()
    AND public.has_permission('manage_events')
  THEN
    RETURN v_tournament;
  END IF;

  IF v_role = 'EVENT_ADMIN'
    AND v_tournament.tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.account_event_permissions aep
      JOIN public.events e ON e.id = aep.event_id
      WHERE aep.account_id = v_account_id
        AND aep.deleted_at IS NULL
        AND COALESCE(aep.permission, 'enter_scores') = 'create_events'
        AND e.tournament_id = p_tournament_id
        AND e.deleted_at IS NULL
        AND COALESCE(e.status, 'active') <> 'archived'
    )
  THEN
    RETURN v_tournament;
  END IF;

  RAISE EXCEPTION 'Permission denied: create_events required';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_event_v1(
  p_tournament_id text,
  p_name text,
  p_sport_id text,
  p_competition_type text,
  p_format_type text,
  p_scoring_config jsonb,
  p_ranking_config jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_tournament public.tournament%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_event_id text;
  v_role text;
  v_actor_id uuid;
BEGIN
  v_tournament := public.ensure_manage_event_for_tournament_v1(p_tournament_id);
  v_role := public.current_role_name();
  v_actor_id := public.current_account_id();

  IF NULLIF(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Event name is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.tournament_id = p_tournament_id
      AND e.deleted_at IS NULL
      AND COALESCE(e.status, 'active') <> 'archived'
      AND lower(e.name) = lower(trim(p_name))
  ) THEN
    RAISE EXCEPTION 'Event name already exists in this tournament';
  END IF;

  PERFORM public.validate_event_config_v1(
    p_sport_id,
    p_competition_type,
    p_format_type,
    COALESCE(p_scoring_config, '{}'::jsonb),
    COALESCE(p_ranking_config, '{}'::jsonb)
  );

  v_event_id := 'evt_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.events(
    id,
    name,
    settings,
    tenant_id,
    tournament_id,
    slug,
    status,
    sport_id,
    competition_type,
    format_type,
    scoring_config,
    ranking_config
  )
  VALUES (
    v_event_id,
    trim(p_name),
    '{}'::jsonb,
    v_tournament.tenant_id,
    p_tournament_id,
    v_event_id,
    'active',
    p_sport_id,
    p_competition_type,
    p_format_type,
    COALESCE(p_scoring_config, '{}'::jsonb),
    COALESCE(p_ranking_config, '{}'::jsonb)
  )
  RETURNING * INTO v_event;

  IF v_role = 'EVENT_ADMIN' THEN
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
      v_actor_id,
      v_event_id,
      v_tournament.tenant_id,
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
    'CREATE_EVENT',
    'event',
    v_event.id,
    jsonb_build_object(
      'event', to_jsonb(v_event),
      'tournament_id', p_tournament_id,
      'tenant_id', v_tournament.tenant_id
    )
  );

  RETURN jsonb_build_object('success', true, 'event', to_jsonb(v_event), 'event_id', v_event.id);
END;
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
    AND deleted_at IS NULL
    AND COALESCE(status, 'active') <> 'archived';

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'Tournament not found or archived';
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
        AND COALESCE(e.status, 'active') <> 'archived'
    );
  END IF;

  IF v_role IN ('EVENT_ADMIN', 'REFEREE') THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.name), '[]'::jsonb)
      FROM public.events e
      WHERE e.tournament_id = p_tournament_id
        AND e.deleted_at IS NULL
        AND COALESCE(e.status, 'active') <> 'archived'
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
    'create_events',
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
                  'create_events',
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
            AND COALESCE(e.status, 'active') <> 'archived'
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
      AND COALESCE(t.status, 'active') <> 'archived'
      AND ten.deleted_at IS NULL
      AND COALESCE(ten.status, 'active') <> 'archived'
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
              AND COALESCE(e.status, 'active') <> 'archived'
              AND public.has_event_access(e.id)
          )
        )
      )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.event_admin_default_permissions_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_event_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_event_permission(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_manage_event_for_tournament_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_v1(text, text, text, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_events_by_tournament_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_event_access_v1(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_permission_tree_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_tournament_snapshot_v1(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_tournament record;
  v_tenant record;
  v_event_ids text[] := ARRAY[]::text[];
BEGIN
  IF v_slug = '' THEN
    RAISE EXCEPTION 'PUBLIC_SLUG_REQUIRED';
  END IF;

  SELECT
    t.id,
    t.name,
    t.organization,
    t.location,
    t.date,
    t.settings,
    t.current_event_id,
    t.tenant_id,
    t.slug,
    t.status,
    t.start_date,
    t.created_at
  INTO v_tournament
  FROM public.tournament t
  JOIN public.tenants ten ON ten.id = t.tenant_id
  WHERE t.deleted_at IS NULL
    AND COALESCE(t.status, 'active') <> 'archived'
    AND ten.deleted_at IS NULL
    AND COALESCE(ten.status, 'active') <> 'archived'
    AND (
      lower(t.slug::text) = v_slug
      OR lower(t.id::text) = v_slug
    )
  ORDER BY t.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'PUBLIC_TOURNAMENT_NOT_FOUND';
  END IF;

  SELECT ten.id, ten.name, ten.slug, ten.status
  INTO v_tenant
  FROM public.tenants ten
  WHERE ten.id = v_tournament.tenant_id
    AND ten.deleted_at IS NULL
    AND COALESCE(ten.status, 'active') <> 'archived'
  LIMIT 1;

  IF v_tenant.id IS NULL THEN
    RAISE EXCEPTION 'PUBLIC_TENANT_NOT_FOUND';
  END IF;

  SELECT COALESCE(array_agg(e.id ORDER BY e.created_at ASC NULLS LAST, e.name ASC), ARRAY[]::text[])
  INTO v_event_ids
  FROM public.events e
  WHERE e.tenant_id = v_tenant.id
    AND e.tournament_id = v_tournament.id
    AND e.deleted_at IS NULL
    AND COALESCE(e.status, 'active') <> 'archived';

  RETURN jsonb_build_object(
    'success', true,
    'generated_at', now(),
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'name', v_tenant.name,
      'slug', v_tenant.slug,
      'status', v_tenant.status
    ),
    'tournament', jsonb_build_object(
      'id', v_tournament.id,
      'name', v_tournament.name,
      'organization', v_tournament.organization,
      'location', v_tournament.location,
      'date', v_tournament.date,
      'settings', COALESCE(v_tournament.settings, '{}'::jsonb),
      'current_event_id', CASE WHEN v_tournament.current_event_id = ANY(v_event_ids) THEN v_tournament.current_event_id ELSE v_event_ids[1] END,
      'tenant_id', v_tenant.id,
      'slug', v_tournament.slug,
      'status', v_tournament.status,
      'start_date', v_tournament.start_date
    ),
    'events', COALESCE((
      SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.created_at ASC NULLS LAST, ev.name ASC)
      FROM (
        SELECT
          e.id,
          e.name,
          e.settings,
          e.active_group_id,
          e.advance_selection_mode,
          e.manual_qualified_team_ids,
          e.created_at,
          e.tenant_id,
          e.tournament_id,
          e.slug,
          e.status,
          e.sport_id,
          e.competition_type,
          e.format_type,
          e.scoring_config,
          e.ranking_config,
          e.schedule_config
        FROM public.events e
        WHERE e.id = ANY(v_event_ids)
          AND e.deleted_at IS NULL
          AND COALESCE(e.status, 'active') <> 'archived'
      ) ev
    ), '[]'::jsonb),
    'teams', COALESCE((
      SELECT jsonb_agg(to_jsonb(tm) ORDER BY tm.event_id ASC, tm.name ASC)
      FROM (
        SELECT t.id, t.name, t.group_id, t.seed, t.event_id, t.created_at, t.tenant_id, t.tournament_id
        FROM public.teams t
        WHERE t.tenant_id = v_tenant.id
          AND t.tournament_id = v_tournament.id
          AND t.event_id = ANY(v_event_ids)
          AND t.deleted_at IS NULL
      ) tm
    ), '[]'::jsonb),
    'groups', COALESCE((
      SELECT jsonb_agg(to_jsonb(gr) ORDER BY gr.event_id ASC, gr.name ASC)
      FROM (
        SELECT g.id, g.name, g.team_ids, g.event_id, g.created_at, g.tenant_id, g.tournament_id
        FROM public.groups g
        WHERE g.tenant_id = v_tenant.id
          AND g.tournament_id = v_tournament.id
          AND g.event_id = ANY(v_event_ids)
          AND g.deleted_at IS NULL
      ) gr
    ), '[]'::jsonb),
    'matches', COALESCE((
      SELECT jsonb_agg(to_jsonb(mt) ORDER BY mt.event_id ASC, mt.display_order ASC NULLS LAST, mt.round ASC NULLS LAST, mt.slot_number ASC NULLS LAST, mt.court_number ASC NULLS LAST, mt.created_at ASC NULLS LAST)
      FROM (
        SELECT
          m.id, m.group_id, m.team_a_id, m.team_b_id, m.score_a, m.score_b, m.winner_id,
          m.status, m.round, m.knockout_round_name, m.knockout_match_id, m.next_match_id,
          m.next_match_slot, m.event_id, m.created_at, m.tenant_id, m.tournament_id,
          m.placeholder_a, m.placeholder_b, m.court_number, m.slot_number, m.display_order, m.metadata
        FROM public.matches m
        WHERE m.tenant_id = v_tenant.id
          AND m.tournament_id = v_tournament.id
          AND m.event_id = ANY(v_event_ids)
          AND m.deleted_at IS NULL
      ) mt
    ), '[]'::jsonb),
    'match_sets', COALESCE((
      SELECT jsonb_agg(to_jsonb(ms) ORDER BY ms.event_id ASC, ms.match_id ASC, ms.set_number ASC)
      FROM (
        SELECT s.id, s.match_id, s.tenant_id, s.event_id, s.set_number, s.score_a, s.score_b, s.winner_id, s.status, s.created_at, s.updated_at
        FROM public.match_sets s
        WHERE s.tenant_id = v_tenant.id
          AND s.event_id = ANY(v_event_ids)
          AND s.deleted_at IS NULL
      ) ms
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_tournament_snapshot_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_snapshot_v1(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_snapshot_v1(text) TO authenticated;
