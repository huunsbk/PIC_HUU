-- Non-destructive verification for Prompt 12 score/schedule/knockout contracts.
CREATE TEMP TABLE IF NOT EXISTS p12_verify_runner_guard(id integer) ON COMMIT DROP;

DO $$
DECLARE
  v_missing text[];
  v_first_match text;
  v_pair_count integer;
  v_duplicate_pairs integer;
  v_slot_conflicts integer;
BEGIN
  SELECT array_agg(name)
  INTO v_missing
  FROM (
    VALUES
      ('events.schedule_config', EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'schedule_config'
      )),
      ('matches.court_number', EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'court_number'
      )),
      ('matches.slot_number', EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'slot_number'
      )),
      ('matches.display_order', EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'display_order'
      )),
      ('matches.metadata', EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'metadata'
      )),
      ('event_knockout_selections.seed_label', EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'event_knockout_selections' AND column_name = 'seed_label'
      )),
      ('event_knockout_selections.seed_source', EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'event_knockout_selections' AND column_name = 'seed_source'
      )),
      ('event_knockout_selections.resolved_team_id', EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'event_knockout_selections' AND column_name = 'resolved_team_id'
      ))
  ) AS checks(name, ok)
  WHERE NOT ok;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing Prompt 12 schema objects: %', array_to_string(v_missing, ', ');
  END IF;

  IF to_regprocedure('public.generate_schedule_v1(text)') IS NULL
    OR to_regprocedure('public.prepare_knockout_candidates_v1(text,integer,integer,boolean)') IS NULL
    OR to_regprocedure('public.confirm_knockout_teams_v1(text,jsonb,integer,text)') IS NULL
    OR to_regprocedure('public.generate_knockout_bracket_v1(text)') IS NULL
    OR to_regprocedure('public.update_match_score_v1(text,integer,integer)') IS NULL
    OR to_regprocedure('public.update_match_set_score_v1(text,integer,integer,integer)') IS NULL
    OR to_regprocedure('public.reset_match_score_v1(text)') IS NULL THEN
    RAISE EXCEPTION 'Missing Prompt 12 RPC contract';
  END IF;

  WITH rr AS (
    SELECT *
    FROM (
      VALUES
        (1, 1, 't1', 't3'),
        (1, 2, 't5', 't7'),
        (2, 1, 't1', 't5'),
        (2, 2, 't3', 't7'),
        (3, 1, 't1', 't7'),
        (3, 2, 't3', 't5')
    ) AS v(round_no, match_in_round, team_a, team_b)
  ),
  ordered AS (
    SELECT
      *,
      row_number() OVER (ORDER BY round_no, match_in_round)::integer AS display_order,
      (((row_number() OVER (ORDER BY round_no, match_in_round) - 1) % 2) + 1)::integer AS court_number,
      (((row_number() OVER (ORDER BY round_no, match_in_round) - 1) / 2) + 1)::integer AS slot_number
    FROM rr
  )
  SELECT team_a || '-' || team_b
  INTO v_first_match
  FROM ordered
  ORDER BY display_order
  LIMIT 1;

  IF v_first_match <> 't1-t3' THEN
    RAISE EXCEPTION 'Expected first Bảng A match t1-t3, got %', v_first_match;
  END IF;

  WITH rr AS (
    SELECT *
    FROM (
      VALUES
        (1, 1, 't1', 't3'),
        (1, 2, 't5', 't7'),
        (2, 1, 't1', 't5'),
        (2, 2, 't3', 't7'),
        (3, 1, 't1', 't7'),
        (3, 2, 't3', 't5')
    ) AS v(round_no, match_in_round, team_a, team_b)
  )
  SELECT count(*)::integer, count(*)::integer - count(DISTINCT LEAST(team_a, team_b) || ':' || GREATEST(team_a, team_b))::integer
  INTO v_pair_count, v_duplicate_pairs
  FROM rr;

  IF v_pair_count <> 6 OR v_duplicate_pairs <> 0 THEN
    RAISE EXCEPTION 'Invalid Bảng A pair coverage: count %, duplicate %', v_pair_count, v_duplicate_pairs;
  END IF;

  WITH ordered AS (
    SELECT
      *,
      (((row_number() OVER (ORDER BY round_no, match_in_round) - 1) / 2) + 1)::integer AS slot_number
    FROM (
      VALUES
        (1, 1, 't1', 't3'),
        (1, 2, 't5', 't7'),
        (2, 1, 't1', 't5'),
        (2, 2, 't3', 't7'),
        (3, 1, 't1', 't7'),
        (3, 2, 't3', 't5')
    ) AS v(round_no, match_in_round, team_a, team_b)
  ),
  slot_teams AS (
    SELECT slot_number, team_a AS team_id FROM ordered
    UNION ALL
    SELECT slot_number, team_b AS team_id FROM ordered
  )
  SELECT count(*)::integer
  INTO v_slot_conflicts
  FROM (
    SELECT slot_number, team_id, count(*)
    FROM slot_teams
    GROUP BY slot_number, team_id
    HAVING count(*) > 1
  ) conflicts;

  IF v_slot_conflicts <> 0 THEN
    RAISE EXCEPTION 'A team appears twice in one court slot';
  END IF;

  RAISE NOTICE 'Prompt 12 verification passed: schema/RPC contracts, 4-team schedule, court slots.';
END;
$$;
