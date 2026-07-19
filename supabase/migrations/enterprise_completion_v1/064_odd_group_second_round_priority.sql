-- Move the unpaired final seed into round two for odd-sized groups.
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
  v_seeded text[] := COALESCE(p_team_ids, ARRAY[]::text[]);
  v_initial_rotation text[];
  v_rotation text[];
  v_round_a text[];
  v_round_b text[];
  v_used boolean[];
  v_actual_count integer;
  v_size integer;
  v_output_round integer;
  v_raw_round integer;
  v_pair integer;
  v_position integer;
  v_selected integer;
  v_emitted integer;
  v_left text;
  v_right text;
  v_last text;
  v_desired_opponent text;
  v_previous_a text;
  v_previous_b text;
  v_found boolean;
BEGIN
  v_actual_count := cardinality(v_seeded);

  IF v_actual_count < 2 THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_seeded) AS team_id
    WHERE team_id IS NULL OR btrim(team_id) = ''
  ) THEN
    RAISE EXCEPTION 'Round-robin team ids must be non-empty';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_seeded) AS team_id
    GROUP BY team_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Round-robin team ids must be unique';
  END IF;

  IF mod(v_actual_count, 2) = 1 THEN
    v_seeded := array_append(v_seeded, NULL::text);
  END IF;

  v_size := cardinality(v_seeded);
  v_initial_rotation := array_fill(NULL::text, ARRAY[v_size]);

  -- Round one is 1-2, 3-4, 5-6...; the final odd seed receives the BYE.
  FOR v_pair IN 1..(v_size / 2)
  LOOP
    v_initial_rotation[v_pair] := v_seeded[(v_pair * 2) - 1];
    v_initial_rotation[v_size - v_pair + 1] := v_seeded[v_pair * 2];
  END LOOP;

  FOR v_output_round IN 1..(v_size - 1)
  LOOP
    IF mod(v_actual_count, 2) = 1 THEN
      -- Odd groups: 1-2 first, final seed-1 second, then 1-3, 1-4...
      IF v_output_round = 1 THEN
        v_desired_opponent := p_team_ids[2];
      ELSIF v_output_round = 2 THEN
        v_desired_opponent := p_team_ids[v_actual_count];
      ELSIF v_output_round < v_actual_count THEN
        v_desired_opponent := p_team_ids[v_output_round];
      ELSE
        v_desired_opponent := NULL;
      END IF;
    ELSIF v_output_round <= v_actual_count - 1 THEN
      v_desired_opponent := p_team_ids[v_output_round + 1];
    ELSE
      v_desired_opponent := NULL;
    END IF;

    v_rotation := v_initial_rotation;
    v_found := false;

    FOR v_raw_round IN 1..(v_size - 1)
    LOOP
      v_right := v_rotation[v_size];

      IF (v_desired_opponent IS NULL AND v_right IS NULL)
        OR v_right = v_desired_opponent
      THEN
        v_found := true;
        EXIT;
      END IF;

      v_last := v_rotation[v_size];
      v_position := v_size;
      WHILE v_position > 2
      LOOP
        v_rotation[v_position] := v_rotation[v_position - 1];
        v_position := v_position - 1;
      END LOOP;
      v_rotation[2] := v_last;
    END LOOP;

    IF NOT v_found THEN
      RAISE EXCEPTION 'Unable to find seeded round-robin round %', v_output_round;
    END IF;

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

    v_used := array_fill(false, ARRAY[cardinality(v_round_a)]);
    v_emitted := 0;

    WHILE v_emitted < cardinality(v_round_a)
    LOOP
      v_selected := NULL;

      -- For odd groups, expose the two requested round-two pairs first.
      IF mod(v_actual_count, 2) = 1 AND v_output_round = 2 THEN
        FOR v_pair IN 1..cardinality(v_round_a)
        LOOP
          IF NOT COALESCE(v_used[v_pair], false)
            AND (
              (
                v_emitted = 0
                AND p_team_ids[1] IN (v_round_a[v_pair], v_round_b[v_pair])
                AND p_team_ids[v_actual_count] IN (v_round_a[v_pair], v_round_b[v_pair])
              )
              OR (
                v_emitted = 1
                AND v_actual_count >= 5
                AND p_team_ids[2] IN (v_round_a[v_pair], v_round_b[v_pair])
                AND p_team_ids[4] IN (v_round_a[v_pair], v_round_b[v_pair])
              )
            )
          THEN
            v_selected := v_pair;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF v_selected IS NULL THEN
        FOR v_pair IN 1..cardinality(v_round_a)
        LOOP
          IF NOT COALESCE(v_used[v_pair], false)
            AND (
              v_output_round = 1
              OR v_previous_a IS NULL
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
      END IF;

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
        RAISE EXCEPTION 'Unable to order seeded round-robin round %', v_output_round;
      END IF;

      v_used[v_selected] := true;
      v_emitted := v_emitted + 1;
      v_previous_a := v_round_a[v_selected];
      v_previous_b := v_round_b[v_selected];

      round_no := v_output_round;
      match_in_round := v_emitted;
      team_a_id := v_previous_a;
      team_b_id := v_previous_b;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.build_round_robin_pairs_v1(text[]) IS
  'Builds seeded Circle Method rounds; odd groups prioritize final seed-1 and seed 2-4 in round two.';

REVOKE ALL ON FUNCTION public.build_round_robin_pairs_v1(text[]) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_team_count integer;
  v_match_count integer;
  v_round_count integer;
  v_duplicate_pairs integer;
  v_round_conflicts integer;
  v_pair_one_valid boolean;
  v_pair_two_valid boolean;
BEGIN
  FOREACH v_team_count IN ARRAY ARRAY[3, 5, 7, 9, 95]
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

    IF v_match_count <> (v_team_count * (v_team_count - 1)) / 2
      OR v_round_count <> v_team_count
    THEN
      RAISE EXCEPTION 'Odd seeded round-robin count mismatch for % teams', v_team_count;
    END IF;

    SELECT
      LEAST(team_a_id, team_b_id) = 'team-1'
        AND GREATEST(team_a_id, team_b_id) = 'team-' || v_team_count::text
      INTO v_pair_one_valid
    FROM public.build_round_robin_pairs_v1(
      ARRAY(SELECT 'team-' || n::text FROM generate_series(1, v_team_count) AS n)
    )
    WHERE round_no = 2 AND match_in_round = 1;

    IF NOT COALESCE(v_pair_one_valid, false) THEN
      RAISE EXCEPTION 'Odd seeded round-two final seed priority failed for % teams', v_team_count;
    END IF;

    IF v_team_count >= 5 THEN
      SELECT
        LEAST(team_a_id, team_b_id) = 'team-2'
          AND GREATEST(team_a_id, team_b_id) = 'team-4'
        INTO v_pair_two_valid
      FROM public.build_round_robin_pairs_v1(
        ARRAY(SELECT 'team-' || n::text FROM generate_series(1, v_team_count) AS n)
      )
      WHERE round_no = 2 AND match_in_round = 2;

      IF NOT COALESCE(v_pair_two_valid, false) THEN
        RAISE EXCEPTION 'Odd seeded round-two 2-4 priority failed for % teams', v_team_count;
      END IF;
    END IF;

    WITH pairs AS (
      SELECT *
      FROM public.build_round_robin_pairs_v1(
        ARRAY(SELECT 'team-' || n::text FROM generate_series(1, v_team_count) AS n)
      )
    )
    SELECT count(*)::integer
      INTO v_duplicate_pairs
    FROM (
      SELECT LEAST(team_a_id, team_b_id), GREATEST(team_a_id, team_b_id)
      FROM pairs
      GROUP BY LEAST(team_a_id, team_b_id), GREATEST(team_a_id, team_b_id)
      HAVING count(*) > 1
    ) duplicates;

    WITH pairs AS (
      SELECT *
      FROM public.build_round_robin_pairs_v1(
        ARRAY(SELECT 'team-' || n::text FROM generate_series(1, v_team_count) AS n)
      )
    ), appearances AS (
      SELECT round_no, team_a_id AS team_id FROM pairs
      UNION ALL
      SELECT round_no, team_b_id AS team_id FROM pairs
    )
    SELECT count(*)::integer
      INTO v_round_conflicts
    FROM (
      SELECT round_no, team_id
      FROM appearances
      GROUP BY round_no, team_id
      HAVING count(*) > 1
    ) conflicts;

    IF v_duplicate_pairs > 0 OR v_round_conflicts > 0 THEN
      RAISE EXCEPTION 'Odd seeded round-robin invariant failed for % teams', v_team_count;
    END IF;
  END LOOP;

  FOREACH v_team_count IN ARRAY ARRAY[4, 6, 48, 96]
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM public.build_round_robin_pairs_v1(
        ARRAY(SELECT 'team-' || n::text FROM generate_series(1, v_team_count) AS n)
      )
      WHERE round_no = 2
        AND LEAST(team_a_id, team_b_id) = 'team-1'
        AND GREATEST(team_a_id, team_b_id) = 'team-3'
    ) INTO v_pair_one_valid;

    IF NOT v_pair_one_valid THEN
      RAISE EXCEPTION 'Even seeded round-two priority changed for % teams', v_team_count;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
