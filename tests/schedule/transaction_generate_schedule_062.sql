BEGIN;

-- Marks this as an intentional rollback write test for the guarded runner.
UPDATE public.events SET name = name WHERE false;

DO $$
DECLARE
  v_user_id uuid;
  v_tournament_id text;
  v_event_id text;
  v_event_result jsonb;
  v_schedule_result jsonb;
  v_group record;
  v_group_count integer := 0;
  v_match_count integer;
  v_round_count integer;
  v_round_conflicts integer;
  v_duplicate_pairs integer;
  v_adjacent_conflicts integer;
  v_index integer;
BEGIN
  SELECT a.user_id
    INTO v_user_id
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  WHERE r.name = 'SUPER_ADMIN'
    AND a.status = 'active'
    AND a.deleted_at IS NULL
    AND a.user_id IS NOT NULL
  ORDER BY a.created_at
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FIXTURE_MISSING:active_super_admin';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  SELECT tournament.id
    INTO v_tournament_id
  FROM public.tournament
  JOIN public.tenants tenant ON tenant.id = tournament.tenant_id
  WHERE tournament.deleted_at IS NULL
    AND tournament.status = 'active'
    AND tenant.deleted_at IS NULL
    AND tenant.status = 'active'
    AND COALESCE(tenant.tenant_type, 'managed') <> 'self_service_customer'
  ORDER BY tournament.created_at
  LIMIT 1;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FIXTURE_MISSING:managed_tournament';
  END IF;

  v_event_result := public.create_event_v1(
    v_tournament_id,
    'Round-robin 5+4 rollback test',
    'sport_pickleball',
    'doubles',
    'group_then_knockout',
    (SELECT default_settings FROM public.sports WHERE id = 'sport_pickleball'),
    (SELECT default_ranking_config || '{"groupCount":2}'::jsonb FROM public.sports WHERE id = 'sport_pickleball')
  );
  v_event_id := v_event_result->>'event_id';

  FOR v_index IN 1..9
  LOOP
    PERFORM public.create_team_v1(v_event_id, 'Đội kiểm thử ' || lpad(v_index::text, 2, '0'), 'none');
  END LOOP;

  PERFORM public.setup_groups_v4(v_event_id, 2, 'balanced');
  v_schedule_result := public.generate_schedule_v1(v_event_id);

  IF v_schedule_result->>'scheduling_mode' <> 'round_robin_circle_v1' THEN
    RAISE EXCEPTION 'SCHEDULE_MODE_MISMATCH:%', v_schedule_result;
  END IF;

  IF (v_schedule_result->>'created_matches')::integer <> 16 THEN
    RAISE EXCEPTION 'SCHEDULE_MATCH_COUNT_MISMATCH:%', v_schedule_result;
  END IF;

  FOR v_group IN
    SELECT g.id, count(t.id)::integer AS team_count
    FROM public.groups g
    JOIN public.teams t
      ON t.group_id = g.id
     AND t.event_id = v_event_id
     AND t.deleted_at IS NULL
    WHERE g.event_id = v_event_id
      AND g.deleted_at IS NULL
    GROUP BY g.id
    ORDER BY count(t.id) DESC, g.id
  LOOP
    v_group_count := v_group_count + 1;

    SELECT count(*)::integer, count(DISTINCT round)::integer
      INTO v_match_count, v_round_count
    FROM public.matches
    WHERE event_id = v_event_id
      AND group_id = v_group.id
      AND deleted_at IS NULL;

    IF v_match_count <> (v_group.team_count * (v_group.team_count - 1)) / 2 THEN
      RAISE EXCEPTION 'GROUP_MATCH_COUNT_MISMATCH:%:%', v_group.team_count, v_match_count;
    END IF;

    IF v_round_count <> (CASE WHEN mod(v_group.team_count, 2) = 0 THEN v_group.team_count - 1 ELSE v_group.team_count END) THEN
      RAISE EXCEPTION 'GROUP_ROUND_COUNT_MISMATCH:%:%', v_group.team_count, v_round_count;
    END IF;

    SELECT count(*)::integer
      INTO v_round_conflicts
    FROM (
      SELECT round, team_id
      FROM (
        SELECT round, team_a_id AS team_id
        FROM public.matches
        WHERE event_id = v_event_id AND group_id = v_group.id AND deleted_at IS NULL
        UNION ALL
        SELECT round, team_b_id AS team_id
        FROM public.matches
        WHERE event_id = v_event_id AND group_id = v_group.id AND deleted_at IS NULL
      ) appearances
      GROUP BY round, team_id
      HAVING count(*) > 1
    ) conflicts;

    IF v_round_conflicts > 0 THEN
      RAISE EXCEPTION 'GROUP_SAME_ROUND_CONFLICT:%', v_group.id;
    END IF;

    SELECT count(*)::integer
      INTO v_duplicate_pairs
    FROM (
      SELECT LEAST(team_a_id, team_b_id), GREATEST(team_a_id, team_b_id)
      FROM public.matches
      WHERE event_id = v_event_id
        AND group_id = v_group.id
        AND deleted_at IS NULL
      GROUP BY LEAST(team_a_id, team_b_id), GREATEST(team_a_id, team_b_id)
      HAVING count(*) > 1
    ) duplicates;

    IF v_duplicate_pairs > 0 THEN
      RAISE EXCEPTION 'GROUP_DUPLICATE_PAIR:%', v_group.id;
    END IF;

    IF v_group.team_count = 5 THEN
      WITH ordered AS (
        SELECT
          row_number() OVER (ORDER BY display_order) AS sequence_no,
          team_a_id,
          team_b_id
        FROM public.matches
        WHERE event_id = v_event_id
          AND group_id = v_group.id
          AND deleted_at IS NULL
      )
      SELECT count(*)::integer
        INTO v_adjacent_conflicts
      FROM ordered current_match
      JOIN ordered next_match ON next_match.sequence_no = current_match.sequence_no + 1
      WHERE current_match.team_a_id IN (next_match.team_a_id, next_match.team_b_id)
         OR current_match.team_b_id IN (next_match.team_a_id, next_match.team_b_id);

      IF v_adjacent_conflicts > 0 THEN
        RAISE EXCEPTION 'FIVE_TEAM_REST_ORDER_CONFLICTS:%', v_adjacent_conflicts;
      END IF;
    END IF;
  END LOOP;

  IF v_group_count <> 2 THEN
    RAISE EXCEPTION 'GROUP_COUNT_MISMATCH:%', v_group_count;
  END IF;
END;
$$;

ROLLBACK;
