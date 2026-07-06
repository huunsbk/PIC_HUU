-- Prevent active schedule or score history from becoming orphaned when a team is archived.
CREATE OR REPLACE FUNCTION public.archive_team_v1(p_team_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_team record;
  v_ctx jsonb;
  v_tenant_id uuid;
  v_active_match_count integer := 0;
  v_has_match_results boolean := false;
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
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;

  SELECT
    count(*)::integer,
    COALESCE(bool_or(
      m.status IN ('playing', 'finished')
      OR m.score_a IS NOT NULL
      OR m.score_b IS NOT NULL
      OR m.winner_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM public.match_sets ms
        WHERE ms.match_id = m.id
          AND ms.deleted_at IS NULL
          AND (
            ms.status IN ('playing', 'finished')
            OR ms.score_a IS NOT NULL
            OR ms.score_b IS NOT NULL
            OR ms.winner_id IS NOT NULL
          )
      )
    ), false)
    INTO v_active_match_count, v_has_match_results
  FROM public.matches m
  WHERE m.event_id = v_team.event_id
    AND m.tenant_id = v_tenant_id
    AND m.deleted_at IS NULL
    AND (m.team_a_id = p_team_id OR m.team_b_id = p_team_id);

  IF v_active_match_count > 0 THEN
    IF v_has_match_results THEN
      RAISE EXCEPTION 'TEAM_DELETE_BLOCKED_MATCH_RESULTS';
    END IF;

    RAISE EXCEPTION 'TEAM_DELETE_BLOCKED_ACTIVE_SCHEDULE';
  END IF;

  UPDATE public.teams
  SET deleted_at = now(),
      group_id = NULL
  WHERE id = p_team_id
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
    'ARCHIVE_TEAM',
    'team',
    p_team_id,
    jsonb_build_object('event_id', v_team.event_id, 'name', v_team.name)
  );

  RETURN jsonb_build_object('success', true, 'team_id', p_team_id, 'event_id', v_team.event_id, 'archived', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.hard_delete_event_teams_v1(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_match_sets integer := 0;
  v_knockout_slots integer := 0;
  v_knockout_selections integer := 0;
  v_matches integer := 0;
  v_groups integer := 0;
  v_soft_teams integer := 0;
  v_teams integer := 0;
  v_deleted jsonb;
BEGIN
  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_teams', 'hard_delete_event_teams_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;

  UPDATE public.teams
  SET deleted_at = COALESCE(deleted_at, now()),
      group_id = NULL
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id;
  GET DIAGNOSTICS v_soft_teams = ROW_COUNT;

  DELETE FROM public.match_sets
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id;
  GET DIAGNOSTICS v_match_sets = ROW_COUNT;

  IF to_regclass('public.knockout_slots') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.knockout_slots WHERE event_id = $1 AND tenant_id = $2' USING p_event_id, v_tenant_id;
    GET DIAGNOSTICS v_knockout_slots = ROW_COUNT;
  END IF;

  IF to_regclass('public.event_knockout_selections') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.event_knockout_selections WHERE event_id = $1 AND tenant_id = $2' USING p_event_id, v_tenant_id;
    GET DIAGNOSTICS v_knockout_selections = ROW_COUNT;
  END IF;

  DELETE FROM public.matches
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id;
  GET DIAGNOSTICS v_matches = ROW_COUNT;

  DELETE FROM public.groups
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id;
  GET DIAGNOSTICS v_groups = ROW_COUNT;

  DELETE FROM public.teams
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id;
  GET DIAGNOSTICS v_teams = ROW_COUNT;

  UPDATE public.events
  SET ranking_config = COALESCE(ranking_config, '{}'::jsonb) - 'groupCount'
  WHERE id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  v_deleted := jsonb_build_object(
    'soft_marked_teams', v_soft_teams,
    'match_sets', v_match_sets,
    'knockout_slots', v_knockout_slots,
    'knockout_selections', v_knockout_selections,
    'matches', v_matches,
    'groups', v_groups,
    'teams', v_teams
  );

  PERFORM public.log_audit_event_v1(
    'HARD_DELETE_EVENT_TEAMS',
    'event',
    p_event_id,
    jsonb_build_object('deleted', v_deleted)
  );

  RETURN jsonb_build_object('success', true, 'event_id', p_event_id, 'deleted', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.hard_delete_event_teams_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hard_delete_event_teams_v1(text) TO authenticated;
