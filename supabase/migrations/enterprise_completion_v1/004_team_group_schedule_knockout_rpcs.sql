BEGIN;

-- Prompt 06: Team, group, schedule, knockout selection, and knockout bracket RPCs.
-- Client writes must go through SECURITY DEFINER RPCs that derive tenant/account
-- context from auth.uid() and the existing Prompt 05 helper functions.

CREATE TABLE IF NOT EXISTS public.event_knockout_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  event_id text NOT NULL REFERENCES public.events(id),
  team_id text NOT NULL REFERENCES public.teams(id),
  seed integer NOT NULL,
  bracket_size integer NOT NULL DEFAULT 8,
  source text,
  source_group_id text,
  group_rank integer,
  is_override boolean DEFAULT false,
  override_reason text,
  confirmed_by uuid,
  confirmed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT event_knockout_selections_seed_positive CHECK (seed > 0),
  CONSTRAINT event_knockout_selections_bracket_size CHECK (bracket_size IN (4, 8, 16, 32))
);

CREATE UNIQUE INDEX IF NOT EXISTS event_knockout_selections_event_team_active_idx
  ON public.event_knockout_selections(event_id, team_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_knockout_selections_event_seed_active_idx
  ON public.event_knockout_selections(event_id, seed)
  WHERE deleted_at IS NULL;

ALTER TABLE public.event_knockout_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_knockout_selections_select_scoped ON public.event_knockout_selections;
DROP POLICY IF EXISTS event_knockout_selections_no_direct_write ON public.event_knockout_selections;

CREATE POLICY event_knockout_selections_select_scoped
ON public.event_knockout_selections
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    public.current_role_name() = 'SUPER_ADMIN'
    OR tenant_id = public.current_tenant_id()
    OR public.has_event_access(event_id)
  )
);

