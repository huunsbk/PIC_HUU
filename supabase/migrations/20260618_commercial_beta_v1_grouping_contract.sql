-- Commercial Beta V1 grouping contract.
--
-- CTO rule:
-- - Frontend sends only the grouping request.
-- - PostgreSQL/RPC validates auth, tenant, permission, event scope, and writes data.
-- - No dependency on tournament.status or tournament.owner_account_id.

CREATE OR REPLACE FUNCTION public.setup_groups_v3(
  p_event_id text,
  p_num_groups integer,
  p_mode text DEFAULT 'empty'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_current_tenant_id uuid;
  v_event_tenant_id uuid;
  v_role_name text;
  v_event_tournament_id text;
  v_group_ids text[] := ARRAY[]::text[];
  v_group_id text;
  v_group_name text;
  v_index integer;
  v_letter_index integer;
  v_letter_name text;
  v_mode text;
  v_seed text;
  v_team record;
  v_team_index integer := 0;
  v_assigned_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'p_event_id is required';
  END IF;

  IF p_num_groups IS NULL OR p_num_groups < 1 OR p_num_groups > 32 THEN
    RAISE EXCEPTION 'p_num_groups must be between 1 and 32';
  END IF;

  v_mode := lower(btrim(coalesce(p_mode, 'empty')));
  IF v_mode NOT IN ('empty', 'seed', 'random') THEN
    RAISE EXCEPTION 'p_mode must be empty, seed, or random';
  END IF;

  v_current_tenant_id := public.current_tenant_id();
  v_role_name := public.current_role_name();

  IF v_current_tenant_id IS NULL AND v_role_name <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Tenant context is required';
  END IF;

  SELECT e.tenant_id, e.tournament_id
    INTO v_event_tenant_id, v_event_tournament_id
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for current tenant';
  END IF;

  IF v_role_name <> 'SUPER_ADMIN' AND v_event_tenant_id <> v_current_tenant_id THEN
    RAISE EXCEPTION 'Event not found for current tenant';
  END IF;

  IF NOT (
    v_role_name = 'SUPER_ADMIN'
    OR v_role_name = 'TENANT_ADMIN'
    OR (
      public.has_permission('manage_groups')
      AND public.has_event_access(p_event_id)
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied for setup_groups_v3';
  END IF;

  DELETE FROM public.matches
  WHERE event_id = p_event_id
    AND tenant_id = v_event_tenant_id
    AND COALESCE(group_id, '') <> 'knockout';

  UPDATE public.teams
  SET group_id = NULL
  WHERE event_id = p_event_id
    AND tenant_id = v_event_tenant_id
    AND deleted_at IS NULL;

  DELETE FROM public.groups
  WHERE event_id = p_event_id
    AND tenant_id = v_event_tenant_id;

  FOR v_index IN 0..(p_num_groups - 1) LOOP
    v_letter_index := v_index;
    v_letter_name := '';

    LOOP
      v_letter_name := chr(65 + (v_letter_index % 26)) || v_letter_name;
      v_letter_index := floor(v_letter_index / 26.0)::integer - 1;
      EXIT WHEN v_letter_index < 0;
    END LOOP;

    v_group_id := 'group-' || gen_random_uuid()::text;
    v_group_name := 'Bảng ' || v_letter_name;

    INSERT INTO public.groups (
      id,
      name,
      team_ids,
      event_id,
      tenant_id,
      tournament_id
    )
    VALUES (
      v_group_id,
      v_group_name,
      '[]'::jsonb,
      p_event_id,
      v_event_tenant_id,
      v_event_tournament_id
    );

    v_group_ids := array_append(v_group_ids, v_group_id);
  END LOOP;

  IF v_mode = 'random' THEN
    v_team_index := 0;

    FOR v_team IN
      SELECT id
      FROM public.teams
      WHERE event_id = p_event_id
        AND tenant_id = v_event_tenant_id
        AND deleted_at IS NULL
      ORDER BY random()
    LOOP
      UPDATE public.teams
      SET group_id = v_group_ids[(v_team_index % p_num_groups) + 1]
      WHERE id = v_team.id
        AND event_id = p_event_id
        AND tenant_id = v_event_tenant_id
        AND deleted_at IS NULL;

      v_team_index := v_team_index + 1;
      v_assigned_count := v_assigned_count + 1;
    END LOOP;
  ELSIF v_mode = 'seed' THEN
    FOREACH v_seed IN ARRAY ARRAY['1', '2', '3', '4', 'none'] LOOP
      v_team_index := 0;

      FOR v_team IN
        SELECT id
        FROM public.teams
        WHERE event_id = p_event_id
          AND tenant_id = v_event_tenant_id
          AND deleted_at IS NULL
          AND COALESCE(NULLIF(seed, ''), 'none') = v_seed
        ORDER BY lower(name), id
      LOOP
        UPDATE public.teams
        SET group_id = v_group_ids[(v_team_index % p_num_groups) + 1]
        WHERE id = v_team.id
          AND event_id = p_event_id
          AND tenant_id = v_event_tenant_id
          AND deleted_at IS NULL;

        v_team_index := v_team_index + 1;
        v_assigned_count := v_assigned_count + 1;
      END LOOP;
    END LOOP;
  END IF;

  UPDATE public.groups g
  SET team_ids = COALESCE((
    SELECT jsonb_agg(t.id ORDER BY lower(t.name), t.id)
    FROM public.teams t
    WHERE t.event_id = p_event_id
      AND t.tenant_id = v_event_tenant_id
      AND t.deleted_at IS NULL
      AND t.group_id = g.id
  ), '[]'::jsonb)
  WHERE g.event_id = p_event_id
    AND g.tenant_id = v_event_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'tenant_id', v_event_tenant_id,
    'num_groups', p_num_groups,
    'mode', v_mode,
    'group_ids', to_jsonb(v_group_ids),
    'assigned_teams', v_assigned_count
  );
END;
$function$;

COMMENT ON FUNCTION public.setup_groups_v3(text, integer, text) IS
  'Commercial Beta V1: database-owned group creation and assignment contract. Modes: empty, seed, random. Scoped by event and tenant with permission checks.';

CREATE OR REPLACE FUNCTION public.assign_team_to_group_v1(
  p_event_id text,
  p_team_id text,
  p_group_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_current_tenant_id uuid;
  v_event_tenant_id uuid;
  v_role_name text;
  v_source_group_id text;
  v_matches_deleted integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'p_event_id is required';
  END IF;

  IF p_team_id IS NULL OR btrim(p_team_id) = '' THEN
    RAISE EXCEPTION 'p_team_id is required';
  END IF;

  v_current_tenant_id := public.current_tenant_id();
  v_role_name := public.current_role_name();

  IF v_current_tenant_id IS NULL AND v_role_name <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Tenant context is required';
  END IF;

  SELECT e.tenant_id
    INTO v_event_tenant_id
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for current tenant';
  END IF;

  IF v_role_name <> 'SUPER_ADMIN' AND v_event_tenant_id <> v_current_tenant_id THEN
    RAISE EXCEPTION 'Event not found for current tenant';
  END IF;

  IF NOT (
    v_role_name = 'SUPER_ADMIN'
    OR v_role_name = 'TENANT_ADMIN'
    OR (
      public.has_permission('manage_groups')
      AND public.has_event_access(p_event_id)
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied for assign_team_to_group_v1';
  END IF;

  SELECT t.group_id
    INTO v_source_group_id
  FROM public.teams t
  WHERE t.id = p_team_id
    AND t.event_id = p_event_id
    AND t.tenant_id = v_event_tenant_id
    AND t.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found for current event';
  END IF;

  IF p_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.groups g
    WHERE g.id = p_group_id
      AND g.event_id = p_event_id
      AND g.tenant_id = v_event_tenant_id
  ) THEN
    RAISE EXCEPTION 'Group not found for current event';
  END IF;

  UPDATE public.teams
  SET group_id = p_group_id
  WHERE id = p_team_id
    AND event_id = p_event_id
    AND tenant_id = v_event_tenant_id
    AND deleted_at IS NULL;

  DELETE FROM public.matches
  WHERE event_id = p_event_id
    AND tenant_id = v_event_tenant_id
    AND COALESCE(group_id, '') <> 'knockout'
    AND (
      group_id = v_source_group_id
      OR group_id = p_group_id
    );
  GET DIAGNOSTICS v_matches_deleted = ROW_COUNT;

  UPDATE public.groups g
  SET team_ids = COALESCE((
    SELECT jsonb_agg(t.id ORDER BY lower(t.name), t.id)
    FROM public.teams t
    WHERE t.event_id = p_event_id
      AND t.tenant_id = v_event_tenant_id
      AND t.deleted_at IS NULL
      AND t.group_id = g.id
  ), '[]'::jsonb)
  WHERE g.event_id = p_event_id
    AND g.tenant_id = v_event_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'tenant_id', v_event_tenant_id,
    'team_id', p_team_id,
    'from_group_id', v_source_group_id,
    'to_group_id', p_group_id,
    'matches_deleted', v_matches_deleted
  );
END;
$function$;

COMMENT ON FUNCTION public.assign_team_to_group_v1(text, text, text) IS
  'Commercial Beta V1: database-owned team group assignment contract with event/tenant/permission checks.';

REVOKE ALL ON FUNCTION public.setup_groups_v3(text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_team_to_group_v1(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.setup_groups_v3(text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_team_to_group_v1(text, text, text) TO authenticated;
