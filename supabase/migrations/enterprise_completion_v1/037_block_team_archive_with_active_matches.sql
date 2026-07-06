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
