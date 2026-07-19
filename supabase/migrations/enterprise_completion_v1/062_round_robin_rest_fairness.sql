-- Generate fair round-robin rounds for every supported group size.
BEGIN;

CREATE OR REPLACE FUNCTION public.build_round_robin_pairs_v1(p_team_ids text[])
RETURNS TABLE (
  round_no integer,
  match_in_round integer,
  team_a_id text,
  team_b_id text
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_rotation text[] := COALESCE(p_team_ids, ARRAY[]::text[]);
  v_round_a text[];
  v_round_b text[];
  v_used boolean[];
  v_size integer;
  v_round integer;
  v_pair integer;
  v_position integer;
  v_selected integer;
  v_emitted integer;
  v_left text;
  v_right text;
  v_last text;
  v_previous_a text;
  v_previous_b text;
BEGIN
  IF cardinality(v_rotation) < 2 THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_rotation) AS team_id
    WHERE team_id IS NULL OR btrim(team_id) = ''
  ) THEN
    RAISE EXCEPTION 'Round-robin team ids must be non-empty';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_rotation) AS team_id
    GROUP BY team_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Round-robin team ids must be unique';
  END IF;

  -- A NULL slot is an internal BYE and never becomes a match.
  IF mod(cardinality(v_rotation), 2) = 1 THEN
    v_rotation := array_append(v_rotation, NULL::text);
  END IF;

  v_size := cardinality(v_rotation);

  FOR v_round IN 1..(v_size - 1)
  LOOP
    v_round_a := ARRAY[]::text[];
    v_round_b := ARRAY[]::text[];

    FOR v_pair IN 1..(v_size / 2)
    LOOP
      v_left := v_rotation[v_pair];
      v_right := v_rotation[v_size - v_pair + 1];

      IF v_left IS NOT NULL AND v_right IS NOT NULL THEN
        v_round_a := array_append(v_round_a, v_left);
        v_round_b := array_append(v_round_b, v_right);
      END IF;
    END LOOP;

    -- Within a round all pairs are disjoint. At each round boundary, choose
    -- a first pair that does not reuse either team from the previous match
    -- whenever such a pair exists.
    v_used := array_fill(false, ARRAY[cardinality(v_round_a)]);
    v_emitted := 0;

    WHILE v_emitted < cardinality(v_round_a)
    LOOP
      v_selected := NULL;

      FOR v_pair IN 1..cardinality(v_round_a)
      LOOP
        IF NOT COALESCE(v_used[v_pair], false)
          AND (
            v_previous_a IS NULL
            OR (
              v_round_a[v_pair] <> v_previous_a
              AND v_round_a[v_pair] <> v_previous_b
              AND v_round_b[v_pair] <> v_previous_a
              AND v_round_b[v_pair] <> v_previous_b
            )
          )
        THEN
          v_selected := v_pair;
          EXIT;
        END IF;
      END LOOP;

      IF v_selected IS NULL THEN
        FOR v_pair IN 1..cardinality(v_round_a)
        LOOP
          IF NOT COALESCE(v_used[v_pair], false) THEN
            v_selected := v_pair;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF v_selected IS NULL THEN
        RAISE EXCEPTION 'Unable to order round-robin round %', v_round;
      END IF;

      v_used[v_selected] := true;
      v_emitted := v_emitted + 1;
      v_previous_a := v_round_a[v_selected];
      v_previous_b := v_round_b[v_selected];

      round_no := v_round;
      match_in_round := v_emitted;
      team_a_id := v_previous_a;
      team_b_id := v_previous_b;
      RETURN NEXT;
    END LOOP;

    -- Circle Method: keep the first team fixed and rotate all other slots.
    v_last := v_rotation[v_size];
    v_position := v_size;
    WHILE v_position > 2
    LOOP
      v_rotation[v_position] := v_rotation[v_position - 1];
      v_position := v_position - 1;
    END LOOP;
    v_rotation[2] := v_last;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.build_round_robin_pairs_v1(text[]) IS
  'Builds deterministic Berger/Circle Method rounds, including BYE handling for odd team counts.';

