-- Content PDF requirements: set-diff ranking defaults and manual empty group ordering.

UPDATE public.events
SET ranking_config = jsonb_set(
  COALESCE(ranking_config, '{}'::jsonb),
  '{tieBreakers}',
  '["points","setDiff","pointDiff","headToHead"]'::jsonb,
  true
)
WHERE deleted_at IS NULL
  AND (
    NOT (COALESCE(ranking_config, '{}'::jsonb) ? 'tieBreakers')
    OR COALESCE(ranking_config, '{}'::jsonb)->'tieBreakers' = '["points","pointDiff","pointsWon","headToHead"]'::jsonb
  );

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
  IF p_group_count IS NULL OR p_group_count < 1 OR p_group_count > 32 THEN
    RAISE EXCEPTION 'p_group_count must be between 1 and 32';
  END IF;

  IF v_mode NOT IN ('balanced', 'random', 'seed', 'empty') THEN
    RAISE EXCEPTION 'p_mode must be balanced, random, seed, or empty';
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

  IF v_mode <> 'empty' THEN
    IF v_team_count = 0 THEN
      RAISE EXCEPTION 'No active teams found for event';
    END IF;

    IF v_team_count < p_group_count THEN
      RAISE EXCEPTION 'Team count (%) is smaller than requested group count (%)', v_team_count, p_group_count;
    END IF;
  END IF;

  UPDATE public.match_sets ms
  SET deleted_at = now()
  FROM public.matches m
  WHERE ms.match_id = m.id
    AND m.event_id = p_event_id
    AND m.tenant_id = v_tenant_id
    AND m.deleted_at IS NULL
    AND ms.deleted_at IS NULL
    AND COALESCE(m.group_id, '') <> 'knockout';

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

  IF v_mode <> 'empty' THEN
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
  END IF;

  UPDATE public.events
  SET ranking_config = jsonb_set(
    jsonb_set(COALESCE(ranking_config, '{}'::jsonb), '{groupCount}', to_jsonb(p_group_count), true),
    '{tieBreakers}',
    '["points","setDiff","pointDiff","headToHead"]'::jsonb,
    true
  )
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

DROP FUNCTION IF EXISTS public.assign_team_to_group_v2(text, text);
DROP FUNCTION IF EXISTS public.assign_team_to_group_v2(text, text, text);
DROP FUNCTION IF EXISTS public.assign_team_to_group_v2(text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.assign_team_to_group_v2(
  p_team_id text,
  p_group_id text DEFAULT NULL,
  p_before_team_id text DEFAULT NULL,
  p_force boolean DEFAULT false
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
  v_matches_soft_deleted integer := 0;
  v_existing_team_id text;
  v_target_team_ids text[] := ARRAY[]::text[];
  v_new_team_ids text[] := ARRAY[]::text[];
  v_inserted boolean := false;
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

  v_ctx := public.p06_require_event_admin_v1(v_team.event_id, 'manage_groups', 'assign_team_to_group_v2');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_source_group_id := v_team.group_id;

  IF v_team.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'Team not found for current tenant';
  END IF;

  IF p_group_id IS NOT NULL THEN
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

    IF v_group.tenant_id <> v_tenant_id THEN
      RAISE EXCEPTION 'Group not found for current tenant';
    END IF;
  END IF;

  SELECT count(*)::integer
    INTO v_active_match_count
  FROM public.matches
  WHERE event_id = v_team.event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
    AND COALESCE(group_id, '') <> 'knockout';

  IF v_active_match_count > 0 AND NOT p_force THEN
    RAISE EXCEPTION 'Schedule already generated; confirmation is required before moving teams';
  END IF;

  IF v_active_match_count > 0 THEN
    UPDATE public.match_sets ms
    SET deleted_at = now()
    FROM public.matches m
    WHERE ms.match_id = m.id
      AND m.event_id = v_team.event_id
      AND m.tenant_id = v_tenant_id
      AND m.deleted_at IS NULL
      AND ms.deleted_at IS NULL
      AND COALESCE(m.group_id, '') <> 'knockout';

    UPDATE public.matches
    SET deleted_at = now()
    WHERE event_id = v_team.event_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL
      AND COALESCE(group_id, '') <> 'knockout';
    GET DIAGNOSTICS v_matches_soft_deleted = ROW_COUNT;
  END IF;

  UPDATE public.teams
  SET group_id = p_group_id
  WHERE id = p_team_id
    AND event_id = v_team.event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  UPDATE public.groups g
  SET team_ids = COALESCE((
    SELECT jsonb_agg(team_id ORDER BY ord)
    FROM (
      SELECT x.value AS team_id, x.ord
      FROM jsonb_array_elements_text(COALESCE(g.team_ids, '[]'::jsonb)) WITH ORDINALITY AS x(value, ord)
      WHERE x.value <> p_team_id
        AND EXISTS (
          SELECT 1
          FROM public.teams t
          WHERE t.id = x.value
            AND t.event_id = v_team.event_id
            AND t.tenant_id = v_tenant_id
            AND t.deleted_at IS NULL
            AND t.group_id = g.id
        )
    ) AS ordered_team_ids
  ), '[]'::jsonb)
  WHERE g.event_id = v_team.event_id
    AND g.tenant_id = v_tenant_id
    AND g.deleted_at IS NULL;

  IF p_group_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(x.value ORDER BY x.ord), ARRAY[]::text[])
      INTO v_target_team_ids
    FROM jsonb_array_elements_text(COALESCE((
      SELECT team_ids FROM public.groups WHERE id = p_group_id
    ), '[]'::jsonb)) WITH ORDINALITY AS x(value, ord);

    FOREACH v_existing_team_id IN ARRAY v_target_team_ids LOOP
      IF NOT v_inserted AND p_before_team_id IS NOT NULL AND v_existing_team_id = p_before_team_id THEN
        v_new_team_ids := array_append(v_new_team_ids, p_team_id);
        v_inserted := true;
      END IF;
      v_new_team_ids := array_append(v_new_team_ids, v_existing_team_id);
    END LOOP;

    IF NOT v_inserted THEN
      v_new_team_ids := array_append(v_new_team_ids, p_team_id);
    END IF;

    UPDATE public.groups
    SET team_ids = to_jsonb(v_new_team_ids)
    WHERE id = p_group_id
      AND event_id = v_team.event_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL;
  END IF;

  PERFORM public.log_audit_event_v1(
    'ASSIGN_TEAM_TO_GROUP',
    'team',
    p_team_id,
    jsonb_build_object(
      'event_id', v_team.event_id,
      'from_group_id', v_source_group_id,
      'to_group_id', p_group_id,
      'before_team_id', p_before_team_id,
      'matches_soft_deleted', v_matches_soft_deleted
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_team.event_id,
    'team_id', p_team_id,
    'from_group_id', v_source_group_id,
    'to_group_id', p_group_id,
    'before_team_id', p_before_team_id,
    'requires_regenerate', v_matches_soft_deleted > 0,
    'matches_soft_deleted', v_matches_soft_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.assign_team_to_group_v2(text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_team_to_group_v2(text, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_team_to_group_v2(text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.setup_groups_v4(text, integer, text) TO authenticated;
