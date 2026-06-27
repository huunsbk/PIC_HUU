-- Fix KO resolve metadata writes when a slot must clear back to unresolved JSON null.
BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_knockout_slots_v1(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
  v_role text;
  v_current_tenant_id uuid;
  v_event record;
  v_resolved_slots integer := 0;
  v_updated_matches integer := 0;
  v_ordered_matches integer := 0;
  v_all_groups_complete boolean := false;
BEGIN
  v_account_id := public.current_account_id();
  v_role := public.current_role_name();
  v_current_tenant_id := public.current_tenant_id();

  IF auth.uid() IS NULL OR v_account_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF p_event_id IS NULL OR p_event_id !~ '^evt_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_EVENT_ID';
  END IF;

  SELECT e.*
    INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND';
  END IF;

  IF v_role <> 'SUPER_ADMIN' AND v_event.tenant_id <> v_current_tenant_id THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND';
  END IF;

  IF NOT (
    v_role = 'SUPER_ADMIN'
    OR (v_role = 'TENANT_ADMIN' AND v_event.tenant_id = v_current_tenant_id)
    OR (
      v_role IN ('EVENT_ADMIN', 'REFEREE')
      AND public.has_event_access(p_event_id)
      AND (public.has_permission('manage_matches') OR public.has_permission('enter_scores') OR public.has_permission('view_public'))
    )
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS p21_group_completion (
    group_id text PRIMARY KEY,
    match_count integer NOT NULL,
    finished_count integer NOT NULL,
    is_complete boolean NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE p21_group_completion;

  INSERT INTO p21_group_completion(group_id, match_count, finished_count, is_complete)
  SELECT
    g.id,
    count(m.id)::integer AS match_count,
    count(m.id) FILTER (WHERE m.status = 'finished')::integer AS finished_count,
    (count(m.id) > 0 AND count(m.id) = count(m.id) FILTER (WHERE m.status = 'finished')) AS is_complete
  FROM public.groups g
  LEFT JOIN public.matches m
    ON m.group_id = g.id
   AND m.event_id = p_event_id
   AND m.tenant_id = v_event.tenant_id
   AND m.deleted_at IS NULL
  WHERE g.event_id = p_event_id
    AND g.tenant_id = v_event.tenant_id
    AND g.deleted_at IS NULL
  GROUP BY g.id;

  SELECT COALESCE(bool_and(is_complete), false)
    INTO v_all_groups_complete
  FROM p21_group_completion;

  CREATE TEMP TABLE IF NOT EXISTS p21_ranked (
    group_id text NOT NULL,
    group_name text NOT NULL,
    team_id text NOT NULL,
    team_name text NOT NULL,
    group_rank integer NOT NULL,
    matches_played integer NOT NULL,
    wins integer NOT NULL,
    losses integer NOT NULL,
    points integer NOT NULL,
    sets_won integer NOT NULL,
    sets_lost integer NOT NULL,
    set_diff integer NOT NULL,
    points_for integer NOT NULL,
    points_against integer NOT NULL,
    point_diff integer NOT NULL,
    group_complete boolean NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE p21_ranked;

  INSERT INTO p21_ranked(
    group_id, group_name, team_id, team_name, group_rank,
    matches_played, wins, losses, points,
    sets_won, sets_lost, set_diff,
    points_for, points_against, point_diff, group_complete
  )
  WITH group_teams AS (
    SELECT
      g.id AS group_id,
      g.name AS group_name,
      t.id AS team_id,
      t.name AS team_name,
      COALESCE((
        SELECT team_item.ordinality::integer
        FROM jsonb_array_elements_text(COALESCE(g.team_ids, '[]'::jsonb)) WITH ORDINALITY AS team_item(team_id, ordinality)
        WHERE team_item.team_id = t.id
        LIMIT 1
      ), 2147483647) AS team_order,
      COALESCE(gc.is_complete, false) AS group_complete
    FROM public.groups g
    JOIN public.teams t
      ON t.group_id = g.id
     AND t.event_id = p_event_id
     AND t.tenant_id = v_event.tenant_id
     AND t.deleted_at IS NULL
    LEFT JOIN p21_group_completion gc ON gc.group_id = g.id
    WHERE g.event_id = p_event_id
      AND g.tenant_id = v_event.tenant_id
      AND g.deleted_at IS NULL
  ),
  metrics AS (
    SELECT
      gt.group_id,
      gt.group_name,
      gt.team_id,
      gt.team_name,
      gt.team_order,
      gt.group_complete,
      count(m.id)::integer AS matches_played,
      count(m.id) FILTER (WHERE m.winner_id = gt.team_id)::integer AS wins,
      count(m.id) FILTER (WHERE m.winner_id IS NOT NULL AND m.winner_id <> gt.team_id)::integer AS losses,
      COALESCE(sum(
        CASE
          WHEN COALESCE(ms.set_count, 0) > 0 THEN ms.sets_for
          WHEN m.winner_id = gt.team_id THEN 1
          ELSE 0
        END
      ), 0)::integer AS sets_won,
      COALESCE(sum(
        CASE
          WHEN COALESCE(ms.set_count, 0) > 0 THEN ms.sets_against
          WHEN m.winner_id IS NOT NULL AND m.winner_id <> gt.team_id THEN 1
          ELSE 0
        END
      ), 0)::integer AS sets_lost,
      COALESCE(sum(
        CASE
          WHEN COALESCE(ms.set_count, 0) > 0 THEN ms.points_for
          WHEN m.team_a_id = gt.team_id THEN COALESCE(m.score_a, 0)
          WHEN m.team_b_id = gt.team_id THEN COALESCE(m.score_b, 0)
          ELSE 0
        END
      ), 0)::integer AS points_for,
      COALESCE(sum(
        CASE
          WHEN COALESCE(ms.set_count, 0) > 0 THEN ms.points_against
          WHEN m.team_a_id = gt.team_id THEN COALESCE(m.score_b, 0)
          WHEN m.team_b_id = gt.team_id THEN COALESCE(m.score_a, 0)
          ELSE 0
        END
      ), 0)::integer AS points_against
    FROM group_teams gt
    LEFT JOIN public.matches m
      ON m.group_id = gt.group_id
     AND m.event_id = p_event_id
     AND m.tenant_id = v_event.tenant_id
     AND m.deleted_at IS NULL
     AND m.status = 'finished'
     AND (m.team_a_id = gt.team_id OR m.team_b_id = gt.team_id)
    LEFT JOIN LATERAL (
      SELECT
        count(*)::integer AS set_count,
        count(*) FILTER (WHERE s.winner_id = gt.team_id)::integer AS sets_for,
        count(*) FILTER (WHERE s.winner_id IS NOT NULL AND s.winner_id <> gt.team_id)::integer AS sets_against,
        COALESCE(sum(CASE WHEN m.team_a_id = gt.team_id THEN s.score_a ELSE s.score_b END), 0)::integer AS points_for,
        COALESCE(sum(CASE WHEN m.team_a_id = gt.team_id THEN s.score_b ELSE s.score_a END), 0)::integer AS points_against
      FROM public.match_sets s
      WHERE s.match_id = m.id
        AND s.deleted_at IS NULL
        AND s.status = 'finished'
    ) ms ON true
    GROUP BY gt.group_id, gt.group_name, gt.team_id, gt.team_name, gt.team_order, gt.group_complete
  ),
  ranked AS (
    SELECT
      *,
      (wins * 2 + losses)::integer AS points,
      (sets_won - sets_lost)::integer AS set_diff,
      (points_for - points_against)::integer AS point_diff,
      row_number() OVER (
        PARTITION BY group_id
        ORDER BY
          (wins * 2 + losses) DESC,
          (sets_won - sets_lost) DESC,
          (points_for - points_against) DESC,
          points_for DESC,
          team_order ASC,
          lower(team_name),
          team_id
      )::integer AS group_rank
    FROM metrics
  )
  SELECT
    group_id,
    group_name,
    team_id,
    team_name,
    group_rank,
    matches_played,
    wins,
    losses,
    points,
    sets_won,
    sets_lost,
    set_diff,
    points_for,
    points_against,
    point_diff,
    group_complete
  FROM ranked;

  CREATE TEMP TABLE IF NOT EXISTS p21_best_thirds (
    best_third_index integer PRIMARY KEY,
    team_id text NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE p21_best_thirds;

  IF v_all_groups_complete THEN
    INSERT INTO p21_best_thirds(best_third_index, team_id)
    SELECT
      row_number() OVER (
        ORDER BY
          points DESC,
          set_diff DESC,
          point_diff DESC,
          points_for DESC,
          lower(team_name),
          team_id
      )::integer AS best_third_index,
      team_id
    FROM p21_ranked
    WHERE group_rank = 3
      AND group_complete;
  END IF;

  WITH resolved AS (
    SELECT
      ks.id AS slot_id,
      CASE
        WHEN ks.source_type = 'group_rank' THEN r.team_id
        WHEN ks.source_type = 'best_third' THEN bt.team_id
        ELSE NULL
      END AS resolved_team_id
    FROM public.knockout_slots ks
    LEFT JOIN p21_ranked r
      ON ks.source_type = 'group_rank'
     AND r.group_id = ks.group_id
     AND r.group_rank = ks.group_rank
     AND r.group_complete
    LEFT JOIN p21_best_thirds bt
      ON ks.source_type = 'best_third'
     AND bt.best_third_index = ks.best_third_index
    WHERE ks.event_id = p_event_id
      AND ks.tenant_id = v_event.tenant_id
      AND ks.deleted_at IS NULL
  )
  UPDATE public.knockout_slots ks
  SET resolved_team_id = resolved.resolved_team_id,
      resolved_at = CASE WHEN resolved.resolved_team_id IS NULL THEN NULL ELSE now() END,
      updated_at = now()
  FROM resolved
  WHERE ks.id = resolved.slot_id
    AND ks.resolved_team_id IS DISTINCT FROM resolved.resolved_team_id;
  GET DIAGNOSTICS v_resolved_slots = ROW_COUNT;

  WITH slot_pairs AS (
    SELECT
      ks.match_id,
      max(ks.resolved_team_id) FILTER (WHERE ks.slot_code = 'A') AS team_a_id,
      max(ks.resolved_team_id) FILTER (WHERE ks.slot_code = 'B') AS team_b_id
    FROM public.knockout_slots ks
    WHERE ks.event_id = p_event_id
      AND ks.tenant_id = v_event.tenant_id
      AND ks.deleted_at IS NULL
    GROUP BY ks.match_id
  ),
  writable_matches AS (
    SELECT m.id, sp.team_a_id, sp.team_b_id
    FROM public.matches m
    JOIN slot_pairs sp ON sp.match_id = m.id
    WHERE m.event_id = p_event_id
      AND m.tenant_id = v_event.tenant_id
      AND m.group_id = 'knockout'
      AND m.deleted_at IS NULL
      AND m.status = 'pending'
      AND NOT EXISTS (
        SELECT 1
        FROM public.match_sets ms
        WHERE ms.match_id = m.id
          AND ms.deleted_at IS NULL
      )
      AND (m.team_a_id IS DISTINCT FROM sp.team_a_id OR m.team_b_id IS DISTINCT FROM sp.team_b_id)
  )
  UPDATE public.matches m
  SET team_a_id = wm.team_a_id,
      team_b_id = wm.team_b_id,
      metadata = jsonb_set(
        jsonb_set(COALESCE(m.metadata, '{}'::jsonb), '{resolved_team_id_a}', COALESCE(to_jsonb(wm.team_a_id), 'null'::jsonb), true),
        '{resolved_team_id_b}', COALESCE(to_jsonb(wm.team_b_id), 'null'::jsonb), true
      )
  FROM writable_matches wm
  WHERE m.id = wm.id;
  GET DIAGNOSTICS v_updated_matches = ROW_COUNT;

  WITH ordered AS (
    SELECT
      m.id,
      row_number() OVER (
        ORDER BY
          m.round ASC,
          COALESCE(NULLIF(regexp_replace(COALESCE(m.knockout_match_id, ''), '\D', '', 'g'), '')::integer, 0),
          COALESCE(m.knockout_match_id, ''),
          m.id
      )::integer AS order_no
    FROM public.matches m
    WHERE m.event_id = p_event_id
      AND m.tenant_id = v_event.tenant_id
      AND m.group_id = 'knockout'
      AND m.deleted_at IS NULL
  )
  UPDATE public.matches m
  SET display_order = 10000 + ordered.order_no
  FROM ordered
  WHERE m.id = ordered.id
    AND m.display_order IS DISTINCT FROM (10000 + ordered.order_no);
  GET DIAGNOSTICS v_ordered_matches = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'resolved_slots', v_resolved_slots,
    'updated_matches', v_updated_matches,
    'ordered_matches', v_ordered_matches,
    'all_groups_complete', v_all_groups_complete
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_knockout_slots_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_knockout_slots_v1(text) TO authenticated;

COMMIT;

