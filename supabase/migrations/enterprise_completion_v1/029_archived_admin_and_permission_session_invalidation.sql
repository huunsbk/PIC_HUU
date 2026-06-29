-- Archived administration and permission-session invalidation.

CREATE OR REPLACE FUNCTION public.invalidate_account_sessions_v1(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  DELETE FROM public.active_sessions
  WHERE account_id = p_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_archived_tournaments_v1(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_role text := public.current_role_name();
  v_tenant_id uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_role = 'SUPER_ADMIN' THEN
    v_tenant_id := p_tenant_id;
  ELSIF v_role <> 'TENANT_ADMIN' AND NOT public.has_permission('manage_tournaments') THEN
    RAISE EXCEPTION 'Permission denied: manage_tournaments required';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'archived_at' DESC, row_data->>'created_at' DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id', t.id,
        'tournament_id', t.id,
        'name', t.name,
        'slug', t.slug,
        'tenant_id', t.tenant_id,
        'tenant_name', ten.name,
        'location', t.location,
        'start_date', COALESCE(t.start_date::text, t.date),
        'status', COALESCE(t.status, 'active'),
        'created_at', t.created_at,
        'updated_at', t.updated_at,
        'archived_at', t.updated_at,
        'events_count', (SELECT count(*) FROM public.events e WHERE e.tournament_id = t.id),
        'teams_count', (SELECT count(*) FROM public.teams tm WHERE tm.tournament_id = t.id),
        'matches_count', (SELECT count(*) FROM public.matches m WHERE m.tournament_id = t.id)
      ) AS row_data
      FROM public.tournament t
      JOIN public.tenants ten ON ten.id = t.tenant_id
      WHERE t.deleted_at IS NULL
        AND COALESCE(t.status, 'active') = 'archived'
        AND ten.deleted_at IS NULL
        AND (v_tenant_id IS NULL OR t.tenant_id = v_tenant_id)
    ) rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_archived_events_v1(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_role text := public.current_role_name();
  v_tenant_id uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_role = 'SUPER_ADMIN' THEN
    v_tenant_id := p_tenant_id;
  ELSIF v_role <> 'TENANT_ADMIN' AND NOT public.has_permission('manage_events') THEN
    RAISE EXCEPTION 'Permission denied: manage_events required';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'archived_at' DESC, row_data->>'created_at' DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id', e.id,
        'event_id', e.id,
        'name', e.name,
        'slug', e.slug,
        'status', COALESCE(e.status, 'active'),
        'tenant_id', e.tenant_id,
        'tenant_name', ten.name,
        'tournament_id', e.tournament_id,
        'tournament_name', t.name,
        'tournament_slug', t.slug,
        'sport_id', e.sport_id,
        'competition_type', e.competition_type,
        'format_type', e.format_type,
        'created_at', e.created_at,
        'archived_at', e.archived_at,
        'teams_count', (SELECT count(*) FROM public.teams tm WHERE tm.event_id = e.id),
        'groups_count', (SELECT count(*) FROM public.groups g WHERE g.event_id = e.id),
        'matches_count', (SELECT count(*) FROM public.matches m WHERE m.event_id = e.id)
      ) AS row_data
      FROM public.events e
      JOIN public.tournament t ON t.id = e.tournament_id
      JOIN public.tenants ten ON ten.id = e.tenant_id
      WHERE e.deleted_at IS NULL
        AND COALESCE(e.status, 'active') = 'archived'
        AND t.deleted_at IS NULL
        AND ten.deleted_at IS NULL
        AND (v_tenant_id IS NULL OR e.tenant_id = v_tenant_id)
    ) rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hard_delete_event_v1(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_role text := public.current_role_name();
  v_deleted jsonb;
  v_match_sets integer := 0;
  v_knockout_slots integer := 0;
  v_knockout_selections integer := 0;
  v_matches integer := 0;
  v_groups integer := 0;
  v_teams integer := 0;
  v_permissions integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF COALESCE(v_event.status, 'active') <> 'archived' THEN
    RAISE EXCEPTION 'Only archived events can be hard deleted';
  END IF;

  IF NOT (
    v_role = 'SUPER_ADMIN'
    OR (v_role = 'TENANT_ADMIN' AND v_event.tenant_id = public.current_tenant_id() AND public.has_permission('manage_events'))
  ) THEN
    RAISE EXCEPTION 'Permission denied: manage_events required';
  END IF;

  DELETE FROM public.match_sets WHERE event_id = p_event_id;
  GET DIAGNOSTICS v_match_sets = ROW_COUNT;

  IF to_regclass('public.knockout_slots') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.knockout_slots WHERE event_id = $1' USING p_event_id;
    GET DIAGNOSTICS v_knockout_slots = ROW_COUNT;
  END IF;

  IF to_regclass('public.event_knockout_selections') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.event_knockout_selections WHERE event_id = $1' USING p_event_id;
    GET DIAGNOSTICS v_knockout_selections = ROW_COUNT;
  END IF;

  DELETE FROM public.matches WHERE event_id = p_event_id;
  GET DIAGNOSTICS v_matches = ROW_COUNT;

  DELETE FROM public.groups WHERE event_id = p_event_id;
  GET DIAGNOSTICS v_groups = ROW_COUNT;

  DELETE FROM public.teams WHERE event_id = p_event_id;
  GET DIAGNOSTICS v_teams = ROW_COUNT;

  DELETE FROM public.account_event_permissions WHERE event_id = p_event_id;
  GET DIAGNOSTICS v_permissions = ROW_COUNT;

  DELETE FROM public.events WHERE id = p_event_id;

  v_deleted := jsonb_build_object(
    'match_sets', v_match_sets,
    'knockout_slots', v_knockout_slots,
    'knockout_selections', v_knockout_selections,
    'matches', v_matches,
    'groups', v_groups,
    'teams', v_teams,
    'account_event_permissions', v_permissions
  );

  PERFORM public.log_audit_event_v1(
    'HARD_DELETE_EVENT',
    'event',
    p_event_id,
    jsonb_build_object('event', to_jsonb(v_event), 'deleted', v_deleted)
  );

  RETURN jsonb_build_object('success', true, 'event_id', p_event_id, 'deleted', v_deleted);
END;
$$;

CREATE OR REPLACE FUNCTION public.hard_delete_tournament_v1(p_tournament_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_tournament public.tournament%ROWTYPE;
  v_event_ids text[];
  v_deleted jsonb;
  v_match_sets integer := 0;
  v_knockout_slots integer := 0;
  v_knockout_selections integer := 0;
  v_matches integer := 0;
  v_groups integer := 0;
  v_teams integer := 0;
  v_permissions integer := 0;
  v_events integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_tournament
  FROM public.tournament
  WHERE id = p_tournament_id
    AND deleted_at IS NULL;

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'Tournament not found';
  END IF;

  IF COALESCE(v_tournament.status, 'active') <> 'archived' THEN
    RAISE EXCEPTION 'Only archived tournaments can be hard deleted';
  END IF;

  PERFORM public.ensure_manage_tournaments_v1(v_tournament.tenant_id);

  SELECT COALESCE(array_agg(id), ARRAY[]::text[])
  INTO v_event_ids
  FROM public.events
  WHERE tournament_id = p_tournament_id;

  DELETE FROM public.match_sets WHERE event_id = ANY(v_event_ids);
  GET DIAGNOSTICS v_match_sets = ROW_COUNT;

  IF to_regclass('public.knockout_slots') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.knockout_slots WHERE tournament_id = $1' USING p_tournament_id;
    GET DIAGNOSTICS v_knockout_slots = ROW_COUNT;
  END IF;

  IF to_regclass('public.event_knockout_selections') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.event_knockout_selections WHERE event_id = ANY($1)' USING v_event_ids;
    GET DIAGNOSTICS v_knockout_selections = ROW_COUNT;
  END IF;

  DELETE FROM public.matches WHERE tournament_id = p_tournament_id;
  GET DIAGNOSTICS v_matches = ROW_COUNT;

  DELETE FROM public.groups WHERE tournament_id = p_tournament_id;
  GET DIAGNOSTICS v_groups = ROW_COUNT;

  DELETE FROM public.teams WHERE tournament_id = p_tournament_id;
  GET DIAGNOSTICS v_teams = ROW_COUNT;

  DELETE FROM public.account_event_permissions WHERE event_id = ANY(v_event_ids);
  GET DIAGNOSTICS v_permissions = ROW_COUNT;

  UPDATE public.tournament
  SET current_event_id = NULL
  WHERE id = p_tournament_id;

  DELETE FROM public.events WHERE tournament_id = p_tournament_id;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  DELETE FROM public.tournament WHERE id = p_tournament_id;

  v_deleted := jsonb_build_object(
    'match_sets', v_match_sets,
    'knockout_slots', v_knockout_slots,
    'knockout_selections', v_knockout_selections,
    'matches', v_matches,
    'groups', v_groups,
    'teams', v_teams,
    'account_event_permissions', v_permissions,
    'events', v_events
  );

  PERFORM public.log_audit_event_v1(
    'HARD_DELETE_TOURNAMENT',
    'tournament',
    p_tournament_id,
    jsonb_build_object('tournament', to_jsonb(v_tournament), 'deleted', v_deleted)
  );

  RETURN jsonb_build_object('success', true, 'tournament_id', p_tournament_id, 'deleted', v_deleted);
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

  PERFORM public.invalidate_account_sessions_v1(v_account_id);

  PERFORM public.log_audit_event_v1(
    'GRANT_EVENT_ACCESS',
    'event',
    p_event_id,
    jsonb_build_object(
      'target_account_id', v_account_id,
      'permission', v_permission,
      'role_name', v_account.role_name,
      'sessions_invalidated', true
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'account_id', v_account_id,
    'permission', v_permission,
    'grant_id', v_grant.id,
    'sessions_invalidated', true
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

  IF v_rows > 0 THEN
    PERFORM public.invalidate_account_sessions_v1(v_account_id);
  END IF;

  PERFORM public.log_audit_event_v1(
    'REVOKE_EVENT_ACCESS',
    'event',
    p_event_id,
    jsonb_build_object(
      'target_account_id', v_account_id,
      'permission', v_permission,
      'revoked_rows', v_rows,
      'sessions_invalidated', v_rows > 0
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'account_id', v_account_id,
    'permission', v_permission,
    'revoked_rows', v_rows,
    'sessions_invalidated', v_rows > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invalidate_account_sessions_v1(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_archived_tournaments_v1(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_archived_events_v1(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hard_delete_event_v1(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hard_delete_tournament_v1(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.invalidate_account_sessions_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_archived_tournaments_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_archived_events_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_event_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_tournament_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_event_access_v1(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_event_access_v1(text, text, text) TO authenticated;
