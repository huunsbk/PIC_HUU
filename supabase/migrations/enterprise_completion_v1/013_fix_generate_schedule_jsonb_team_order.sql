-- Prompt 13 hotfix: keep group team order from jsonb safely in generate_schedule_v1.
BEGIN;

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
  v_round integer;
  v_team_count integer;
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

  CREATE TEMP TABLE IF NOT EXISTS p12_schedule_candidates (
    group_order integer,
    group_id text,
    round_no integer,
    match_in_round integer,
    team_a_id text,
    team_b_id text
  ) ON COMMIT DROP;
  TRUNCATE p12_schedule_candidates;

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
    CREATE TEMP TABLE IF NOT EXISTS p12_group_teams (
      pos integer,
      team_id text
    ) ON COMMIT DROP;
    TRUNCATE p12_group_teams;

    INSERT INTO p12_group_teams(pos, team_id)
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

    SELECT count(*)::integer INTO v_team_count FROM p12_group_teams;

    IF v_team_count = 4 THEN
      INSERT INTO p12_schedule_candidates(group_order, group_id, round_no, match_in_round, team_a_id, team_b_id)
      SELECT v_group.group_order, v_group.id, pair.round_no, pair.match_in_round, a.team_id, b.team_id
      FROM (
        VALUES
          (1, 1, 1, 2),
          (1, 2, 3, 4),
          (2, 1, 1, 3),
          (2, 2, 2, 4),
          (3, 1, 1, 4),
          (3, 2, 2, 3)
      ) AS pair(round_no, match_in_round, pos_a, pos_b)
      JOIN p12_group_teams a ON a.pos = pair.pos_a
      JOIN p12_group_teams b ON b.pos = pair.pos_b;
    ELSE
      v_round := 1;
      FOR v_candidate IN
        SELECT a.team_id AS team_a_id, b.team_id AS team_b_id
        FROM p12_group_teams a
        JOIN p12_group_teams b ON b.pos > a.pos
        ORDER BY a.pos, b.pos
      LOOP
        INSERT INTO p12_schedule_candidates(group_order, group_id, round_no, match_in_round, team_a_id, team_b_id)
        VALUES (v_group.group_order, v_group.id, v_round, 1, v_candidate.team_a_id, v_candidate.team_b_id);
        v_round := v_round + 1;
      END LOOP;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM p12_schedule_candidates) THEN
    INSERT INTO p12_schedule_candidates(group_order, group_id, round_no, match_in_round, team_a_id, team_b_id)
    SELECT
      1,
      'round-robin-' || p_event_id,
      (b.rn - a.rn)::integer,
      row_number() OVER (PARTITION BY b.rn - a.rn ORDER BY a.rn)::integer,
      a.id,
      b.id
    FROM (
      SELECT id, row_number() OVER (ORDER BY lower(name), id)::integer AS rn
      FROM public.teams
      WHERE event_id = p_event_id
        AND tenant_id = v_tenant_id
        AND deleted_at IS NULL
    ) a
    JOIN (
      SELECT id, row_number() OVER (ORDER BY lower(name), id)::integer AS rn
      FROM public.teams
      WHERE event_id = p_event_id
        AND tenant_id = v_tenant_id
        AND deleted_at IS NULL
    ) b ON b.rn > a.rn;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS p12_slot_teams (
    slot_number integer,
    team_id text
  ) ON COMMIT DROP;
  TRUNCATE p12_slot_teams;

  FOR v_candidate IN
    SELECT *
    FROM p12_schedule_candidates
    ORDER BY round_no, match_in_round, group_order, team_a_id, team_b_id
  LOOP
    IF EXISTS (
      SELECT 1
      FROM p12_slot_teams
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
        'scheduling_mode', 'round_robin_balanced',
        'round_robin_round', v_candidate.round_no,
        'round_match_index', v_candidate.match_in_round
      ),
      p_event_id,
      v_tenant_id,
      v_tournament_id
    );

    v_created := v_created + 1;
    v_display := v_display + 1;

    INSERT INTO p12_slot_teams(slot_number, team_id)
    VALUES (v_slot, v_candidate.team_a_id), (v_slot, v_candidate.team_b_id);

    v_court := v_court + 1;
    IF v_court > v_court_count THEN
      v_court := 1;
      v_slot := v_slot + 1;
    END IF;
  END LOOP;

  UPDATE public.events
  SET schedule_config = jsonb_build_object(
        'court_count', v_court_count,
        'scheduling_mode', 'round_robin_balanced'
      ),
      ranking_config = jsonb_set(
        COALESCE(ranking_config, '{}'::jsonb),
        '{schedule_config}',
        jsonb_build_object('court_count', v_court_count, 'scheduling_mode', 'round_robin_balanced'),
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
      'scheduling_mode', 'round_robin_balanced'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'format_type', v_format,
    'created_matches', v_created,
    'soft_deleted_pending_matches', v_soft_deleted,
    'court_count', v_court_count,
    'scheduling_mode', 'round_robin_balanced'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_schedule_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_schedule_v1(text) TO authenticated;

COMMIT;