REVOKE ALL ON public.event_knockout_selections FROM PUBLIC;
REVOKE ALL ON public.event_knockout_selections FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.event_knockout_selections FROM authenticated;
GRANT SELECT ON public.event_knockout_selections TO authenticated;

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
DECLARE
  v_account_id uuid;
  v_current_tenant_id uuid;
  v_role_name text;
  v_event record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'p_event_id is required';
  END IF;

  v_account_id := public.current_account_id();
  v_current_tenant_id := public.current_tenant_id();
  v_role_name := public.current_role_name();

  IF v_account_id IS NULL OR v_role_name IS NULL THEN
    RAISE EXCEPTION 'Active account is required';
  END IF;

  SELECT e.*
    INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_role_name <> 'SUPER_ADMIN' AND v_event.tenant_id <> v_current_tenant_id THEN
    RAISE EXCEPTION 'Event not found for current tenant';
  END IF;

  IF v_role_name IN ('REFEREE', 'VIEWER') THEN
    RAISE EXCEPTION 'Permission denied for %', p_rpc_name;
  END IF;

  IF NOT (
    v_role_name = 'SUPER_ADMIN'
    OR (v_role_name = 'TENANT_ADMIN' AND v_event.tenant_id = v_current_tenant_id)
    OR (
      v_role_name = 'EVENT_ADMIN'
      AND public.has_event_access(p_event_id)
      AND public.has_permission(p_permission)
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied for %', p_rpc_name;
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'tenant_id', v_event.tenant_id,
    'tournament_id', v_event.tournament_id,
    'format_type', COALESCE(v_event.format_type, 'group_then_knockout'),
    'ranking_config', COALESCE(v_event.ranking_config, '{}'::jsonb),
    'scoring_config', COALESCE(v_event.scoring_config, '{}'::jsonb),
    'role_name', v_role_name,
    'account_id', v_account_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.p06_group_label(p_index integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_index integer := p_index;
  v_label text := '';
BEGIN
  LOOP
    v_label := chr(65 + (v_index % 26)) || v_label;
    v_index := floor(v_index / 26.0)::integer - 1;
    EXIT WHEN v_index < 0;
  END LOOP;

  RETURN v_label;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_team_v1(
  p_event_id text,
  p_name text,
  p_seed text DEFAULT 'none'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_tournament_id text;
  v_name text;
  v_seed text;
  v_team_id text;
BEGIN
  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_teams', 'create_team_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_tournament_id := v_ctx->>'tournament_id';
  v_name := btrim(COALESCE(p_name, ''));
  v_seed := COALESCE(NULLIF(btrim(COALESCE(p_seed, 'none')), ''), 'none');

  IF v_name = '' THEN
    RAISE EXCEPTION 'Team name is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.event_id = p_event_id
      AND t.tenant_id = v_tenant_id
      AND t.deleted_at IS NULL
      AND lower(btrim(t.name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'Team name already exists in this event: %', v_name;
  END IF;

  v_team_id := 'team-' || gen_random_uuid()::text;

  INSERT INTO public.teams(id, name, seed, event_id, tenant_id, tournament_id)
  VALUES (v_team_id, v_name, v_seed, p_event_id, v_tenant_id, v_tournament_id);

  PERFORM public.log_audit_event_v1(
    'CREATE_TEAM',
    'team',
    v_team_id,
    jsonb_build_object('event_id', p_event_id, 'name', v_name, 'seed', v_seed)
  );

  RETURN jsonb_build_object(
    'success', true,
    'team_id', v_team_id,
    'event_id', p_event_id,
    'name', v_name,
    'seed', v_seed
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_team_v1(
  p_team_id text,
  p_name text DEFAULT NULL,
  p_seed text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_team record;
  v_ctx jsonb;
  v_name text;
  v_seed text;
BEGIN
  SELECT *
    INTO v_team
  FROM public.teams
  WHERE id = p_team_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found';
  END IF;

  v_ctx := public.p06_require_event_admin_v1(v_team.event_id, 'manage_teams', 'update_team_v1');
  v_name := COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), v_team.name);
  v_seed := COALESCE(NULLIF(btrim(COALESCE(p_seed, '')), ''), v_team.seed, 'none');

  IF EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.event_id = v_team.event_id
      AND t.tenant_id = (v_ctx->>'tenant_id')::uuid
      AND t.deleted_at IS NULL
      AND t.id <> p_team_id
      AND lower(btrim(t.name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'Team name already exists in this event: %', v_name;
  END IF;

  UPDATE public.teams
  SET name = v_name,
      seed = v_seed
  WHERE id = p_team_id
    AND event_id = v_team.event_id
    AND tenant_id = (v_ctx->>'tenant_id')::uuid
    AND deleted_at IS NULL;

  PERFORM public.log_audit_event_v1(
    'UPDATE_TEAM',
    'team',
    p_team_id,
    jsonb_build_object('event_id', v_team.event_id, 'old_name', v_team.name, 'new_name', v_name, 'old_seed', v_team.seed, 'new_seed', v_seed)
  );

  RETURN jsonb_build_object(
    'success', true,
    'team_id', p_team_id,
    'event_id', v_team.event_id,
    'name', v_name,
    'seed', v_seed
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_team_v1(p_team_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_team record;
  v_ctx jsonb;
BEGIN
  SELECT *
    INTO v_team
  FROM public.teams
  WHERE id = p_team_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found';
  END IF;

  v_ctx := public.p06_require_event_admin_v1(v_team.event_id, 'manage_teams', 'archive_team_v1');

  UPDATE public.teams
  SET deleted_at = now(),
      group_id = NULL
  WHERE id = p_team_id
    AND tenant_id = (v_ctx->>'tenant_id')::uuid
    AND deleted_at IS NULL;

  UPDATE public.groups g
  SET team_ids = COALESCE((
    SELECT jsonb_agg(t.id ORDER BY lower(t.name), t.id)
    FROM public.teams t
    WHERE t.event_id = v_team.event_id
      AND t.tenant_id = (v_ctx->>'tenant_id')::uuid
      AND t.deleted_at IS NULL
      AND t.group_id = g.id
  ), '[]'::jsonb)
  WHERE g.event_id = v_team.event_id
    AND g.tenant_id = (v_ctx->>'tenant_id')::uuid
    AND g.deleted_at IS NULL;

  PERFORM public.log_audit_event_v1(
    'ARCHIVE_TEAM',
    'team',
    p_team_id,
    jsonb_build_object('event_id', v_team.event_id, 'name', v_team.name)
  );

  RETURN jsonb_build_object('success', true, 'team_id', p_team_id, 'event_id', v_team.event_id, 'archived', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.import_teams_v1(
  p_event_id text,
  p_teams jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_tournament_id text;
  v_item jsonb;
  v_name text;
  v_seed text;
  v_team_id text;
  v_seen text[] := ARRAY[]::text[];
  v_created jsonb := '[]'::jsonb;
  v_count integer := 0;
BEGIN
  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_teams', 'import_teams_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_tournament_id := v_ctx->>'tournament_id';

  IF p_teams IS NULL OR jsonb_typeof(p_teams) <> 'array' OR jsonb_array_length(p_teams) = 0 THEN
    RAISE EXCEPTION 'p_teams must be a non-empty jsonb array';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_teams)
  LOOP
    IF jsonb_typeof(v_item) = 'string' THEN
      v_name := btrim(v_item #>> '{}');
      v_seed := 'none';
    ELSE
      v_name := btrim(COALESCE(v_item->>'name', ''));
      v_seed := COALESCE(NULLIF(btrim(COALESCE(v_item->>'seed', 'none')), ''), 'none');
    END IF;

    IF v_name = '' THEN
      RAISE EXCEPTION 'Import contains empty team name';
    END IF;

    IF lower(v_name) = ANY(v_seen) THEN
      RAISE EXCEPTION 'Import contains duplicate team name: %', v_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.teams t
      WHERE t.event_id = p_event_id
        AND t.tenant_id = v_tenant_id
        AND t.deleted_at IS NULL
        AND lower(btrim(t.name)) = lower(v_name)
    ) THEN
      RAISE EXCEPTION 'Team name already exists in this event: %', v_name;
    END IF;

    v_seen := array_append(v_seen, lower(v_name));
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_teams)
  LOOP
    IF jsonb_typeof(v_item) = 'string' THEN
      v_name := btrim(v_item #>> '{}');
      v_seed := 'none';
    ELSE
      v_name := btrim(v_item->>'name');
      v_seed := COALESCE(NULLIF(btrim(COALESCE(v_item->>'seed', 'none')), ''), 'none');
    END IF;

    v_team_id := 'team-' || gen_random_uuid()::text;

    INSERT INTO public.teams(id, name, seed, event_id, tenant_id, tournament_id)
    VALUES (v_team_id, v_name, v_seed, p_event_id, v_tenant_id, v_tournament_id);

    v_count := v_count + 1;
    v_created := v_created || jsonb_build_array(jsonb_build_object('team_id', v_team_id, 'name', v_name, 'seed', v_seed));
  END LOOP;

  PERFORM public.log_audit_event_v1(
    'IMPORT_TEAMS',
    'event',
    p_event_id,
    jsonb_build_object('imported_count', v_count, 'teams', v_created)
  );

  RETURN jsonb_build_object('success', true, 'event_id', p_event_id, 'imported_count', v_count, 'teams', v_created);
END;
$$;

CREATE OR REPLACE FUNCTION public.setup_groups_v4(
  p_event_id text,
  p_group_count integer,
  p_mode text DEFAULT 'balanced'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_tournament_id text;
  v_mode text := lower(btrim(COALESCE(p_mode, 'balanced')));
  v_team_count integer;
  v_index integer;
  v_group_id text;
  v_group_ids text[] := ARRAY[]::text[];
  v_assigned integer := 0;
  v_team record;
  v_group_count integer;
BEGIN
  IF p_group_count IS NULL THEN
    RAISE EXCEPTION 'p_group_count is required';
  END IF;

  IF p_group_count < 1 THEN
    RAISE EXCEPTION 'p_group_count must be between 1 and 32';
  END IF;

  IF p_group_count > 32 THEN
    RAISE EXCEPTION 'p_group_count must be between 1 and 32';
  END IF;

  IF v_mode NOT IN ('balanced', 'random', 'seed') THEN
    RAISE EXCEPTION 'p_mode must be balanced, random, or seed';
  END IF;

  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_groups', 'setup_groups_v4');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_tournament_id := v_ctx->>'tournament_id';

  SELECT count(*)::integer
    INTO v_team_count
  FROM public.teams
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  IF v_team_count = 0 THEN
    RAISE EXCEPTION 'No active teams found for event';
  END IF;

  IF v_team_count < p_group_count THEN
    RAISE EXCEPTION 'Team count (%) is smaller than requested group count (%)', v_team_count, p_group_count;
  END IF;

  UPDATE public.matches
  SET deleted_at = now()
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
    AND COALESCE(group_id, '') <> 'knockout';

  UPDATE public.teams
  SET group_id = NULL
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  UPDATE public.groups
  SET deleted_at = now()
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  FOR v_index IN 0..(p_group_count - 1) LOOP
    v_group_id := 'group-' || gen_random_uuid()::text;

    INSERT INTO public.groups(id, name, team_ids, event_id, tenant_id, tournament_id)
    VALUES (
      v_group_id,
      'Bảng ' || public.p06_group_label(v_index),
      '[]'::jsonb,
      p_event_id,
      v_tenant_id,
      v_tournament_id
    );

    v_group_ids := array_append(v_group_ids, v_group_id);
  END LOOP;

  FOR v_team IN
    SELECT id, row_number() OVER (
      ORDER BY
        CASE WHEN v_mode = 'random' THEN random() ELSE 0 END,
        CASE WHEN v_mode = 'seed' THEN CASE COALESCE(NULLIF(seed, ''), 'none') WHEN '1' THEN 1 WHEN '2' THEN 2 WHEN '3' THEN 3 WHEN '4' THEN 4 ELSE 9 END ELSE 0 END,
        lower(name),
        id
    ) AS rn
    FROM public.teams
    WHERE event_id = p_event_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL
  LOOP
    v_group_count := ((v_team.rn - 1) % p_group_count) + 1;

    UPDATE public.teams
    SET group_id = v_group_ids[v_group_count]
    WHERE id = v_team.id
      AND event_id = p_event_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL;

    v_assigned := v_assigned + 1;
  END LOOP;

  UPDATE public.groups g
  SET team_ids = COALESCE((
    SELECT jsonb_agg(t.id ORDER BY lower(t.name), t.id)
    FROM public.teams t
    WHERE t.event_id = p_event_id
      AND t.tenant_id = v_tenant_id
      AND t.deleted_at IS NULL
      AND t.group_id = g.id
  ), '[]'::jsonb)
  WHERE g.event_id = p_event_id
    AND g.tenant_id = v_tenant_id
    AND g.deleted_at IS NULL;

  UPDATE public.events
  SET ranking_config = jsonb_set(COALESCE(ranking_config, '{}'::jsonb), '{groupCount}', to_jsonb(p_group_count), true)
  WHERE id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  PERFORM public.log_audit_event_v1(
    'SETUP_GROUPS',
    'event',
    p_event_id,
    jsonb_build_object('group_count', p_group_count, 'mode', v_mode, 'team_count', v_team_count, 'assigned_teams', v_assigned)
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'group_count', p_group_count,
    'requested_group_count', p_group_count,
    'mode', v_mode,
    'team_count', v_team_count,
    'assigned_teams', v_assigned,
    'group_ids', to_jsonb(v_group_ids),
    'adjusted', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_team_to_group_v2(
  p_team_id text,
  p_group_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_team record;
  v_group record;
  v_ctx jsonb;
  v_tenant_id uuid;
  v_source_group_id text;
  v_active_match_count integer;
BEGIN
  SELECT *
    INTO v_team
  FROM public.teams
  WHERE id = p_team_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found';
  END IF;

  SELECT *
    INTO v_group
  FROM public.groups
  WHERE id = p_group_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  IF v_group.event_id <> v_team.event_id THEN
    RAISE EXCEPTION 'Cannot assign team to a group from another event';
  END IF;

  v_ctx := public.p06_require_event_admin_v1(v_team.event_id, 'manage_groups', 'assign_team_to_group_v2');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_source_group_id := v_team.group_id;

  IF v_team.tenant_id <> v_tenant_id OR v_group.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'Team or group not found for current tenant';
  END IF;

  SELECT count(*)::integer
    INTO v_active_match_count
  FROM public.matches
  WHERE event_id = v_team.event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
    AND COALESCE(group_id, '') <> 'knockout';

  IF v_active_match_count > 0 THEN
    RAISE EXCEPTION 'Schedule already generated; regenerate required before moving teams';
  END IF;

  UPDATE public.teams
  SET group_id = p_group_id
  WHERE id = p_team_id
    AND event_id = v_team.event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  UPDATE public.groups g
  SET team_ids = COALESCE((
    SELECT jsonb_agg(t.id ORDER BY lower(t.name), t.id)
    FROM public.teams t
    WHERE t.event_id = v_team.event_id
      AND t.tenant_id = v_tenant_id
      AND t.deleted_at IS NULL
      AND t.group_id = g.id
  ), '[]'::jsonb)
  WHERE g.event_id = v_team.event_id
    AND g.tenant_id = v_tenant_id
    AND g.deleted_at IS NULL;

  PERFORM public.log_audit_event_v1(
    'ASSIGN_TEAM_TO_GROUP',
    'team',
    p_team_id,
    jsonb_build_object('event_id', v_team.event_id, 'from_group_id', v_source_group_id, 'to_group_id', p_group_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_team.event_id,
    'team_id', p_team_id,
    'from_group_id', v_source_group_id,
    'to_group_id', p_group_id,
    'requires_regenerate', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dissolve_groups_v4(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_groups integer;
  v_teams integer;
  v_matches integer;
BEGIN
  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_groups', 'dissolve_groups_v4');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;

  UPDATE public.teams
  SET group_id = NULL
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_teams = ROW_COUNT;

  UPDATE public.groups
  SET deleted_at = now()
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_groups = ROW_COUNT;

  UPDATE public.matches
  SET deleted_at = now()
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
    AND COALESCE(group_id, '') <> 'knockout';
  GET DIAGNOSTICS v_matches = ROW_COUNT;

  UPDATE public.events
  SET ranking_config = COALESCE(ranking_config, '{}'::jsonb) - 'groupCount'
  WHERE id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  PERFORM public.log_audit_event_v1(
    'DISSOLVE_GROUPS',
    'event',
    p_event_id,
    jsonb_build_object('teams_cleared', v_teams, 'groups_dissolved', v_groups, 'matches_soft_deleted', v_matches)
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'teams_cleared', v_teams,
    'groups_dissolved', v_groups,
    'matches_soft_deleted', v_matches
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_schedule_v1(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_tournament_id text;
  v_format text;
  v_active_matches integer;
  v_created integer := 0;
  v_group record;
  v_team_a record;
  v_team_b record;
  v_round integer;
  v_scope_group_id text;
BEGIN
  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_matches', 'generate_schedule_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_tournament_id := v_ctx->>'tournament_id';
  v_format := COALESCE(v_ctx->>'format_type', 'group_then_knockout');

  SELECT count(*)::integer
    INTO v_active_matches
  FROM public.matches
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
    AND COALESCE(group_id, '') <> 'knockout';

  IF v_active_matches > 0 THEN
    RAISE EXCEPTION 'Active group-stage schedule already exists; regenerate requires explicit cleanup';
  END IF;

  IF v_format = 'knockout_only' THEN
    PERFORM public.log_audit_event_v1('GENERATE_SCHEDULE', 'event', p_event_id, jsonb_build_object('format_type', v_format, 'created_matches', 0));
    RETURN jsonb_build_object('success', true, 'event_id', p_event_id, 'format_type', v_format, 'created_matches', 0, 'message', 'knockout_only does not generate group-stage matches');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.groups
    WHERE event_id = p_event_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL
  ) THEN
    FOR v_group IN
      SELECT id
      FROM public.groups
      WHERE event_id = p_event_id
        AND tenant_id = v_tenant_id
        AND deleted_at IS NULL
      ORDER BY name, id
    LOOP
      v_round := 1;
      FOR v_team_a IN
        SELECT id, row_number() OVER (ORDER BY lower(name), id) AS rn
        FROM public.teams
        WHERE event_id = p_event_id
          AND tenant_id = v_tenant_id
          AND deleted_at IS NULL
          AND group_id = v_group.id
      LOOP
        FOR v_team_b IN
          SELECT id, row_number() OVER (ORDER BY lower(name), id) AS rn
          FROM public.teams
          WHERE event_id = p_event_id
            AND tenant_id = v_tenant_id
            AND deleted_at IS NULL
            AND group_id = v_group.id
        LOOP
          IF v_team_b.rn > v_team_a.rn THEN
            INSERT INTO public.matches(id, group_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round, event_id, tenant_id, tournament_id)
            VALUES ('match-' || gen_random_uuid()::text, v_group.id, v_team_a.id, v_team_b.id, NULL, NULL, NULL, 'pending', v_round, p_event_id, v_tenant_id, v_tournament_id);
            v_created := v_created + 1;
            v_round := v_round + 1;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  ELSE
    v_scope_group_id := 'round-robin-' || p_event_id;
    v_round := 1;

    FOR v_team_a IN
      SELECT id, row_number() OVER (ORDER BY lower(name), id) AS rn
      FROM public.teams
      WHERE event_id = p_event_id
        AND tenant_id = v_tenant_id
        AND deleted_at IS NULL
    LOOP
      FOR v_team_b IN
        SELECT id, row_number() OVER (ORDER BY lower(name), id) AS rn
        FROM public.teams
        WHERE event_id = p_event_id
          AND tenant_id = v_tenant_id
          AND deleted_at IS NULL
      LOOP
        IF v_team_b.rn > v_team_a.rn THEN
          INSERT INTO public.matches(id, group_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round, event_id, tenant_id, tournament_id)
          VALUES ('match-' || gen_random_uuid()::text, v_scope_group_id, v_team_a.id, v_team_b.id, NULL, NULL, NULL, 'pending', v_round, p_event_id, v_tenant_id, v_tournament_id);
          v_created := v_created + 1;
          v_round := v_round + 1;
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  PERFORM public.log_audit_event_v1(
    'GENERATE_SCHEDULE',
    'event',
    p_event_id,
    jsonb_build_object('format_type', v_format, 'created_matches', v_created)
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'format_type', v_format,
    'created_matches', v_created,
    'uses_bye_matches', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_knockout_candidates_v1(
  p_event_id text,
  p_top_per_group integer DEFAULT 2,
  p_best_third_count integer DEFAULT 0,
  p_exclude_bottom_results boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_format text;
  v_candidates jsonb;
BEGIN
  IF COALESCE(p_top_per_group, 0) < 0 THEN
    RAISE EXCEPTION 'p_top_per_group must be >= 0';
  END IF;

  IF COALESCE(p_best_third_count, 0) < 0 THEN
    RAISE EXCEPTION 'p_best_third_count must be >= 0';
  END IF;

  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_matches', 'prepare_knockout_candidates_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_format := COALESCE(v_ctx->>'format_type', 'group_then_knockout');

  IF v_format <> 'group_then_knockout' THEN
    RAISE EXCEPTION 'prepare_knockout_candidates_v1 applies only to group_then_knockout events';
  END IF;

  WITH base AS (
    SELECT
      g.id AS group_id,
      g.name AS group_name,
      t.id AS team_id,
      t.name AS team_name,
      count(m.id) FILTER (WHERE m.status = 'finished')::integer AS matches_played,
      count(m.id) FILTER (WHERE m.status = 'finished' AND m.winner_id = t.id)::integer AS wins,
      count(m.id) FILTER (WHERE m.status = 'finished' AND m.winner_id IS NOT NULL AND m.winner_id <> t.id)::integer AS losses,
      count(m.id) FILTER (WHERE m.status = 'finished' AND m.winner_id IS NULL)::integer AS draws,
      COALESCE(sum(
        CASE
          WHEN m.status <> 'finished' THEN 0
          WHEN m.team_a_id = t.id THEN COALESCE(m.score_a, 0) - COALESCE(m.score_b, 0)
          WHEN m.team_b_id = t.id THEN COALESCE(m.score_b, 0) - COALESCE(m.score_a, 0)
          ELSE 0
        END
      ), 0)::integer AS score_diff,
      COALESCE(sum(
        CASE
          WHEN m.status <> 'finished' THEN 0
          WHEN m.team_a_id = t.id THEN COALESCE(ms.score_a, m.score_a, 0) - COALESCE(ms.score_b, m.score_b, 0)
          WHEN m.team_b_id = t.id THEN COALESCE(ms.score_b, m.score_b, 0) - COALESCE(ms.score_a, m.score_a, 0)
          ELSE 0
        END
      ), 0)::integer AS point_diff
    FROM public.groups g
    JOIN public.teams t ON t.group_id = g.id
      AND t.event_id = g.event_id
      AND t.tenant_id = g.tenant_id
      AND t.deleted_at IS NULL
    LEFT JOIN public.matches m ON m.group_id = g.id
      AND m.event_id = g.event_id
      AND m.tenant_id = g.tenant_id
      AND m.deleted_at IS NULL
      AND (m.team_a_id = t.id OR m.team_b_id = t.id)
    LEFT JOIN LATERAL (
      SELECT sum(score_a)::integer AS score_a, sum(score_b)::integer AS score_b
      FROM public.match_sets
      WHERE match_id = m.id
        AND deleted_at IS NULL
    ) ms ON true
    WHERE g.event_id = p_event_id
      AND g.tenant_id = v_tenant_id
      AND g.deleted_at IS NULL
    GROUP BY g.id, g.name, t.id, t.name
  ),
  ranked AS (
    SELECT
      *,
      (wins * 3 + draws)::integer AS points,
      row_number() OVER (PARTITION BY group_id ORDER BY (wins * 3 + draws) DESC, score_diff DESC, point_diff DESC, lower(team_name), team_id) AS group_rank,
      count(*) OVER (PARTITION BY group_id) AS group_size
    FROM base
  ),
  bottom AS (
    SELECT group_id, team_id AS bottom_team_id
    FROM ranked
    WHERE group_rank = group_size
  ),
  thirds AS (
    SELECT
      r.*,
      CASE WHEN p_exclude_bottom_results THEN COALESCE(adj.points_delta, 0) ELSE 0 END AS points_delta,
      CASE WHEN p_exclude_bottom_results THEN COALESCE(adj.score_delta, 0) ELSE 0 END AS score_delta,
      CASE WHEN p_exclude_bottom_results THEN COALESCE(adj.point_delta, 0) ELSE 0 END AS point_delta
    FROM ranked r
    JOIN bottom b ON b.group_id = r.group_id
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN m.winner_id = r.team_id THEN -3
          WHEN m.winner_id IS NULL THEN -1
          ELSE 0
        END AS points_delta,
        -CASE
          WHEN m.team_a_id = r.team_id THEN COALESCE(m.score_a, 0) - COALESCE(m.score_b, 0)
          ELSE COALESCE(m.score_b, 0) - COALESCE(m.score_a, 0)
        END AS score_delta,
        -CASE
          WHEN m.team_a_id = r.team_id THEN COALESCE(ms.score_a, m.score_a, 0) - COALESCE(ms.score_b, m.score_b, 0)
          ELSE COALESCE(ms.score_b, m.score_b, 0) - COALESCE(ms.score_a, m.score_a, 0)
        END AS point_delta
      FROM public.matches m
      LEFT JOIN LATERAL (
        SELECT sum(score_a)::integer AS score_a, sum(score_b)::integer AS score_b
        FROM public.match_sets
        WHERE match_id = m.id
          AND deleted_at IS NULL
      ) ms ON true
      WHERE m.event_id = p_event_id
        AND m.tenant_id = v_tenant_id
        AND m.deleted_at IS NULL
        AND m.status = 'finished'
        AND m.group_id = r.group_id
        AND ((m.team_a_id = r.team_id AND m.team_b_id = b.bottom_team_id) OR (m.team_b_id = r.team_id AND m.team_a_id = b.bottom_team_id))
      LIMIT 1
    ) adj ON true
    WHERE r.group_rank = 3
  ),
  best_thirds_limited AS (
    SELECT
      team_id,
      team_name,
      group_id,
      group_name,
      matches_played,
      wins,
      losses,
      draws,
      (points + points_delta)::integer AS points,
      (score_diff + score_delta)::integer AS score_diff,
      (point_diff + point_delta)::integer AS point_diff,
      group_rank,
      group_size,
      'best_third'::text AS source,
      3 AS source_order
    FROM thirds
    ORDER BY (points + points_delta) DESC, (score_diff + score_delta) DESC, (point_diff + point_delta) DESC, lower(team_name), team_id
    LIMIT COALESCE(p_best_third_count, 0)
  ),
  selected AS (
    SELECT *, 'group_rank'::text AS source, group_rank AS source_order
    FROM ranked
    WHERE group_rank <= COALESCE(p_top_per_group, 2)
    UNION ALL
    SELECT *
    FROM best_thirds_limited
  ),
  numbered AS (
    SELECT
      *,
      row_number() OVER (ORDER BY source_order, group_name, group_rank, points DESC, score_diff DESC, point_diff DESC, lower(team_name), team_id) AS suggested_seed
    FROM selected
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id', team_id,
    'team_name', team_name,
    'group_id', group_id,
    'group_name', group_name,
    'group_rank', group_rank,
    'points', points,
    'score_diff', score_diff,
    'set_diff', score_diff,
    'point_diff', point_diff,
    'source', source,
    'suggested_seed', suggested_seed
  ) ORDER BY suggested_seed), '[]'::jsonb)
  INTO v_candidates
  FROM numbered;

  PERFORM public.log_audit_event_v1(
    'PREPARE_KNOCKOUT_CANDIDATES',
    'event',
    p_event_id,
    jsonb_build_object('top_per_group', p_top_per_group, 'best_third_count', p_best_third_count, 'exclude_bottom_results', p_exclude_bottom_results, 'candidate_count', jsonb_array_length(v_candidates))
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'candidates', v_candidates,
    'candidate_count', jsonb_array_length(v_candidates),
    'exclude_bottom_results', p_exclude_bottom_results
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_knockout_teams_v1(
  p_event_id text,
  p_teams jsonb,
  p_bracket_size integer,
  p_override_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_account_id uuid;
  v_item jsonb;
  v_team_id text;
  v_seed integer;
  v_source text;
  v_source_group_id text;
  v_group_rank integer;
  v_selected_count integer;
  v_seen_teams text[] := ARRAY[]::text[];
  v_seen_seeds integer[] := ARRAY[]::integer[];
  v_teams_result jsonb := '[]'::jsonb;
BEGIN
  IF p_bracket_size NOT IN (4, 8, 16, 32) THEN
    RAISE EXCEPTION 'p_bracket_size must be one of 4, 8, 16, 32';
  END IF;

  IF p_teams IS NULL OR jsonb_typeof(p_teams) <> 'array' THEN
    RAISE EXCEPTION 'p_teams must be a jsonb array';
  END IF;

  v_selected_count := jsonb_array_length(p_teams);

  IF v_selected_count = 0 THEN
    RAISE EXCEPTION 'At least one knockout team must be selected';
  END IF;

  IF v_selected_count > p_bracket_size THEN
    RAISE EXCEPTION 'Selected team count (%) exceeds bracket size (%)', v_selected_count, p_bracket_size;
  END IF;

  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_matches', 'confirm_knockout_teams_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_account_id := (v_ctx->>'account_id')::uuid;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_teams)
  LOOP
    v_team_id := btrim(COALESCE(v_item->>'team_id', ''));
    v_seed := COALESCE((v_item->>'seed')::integer, 0);

    IF v_team_id = '' THEN
      RAISE EXCEPTION 'team_id is required in p_teams';
    END IF;

    IF v_seed < 1 OR v_seed > p_bracket_size THEN
      RAISE EXCEPTION 'seed must be between 1 and bracket size';
    END IF;

    IF v_team_id = ANY(v_seen_teams) THEN
      RAISE EXCEPTION 'Duplicate team selected: %', v_team_id;
    END IF;

    IF v_seed = ANY(v_seen_seeds) THEN
      RAISE EXCEPTION 'Duplicate seed selected: %', v_seed;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.teams t
      WHERE t.id = v_team_id
        AND t.event_id = p_event_id
        AND t.tenant_id = v_tenant_id
        AND t.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Selected team does not belong to this event: %', v_team_id;
    END IF;

    v_seen_teams := array_append(v_seen_teams, v_team_id);
    v_seen_seeds := array_append(v_seen_seeds, v_seed);
  END LOOP;

  UPDATE public.event_knockout_selections
  SET deleted_at = now(),
      updated_at = now()
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_teams)
  LOOP
    v_team_id := btrim(v_item->>'team_id');
    v_seed := (v_item->>'seed')::integer;
    v_source := COALESCE(v_item->>'source', 'admin');
    v_source_group_id := v_item->>'source_group_id';
    v_group_rank := NULLIF(v_item->>'group_rank', '')::integer;

    INSERT INTO public.event_knockout_selections(
      tenant_id,
      event_id,
      team_id,
      seed,
      bracket_size,
      source,
      source_group_id,
      group_rank,
      is_override,
      override_reason,
      confirmed_by
    )
    VALUES (
      v_tenant_id,
      p_event_id,
      v_team_id,
      v_seed,
      p_bracket_size,
      v_source,
      v_source_group_id,
      v_group_rank,
      p_override_reason IS NOT NULL,
      p_override_reason,
      v_account_id
    );

    v_teams_result := v_teams_result || jsonb_build_array(jsonb_build_object(
      'team_id', v_team_id,
      'seed', v_seed,
      'source', v_source
    ));
  END LOOP;

  UPDATE public.events
  SET ranking_config = jsonb_set(
    jsonb_set(COALESCE(ranking_config, '{}'::jsonb), '{knockout,bracketSize}', to_jsonb(p_bracket_size), true),
    '{knockout,confirmedTeamCount}',
    to_jsonb(v_selected_count),
    true
  )
  WHERE id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  PERFORM public.log_audit_event_v1(
    'CONFIRM_KNOCKOUT_TEAMS',
    'event',
    p_event_id,
    jsonb_build_object('bracket_size', p_bracket_size, 'selected_count', v_selected_count, 'bye_count', p_bracket_size - v_selected_count, 'override_reason', p_override_reason, 'teams', v_teams_result)
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'bracket_size', p_bracket_size,
    'selected_count', v_selected_count,
    'bye_count', p_bracket_size - v_selected_count,
    'teams', v_teams_result
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_knockout_bracket_v1(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_tournament_id text;
  v_bracket_size integer;
  v_selected_count integer;
  v_round_count integer;
  v_round integer;
  v_match_index integer;
  v_matches_in_round integer;
  v_match_id text;
  v_next_match_id text;
  v_next_slot text;
  v_round_name text;
  v_knockout_match_id text;
  v_created integer := 0;
  v_seed_a integer;
  v_seed_b integer;
  v_team_a text;
  v_team_b text;
  v_team_a_name text;
  v_team_b_name text;
BEGIN
  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_matches', 'generate_knockout_bracket_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_tournament_id := v_ctx->>'tournament_id';

  IF EXISTS (
    SELECT 1
    FROM public.matches
    WHERE event_id = p_event_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL
      AND group_id = 'knockout'
  ) THEN
    RAISE EXCEPTION 'Active knockout bracket already exists';
  END IF;

  SELECT max(bracket_size), count(*)::integer
    INTO v_bracket_size, v_selected_count
  FROM public.event_knockout_selections
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  IF v_selected_count = 0 OR v_bracket_size IS NULL THEN
    RAISE EXCEPTION 'No confirmed knockout teams found';
  END IF;

  IF v_bracket_size NOT IN (4, 8, 16, 32) THEN
    RAISE EXCEPTION 'Invalid confirmed bracket size: %', v_bracket_size;
  END IF;

  v_round_count := CASE v_bracket_size WHEN 4 THEN 2 WHEN 8 THEN 3 WHEN 16 THEN 4 WHEN 32 THEN 5 END;

  CREATE TEMP TABLE IF NOT EXISTS p06_bracket_matches (
    round_no integer,
    match_index integer,
    match_id text
  ) ON COMMIT DROP;
  TRUNCATE p06_bracket_matches;

  FOR v_round IN 1..v_round_count LOOP
    v_matches_in_round := (v_bracket_size / (2 ^ v_round))::integer;

    FOR v_match_index IN 1..v_matches_in_round LOOP
      INSERT INTO p06_bracket_matches(round_no, match_index, match_id)
      VALUES (v_round, v_match_index, 'match-' || gen_random_uuid()::text);
    END LOOP;
  END LOOP;

  FOR v_round IN REVERSE v_round_count..1 LOOP
    v_matches_in_round := (v_bracket_size / (2 ^ v_round))::integer;

    v_round_name := CASE
      WHEN v_round = v_round_count THEN 'Chung Kết'
      WHEN v_round = v_round_count - 1 THEN 'Bán Kết'
      WHEN v_round = v_round_count - 2 THEN 'Tứ Kết'
      WHEN v_bracket_size = 16 AND v_round = 1 THEN 'Vòng 16 Đội'
      WHEN v_bracket_size = 32 AND v_round = 1 THEN 'Vòng 32 Đội'
      WHEN v_bracket_size = 32 AND v_round = 2 THEN 'Vòng 16 Đội'
      ELSE 'Vòng Knockout'
    END;

    FOR v_match_index IN 1..v_matches_in_round LOOP
      SELECT match_id
        INTO v_match_id
      FROM p06_bracket_matches
      WHERE round_no = v_round
        AND match_index = v_match_index;

      IF v_round < v_round_count THEN
        SELECT match_id
          INTO v_next_match_id
        FROM p06_bracket_matches
        WHERE round_no = v_round + 1
          AND match_index = ceil(v_match_index / 2.0)::integer;

        v_next_slot := CASE WHEN v_match_index % 2 = 1 THEN 'A' ELSE 'B' END;
      ELSE
        v_next_match_id := NULL;
        v_next_slot := NULL;
      END IF;

      v_knockout_match_id := CASE
        WHEN v_round_name = 'Chung Kết' THEN 'F'
        WHEN v_round_name = 'Bán Kết' THEN 'SF-' || v_match_index
        WHEN v_round_name = 'Tứ Kết' THEN 'QF-' || v_match_index
        WHEN v_round_name = 'Vòng 16 Đội' THEN 'R16-' || v_match_index
        WHEN v_round_name = 'Vòng 32 Đội' THEN 'R32-' || v_match_index
        ELSE 'KO-' || v_round || '-' || v_match_index
      END;

      v_team_a := NULL;
      v_team_b := NULL;
      v_team_a_name := NULL;
      v_team_b_name := NULL;

      IF v_round = 1 THEN
        v_seed_a := v_match_index;
        v_seed_b := v_bracket_size - v_match_index + 1;

        SELECT s.team_id, t.name
          INTO v_team_a, v_team_a_name
        FROM public.event_knockout_selections s
        JOIN public.teams t ON t.id = s.team_id
        WHERE s.event_id = p_event_id
          AND s.tenant_id = v_tenant_id
          AND s.deleted_at IS NULL
          AND s.seed = v_seed_a
        LIMIT 1;

        SELECT s.team_id, t.name
          INTO v_team_b, v_team_b_name
        FROM public.event_knockout_selections s
        JOIN public.teams t ON t.id = s.team_id
        WHERE s.event_id = p_event_id
          AND s.tenant_id = v_tenant_id
          AND s.deleted_at IS NULL
          AND s.seed = v_seed_b
        LIMIT 1;
      END IF;

      INSERT INTO public.matches(
        id,
        group_id,
        team_a_id,
        team_b_id,
        placeholder_a,
        placeholder_b,
        score_a,
        score_b,
        winner_id,
        status,
        round,
        knockout_round_name,
        knockout_match_id,
        next_match_id,
        next_match_slot,
        event_id,
        tenant_id,
        tournament_id
      )
      VALUES (
        v_match_id,
        'knockout',
        v_team_a,
        v_team_b,
        CASE
          WHEN v_round = 1 THEN COALESCE(v_team_a_name, 'BYE')
          ELSE 'W-' || (
            SELECT match_id
            FROM p06_bracket_matches
            WHERE round_no = v_round - 1
              AND match_index = (v_match_index * 2 - 1)
          )
        END,
        CASE
          WHEN v_round = 1 THEN COALESCE(v_team_b_name, 'BYE')
          ELSE 'W-' || (
            SELECT match_id
            FROM p06_bracket_matches
            WHERE round_no = v_round - 1
              AND match_index = (v_match_index * 2)
          )
        END,
        NULL,
        NULL,
        NULL,
        'pending',
        v_round,
        v_round_name,
        v_knockout_match_id,
        v_next_match_id,
        v_next_slot,
        p_event_id,
        v_tenant_id,
        v_tournament_id
      );

      v_created := v_created + 1;
    END LOOP;
  END LOOP;

  PERFORM public.log_audit_event_v1(
    'GENERATE_KNOCKOUT_BRACKET',
    'event',
    p_event_id,
    jsonb_build_object('bracket_size', v_bracket_size, 'selected_count', v_selected_count, 'bye_count', v_bracket_size - v_selected_count, 'created_matches', v_created)
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'bracket_size', v_bracket_size,
    'selected_count', v_selected_count,
    'bye_count', v_bracket_size - v_selected_count,
    'created_matches', v_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.p06_require_event_admin_v1(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p06_group_label(integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_team_v1(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_team_v1(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.update_team_v1(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_team_v1(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.archive_team_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_team_v1(text) FROM anon;
REVOKE ALL ON FUNCTION public.import_teams_v1(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_teams_v1(text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.setup_groups_v4(text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.setup_groups_v4(text, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.assign_team_to_group_v2(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_team_to_group_v2(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.dissolve_groups_v4(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dissolve_groups_v4(text) FROM anon;
REVOKE ALL ON FUNCTION public.generate_schedule_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_schedule_v1(text) FROM anon;
REVOKE ALL ON FUNCTION public.prepare_knockout_candidates_v1(text, integer, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_knockout_candidates_v1(text, integer, integer, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_knockout_teams_v1(text, jsonb, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_knockout_teams_v1(text, jsonb, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.generate_knockout_bracket_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_knockout_bracket_v1(text) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_team_v1(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_team_v1(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_team_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_teams_v1(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.setup_groups_v4(text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_team_to_group_v2(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dissolve_groups_v4(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_schedule_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_knockout_candidates_v1(text, integer, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_knockout_teams_v1(text, jsonb, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_knockout_bracket_v1(text) TO authenticated;

COMMIT;