REVOKE ALL ON FUNCTION public.build_round_robin_pairs_v1(text[]) FROM PUBLIC, anon, authenticated;

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
  v_schedule_config jsonb;
  v_court_count integer;
  v_finished_matches integer;
  v_soft_deleted integer := 0;
  v_created integer := 0;
  v_group record;
  v_team_count integer;
  v_team_ids text[];
  v_slot integer := 1;
  v_court integer := 1;
  v_display integer := 1;
  v_candidate record;
BEGIN
  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_matches', 'generate_schedule_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_tournament_id := v_ctx->>'tournament_id';
  v_format := COALESCE(v_ctx->>'format_type', 'group_then_knockout');

  SELECT COALESCE(NULLIF(e.schedule_config, '{}'::jsonb), e.ranking_config->'schedule_config', '{}'::jsonb)
    INTO v_schedule_config
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.tenant_id = v_tenant_id
    AND e.deleted_at IS NULL;

  v_court_count := GREATEST(1, COALESCE((v_schedule_config->>'court_count')::integer, 1));

  SELECT count(*)::integer
    INTO v_finished_matches
  FROM public.matches
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
    AND COALESCE(group_id, '') <> 'knockout'
    AND status = 'finished';

  IF v_finished_matches > 0 THEN
    RAISE EXCEPTION 'Schedule already has finished scores; confirm reset before regenerating';
  END IF;

  UPDATE public.matches
  SET deleted_at = now()
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL
    AND COALESCE(group_id, '') <> 'knockout';
  GET DIAGNOSTICS v_soft_deleted = ROW_COUNT;

  IF v_format = 'knockout_only' THEN
    PERFORM public.log_audit_event_v1('GENERATE_SCHEDULE', 'event', p_event_id, jsonb_build_object('format_type', v_format, 'created_matches', 0));
    RETURN jsonb_build_object('success', true, 'event_id', p_event_id, 'format_type', v_format, 'created_matches', 0);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS p62_schedule_candidates (
    group_order integer,
    group_id text,
    round_no integer,
    match_in_round integer,
    team_a_id text,
    team_b_id text
  ) ON COMMIT DROP;
  TRUNCATE p62_schedule_candidates;

  FOR v_group IN
    SELECT
      g.id,
      g.name,
      row_number() OVER (ORDER BY g.name, g.id)::integer AS group_order
    FROM public.groups g
    WHERE g.event_id = p_event_id
      AND g.tenant_id = v_tenant_id
      AND g.deleted_at IS NULL
    ORDER BY g.name, g.id
  LOOP
    CREATE TEMP TABLE IF NOT EXISTS p62_group_teams (
      pos integer,
      team_id text
    ) ON COMMIT DROP;
    TRUNCATE p62_group_teams;

    INSERT INTO p62_group_teams(pos, team_id)
    SELECT
      row_number() OVER (
        ORDER BY
          COALESCE((
            SELECT jt.ord::integer
            FROM jsonb_array_elements_text(
              CASE
                WHEN jsonb_typeof(COALESCE(g.team_ids, '[]'::jsonb)) = 'array'
                  THEN COALESCE(g.team_ids, '[]'::jsonb)
                ELSE '[]'::jsonb
              END
            ) WITH ORDINALITY AS jt(team_id, ord)
            WHERE jt.team_id = t.id
            LIMIT 1
          ), 2147483647),
          lower(t.name),
          t.id
      )::integer,
      t.id
    FROM public.teams t
    JOIN public.groups g ON g.id = v_group.id
    WHERE t.event_id = p_event_id
      AND t.tenant_id = v_tenant_id
      AND t.deleted_at IS NULL
      AND t.group_id = v_group.id;

    SELECT count(*)::integer, array_agg(team_id ORDER BY pos)
      INTO v_team_count, v_team_ids
    FROM p62_group_teams;

    IF v_team_count >= 2 THEN
      INSERT INTO p62_schedule_candidates(group_order, group_id, round_no, match_in_round, team_a_id, team_b_id)
      SELECT
        v_group.group_order,
        v_group.id,
        pair.round_no,
        pair.match_in_round,
        pair.team_a_id,
        pair.team_b_id
      FROM public.build_round_robin_pairs_v1(v_team_ids) AS pair;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM p62_schedule_candidates) THEN
    SELECT array_agg(id ORDER BY lower(name), id)
      INTO v_team_ids
    FROM public.teams
    WHERE event_id = p_event_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL;

    IF cardinality(COALESCE(v_team_ids, ARRAY[]::text[])) >= 2 THEN
      INSERT INTO p62_schedule_candidates(group_order, group_id, round_no, match_in_round, team_a_id, team_b_id)
      SELECT
        1,
        'round-robin-' || p_event_id,
        pair.round_no,
        pair.match_in_round,
        pair.team_a_id,
        pair.team_b_id
      FROM public.build_round_robin_pairs_v1(v_team_ids) AS pair;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT group_id, round_no, team_a_id AS team_id FROM p62_schedule_candidates
      UNION ALL
      SELECT group_id, round_no, team_b_id AS team_id FROM p62_schedule_candidates
    ) AS round_teams
    GROUP BY group_id, round_no, team_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Generated schedule contains a team more than once in the same round';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM p62_schedule_candidates
    GROUP BY group_id, LEAST(team_a_id, team_b_id), GREATEST(team_a_id, team_b_id)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Generated schedule contains duplicate team pairs';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS p62_slot_teams (
    slot_number integer,
    team_id text
  ) ON COMMIT DROP;
  TRUNCATE p62_slot_teams;

  FOR v_candidate IN
    SELECT *
    FROM p62_schedule_candidates
    ORDER BY round_no, match_in_round, group_order, team_a_id, team_b_id
  LOOP
    IF EXISTS (
      SELECT 1
      FROM p62_slot_teams
      WHERE slot_number = v_slot
        AND team_id IN (v_candidate.team_a_id, v_candidate.team_b_id)
    ) THEN
      v_slot := v_slot + 1;
      v_court := 1;
    END IF;

    INSERT INTO public.matches(
      id,
      group_id,
      team_a_id,
      team_b_id,
      score_a,
      score_b,
      winner_id,
      status,
      round,
      court_number,
      slot_number,
      display_order,
      metadata,
      event_id,
      tenant_id,
      tournament_id
    )
    VALUES (
      'match-' || gen_random_uuid()::text,
      v_candidate.group_id,
      v_candidate.team_a_id,
      v_candidate.team_b_id,
      NULL,
      NULL,
      NULL,
      'pending',
      v_candidate.round_no,
      v_court,
      v_slot,
      v_display,
      jsonb_build_object(
        'scheduling_mode', 'round_robin_circle_v1',
        'round_robin_round', v_candidate.round_no,
        'round_match_index', v_candidate.match_in_round
      ),
      p_event_id,
      v_tenant_id,
      v_tournament_id
    );

    v_created := v_created + 1;
    v_display := v_display + 1;

    INSERT INTO p62_slot_teams(slot_number, team_id)
    VALUES (v_slot, v_candidate.team_a_id), (v_slot, v_candidate.team_b_id);

    v_court := v_court + 1;
    IF v_court > v_court_count THEN
      v_court := 1;
      v_slot := v_slot + 1;
    END IF;
  END LOOP;

  UPDATE public.events
  SET schedule_config = COALESCE(schedule_config, '{}'::jsonb) || jsonb_build_object(
        'court_count', v_court_count,
        'scheduling_mode', 'round_robin_circle_v1'
      ),
      ranking_config = jsonb_set(
        COALESCE(ranking_config, '{}'::jsonb),
        '{schedule_config}',
        COALESCE(ranking_config->'schedule_config', '{}'::jsonb) || jsonb_build_object(
          'court_count', v_court_count,
          'scheduling_mode', 'round_robin_circle_v1'
        ),
        true
      )
  WHERE id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  PERFORM public.log_audit_event_v1(
    'GENERATE_SCHEDULE',
    'event',
    p_event_id,
    jsonb_build_object(
      'format_type', v_format,
      'created_matches', v_created,
      'soft_deleted_pending_matches', v_soft_deleted,
      'court_count', v_court_count,
      'scheduling_mode', 'round_robin_circle_v1'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'format_type', v_format,
    'created_matches', v_created,
    'soft_deleted_pending_matches', v_soft_deleted,
    'court_count', v_court_count,
    'scheduling_mode', 'round_robin_circle_v1'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_schedule_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_schedule_v1(text) TO authenticated;

-- Abort the migration if the core pairing invariants regress.
DO $$
DECLARE
  v_team_count integer;
  v_match_count integer;
  v_round_count integer;
  v_duplicate_pairs integer;
  v_round_conflicts integer;
  v_adjacent_conflicts integer;
BEGIN
  FOREACH v_team_count IN ARRAY ARRAY[4, 5, 6, 96]
  LOOP
    WITH pairs AS (
      SELECT *
      FROM public.build_round_robin_pairs_v1(
        ARRAY(SELECT 'team-' || n::text FROM generate_series(1, v_team_count) AS n)
      )
    )
    SELECT count(*), count(DISTINCT round_no)
      INTO v_match_count, v_round_count
    FROM pairs;

    IF v_match_count <> (v_team_count * (v_team_count - 1)) / 2 THEN
      RAISE EXCEPTION 'Round-robin self-test failed for % teams: % matches', v_team_count, v_match_count;
    END IF;

    IF v_round_count <> (CASE WHEN mod(v_team_count, 2) = 0 THEN v_team_count - 1 ELSE v_team_count END) THEN
      RAISE EXCEPTION 'Round-robin self-test failed for % teams: % rounds', v_team_count, v_round_count;
    END IF;

    WITH pairs AS (
      SELECT *
      FROM public.build_round_robin_pairs_v1(
        ARRAY(SELECT 'team-' || n::text FROM generate_series(1, v_team_count) AS n)
      )
    )
    SELECT count(*)
      INTO v_duplicate_pairs
    FROM (
      SELECT LEAST(team_a_id, team_b_id), GREATEST(team_a_id, team_b_id)
      FROM pairs
      GROUP BY LEAST(team_a_id, team_b_id), GREATEST(team_a_id, team_b_id)
      HAVING count(*) > 1
    ) AS duplicates;

    IF v_duplicate_pairs > 0 THEN
      RAISE EXCEPTION 'Round-robin self-test found duplicate pairs for % teams', v_team_count;
    END IF;

    WITH pairs AS (
      SELECT *
      FROM public.build_round_robin_pairs_v1(
        ARRAY(SELECT 'team-' || n::text FROM generate_series(1, v_team_count) AS n)
      )
    ), round_teams AS (
      SELECT round_no, team_a_id AS team_id FROM pairs
      UNION ALL
      SELECT round_no, team_b_id AS team_id FROM pairs
    )
    SELECT count(*)
      INTO v_round_conflicts
    FROM (
      SELECT round_no, team_id
      FROM round_teams
      GROUP BY round_no, team_id
      HAVING count(*) > 1
    ) AS conflicts;

    IF v_round_conflicts > 0 THEN
      RAISE EXCEPTION 'Round-robin self-test found same-round conflicts for % teams', v_team_count;
    END IF;
  END LOOP;

  WITH ordered AS (
    SELECT
      row_number() OVER (ORDER BY round_no, match_in_round) AS sequence_no,
      team_a_id,
      team_b_id
    FROM public.build_round_robin_pairs_v1(ARRAY['A', 'B', 'C', 'D', 'E'])
  )
  SELECT count(*)
    INTO v_adjacent_conflicts
  FROM ordered current_match
  JOIN ordered next_match ON next_match.sequence_no = current_match.sequence_no + 1
  WHERE current_match.team_a_id IN (next_match.team_a_id, next_match.team_b_id)
     OR current_match.team_b_id IN (next_match.team_a_id, next_match.team_b_id);

  IF v_adjacent_conflicts > 0 THEN
    RAISE EXCEPTION 'Round-robin self-test could not provide rest-safe order for five teams';
  END IF;
END;
$$;

COMMIT;
