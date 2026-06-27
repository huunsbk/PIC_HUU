-- Knockout manual placeholder builder.
-- Saves a bracket made only from placeholders. Real teams and scores are handled outside this screen.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_manual_knockout_bracket_v1(
  p_event_id text,
  p_bracket_size integer,
  p_slots jsonb
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
  v_round_count integer;
  v_expected_slots integer;
  v_slot_count integer;
  v_round integer;
  v_match_index integer;
  v_matches_in_round integer;
  v_match_id text;
  v_next_match_id text;
  v_next_slot text;
  v_round_name text;
  v_knockout_match_id text;
  v_prev_a_match text;
  v_prev_b_match text;
  v_prev_a_ko text;
  v_prev_b_ko text;
  v_placeholder_a text;
  v_placeholder_b text;
  v_created integer := 0;
BEGIN
  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_matches', 'save_manual_knockout_bracket_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_tournament_id := v_ctx->>'tournament_id';

  IF p_bracket_size NOT IN (4, 8, 16, 32) THEN
    RAISE EXCEPTION 'p_bracket_size must be one of 4, 8, 16, 32';
  END IF;

  IF p_slots IS NULL OR jsonb_typeof(p_slots) <> 'array' THEN
    RAISE EXCEPTION 'p_slots must be a JSON array';
  END IF;

  v_expected_slots := p_bracket_size / 2;
  SELECT count(*)::integer INTO v_slot_count FROM jsonb_array_elements(p_slots);

  IF v_slot_count <> v_expected_slots THEN
    RAISE EXCEPTION 'Manual bracket requires exactly % first-round matches', v_expected_slots;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS p19_slots (
    match_index integer PRIMARY KEY,
    placeholder_a text NOT NULL,
    placeholder_b text NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE p19_slots;

  INSERT INTO p19_slots(match_index, placeholder_a, placeholder_b)
  SELECT
    COALESCE((slot_item.value->>'match_index')::integer, slot_item.ordinality::integer),
    btrim(COALESCE(slot_item.value->>'placeholder_a', '')),
    btrim(COALESCE(slot_item.value->>'placeholder_b', ''))
  FROM jsonb_array_elements(p_slots) WITH ORDINALITY AS slot_item(value, ordinality);

  IF EXISTS (
    SELECT 1
    FROM p19_slots
    WHERE match_index < 1
       OR match_index > v_expected_slots
       OR placeholder_a = ''
       OR placeholder_b = ''
  ) THEN
    RAISE EXCEPTION 'Invalid or empty manual knockout placeholder';
  END IF;

  IF (SELECT count(*) FROM p19_slots) <> v_expected_slots THEN
    RAISE EXCEPTION 'Duplicate manual knockout match_index';
  END IF;

  UPDATE public.match_sets ms
  SET deleted_at = now(),
      updated_at = now()
  FROM public.matches m
  WHERE ms.match_id = m.id
    AND m.event_id = p_event_id
    AND m.tenant_id = v_tenant_id
    AND m.group_id = 'knockout'
    AND m.deleted_at IS NULL
    AND ms.deleted_at IS NULL;

  UPDATE public.matches
  SET deleted_at = now()
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND group_id = 'knockout'
    AND deleted_at IS NULL;

  UPDATE public.event_knockout_selections
  SET deleted_at = now(),
      updated_at = now()
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  v_round_count := CASE p_bracket_size WHEN 4 THEN 2 WHEN 8 THEN 3 WHEN 16 THEN 4 WHEN 32 THEN 5 END;

  CREATE TEMP TABLE IF NOT EXISTS p19_bracket_matches (
    round_no integer,
    match_index integer,
    match_id text,
    knockout_match_id text
  ) ON COMMIT DROP;
  TRUNCATE p19_bracket_matches;

  FOR v_round IN 1..v_round_count LOOP
    v_matches_in_round := (p_bracket_size / (2 ^ v_round))::integer;
    FOR v_match_index IN 1..v_matches_in_round LOOP
      v_round_name := CASE
        WHEN v_round = v_round_count THEN 'Chung Kết'
        WHEN v_round = v_round_count - 1 THEN 'Bán Kết'
        WHEN v_round = v_round_count - 2 THEN 'Tứ Kết'
        WHEN p_bracket_size = 16 AND v_round = 1 THEN 'Vòng 16 Đội'
        WHEN p_bracket_size = 32 AND v_round = 1 THEN 'Vòng 32 Đội'
        WHEN p_bracket_size = 32 AND v_round = 2 THEN 'Vòng 16 Đội'
        ELSE 'Vòng Knockout'
      END;
      v_knockout_match_id := CASE
        WHEN v_round_name = 'Chung Kết' THEN 'F'
        WHEN v_round_name = 'Bán Kết' THEN 'SF' || v_match_index
        WHEN v_round_name = 'Tứ Kết' THEN 'QF' || v_match_index
        WHEN v_round_name = 'Vòng 16 Đội' THEN 'R16' || v_match_index
        WHEN v_round_name = 'Vòng 32 Đội' THEN 'R32' || v_match_index
        ELSE 'KO' || v_round || '-' || v_match_index
      END;

      INSERT INTO p19_bracket_matches(round_no, match_index, match_id, knockout_match_id)
      VALUES (v_round, v_match_index, 'match-' || gen_random_uuid()::text, v_knockout_match_id);
    END LOOP;
  END LOOP;

  FOR v_round IN REVERSE v_round_count..1 LOOP
    v_matches_in_round := (p_bracket_size / (2 ^ v_round))::integer;
    v_round_name := CASE
      WHEN v_round = v_round_count THEN 'Chung Kết'
      WHEN v_round = v_round_count - 1 THEN 'Bán Kết'
      WHEN v_round = v_round_count - 2 THEN 'Tứ Kết'
      WHEN p_bracket_size = 16 AND v_round = 1 THEN 'Vòng 16 Đội'
      WHEN p_bracket_size = 32 AND v_round = 1 THEN 'Vòng 32 Đội'
      WHEN p_bracket_size = 32 AND v_round = 2 THEN 'Vòng 16 Đội'
      ELSE 'Vòng Knockout'
    END;

    FOR v_match_index IN 1..v_matches_in_round LOOP
      SELECT bm.match_id, bm.knockout_match_id
      INTO v_match_id, v_knockout_match_id
      FROM p19_bracket_matches bm
      WHERE bm.round_no = v_round
        AND bm.match_index = v_match_index;

      IF v_round < v_round_count THEN
        SELECT bm.match_id
        INTO v_next_match_id
        FROM p19_bracket_matches bm
        WHERE bm.round_no = v_round + 1
          AND bm.match_index = ceil(v_match_index / 2.0)::integer;
        v_next_slot := CASE WHEN v_match_index % 2 = 1 THEN 'A' ELSE 'B' END;
      ELSE
        v_next_match_id := NULL;
        v_next_slot := NULL;
      END IF;

      IF v_round = 1 THEN
        SELECT s.placeholder_a, s.placeholder_b
        INTO v_placeholder_a, v_placeholder_b
        FROM p19_slots s
        WHERE s.match_index = v_match_index;
        v_prev_a_match := NULL;
        v_prev_b_match := NULL;
        v_prev_a_ko := NULL;
        v_prev_b_ko := NULL;
      ELSE
        SELECT bm.match_id, bm.knockout_match_id
        INTO v_prev_a_match, v_prev_a_ko
        FROM p19_bracket_matches bm
        WHERE bm.round_no = v_round - 1
          AND bm.match_index = (v_match_index * 2 - 1);

        SELECT bm.match_id, bm.knockout_match_id
        INTO v_prev_b_match, v_prev_b_ko
        FROM p19_bracket_matches bm
        WHERE bm.round_no = v_round - 1
          AND bm.match_index = (v_match_index * 2);

        v_placeholder_a := 'Thắng ' || public.p12_short_ko_label_v1(v_prev_a_ko);
        v_placeholder_b := 'Thắng ' || public.p12_short_ko_label_v1(v_prev_b_ko);
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
        display_order,
        metadata,
        event_id,
        tenant_id,
        tournament_id
      )
      VALUES (
        v_match_id,
        'knockout',
        NULL,
        NULL,
        v_placeholder_a,
        v_placeholder_b,
        NULL,
        NULL,
        NULL,
        'pending',
        v_round,
        v_round_name,
        v_knockout_match_id,
        v_next_match_id,
        v_next_slot,
        10000 + v_created + 1,
        jsonb_build_object(
          'bracket_mode', 'manual_placeholder',
          'slot_source', 'manual_placeholder',
          'seed_label_a', v_placeholder_a,
          'seed_label_b', v_placeholder_b,
          'seed_source_a', CASE WHEN v_round = 1 THEN jsonb_build_object('source_type', 'manual_placeholder') ELSE jsonb_build_object('source_type', 'winner_of_match', 'winner_of_match_id', v_prev_a_match) END,
          'seed_source_b', CASE WHEN v_round = 1 THEN jsonb_build_object('source_type', 'manual_placeholder') ELSE jsonb_build_object('source_type', 'winner_of_match', 'winner_of_match_id', v_prev_b_match) END
        ),
        p_event_id,
        v_tenant_id,
        v_tournament_id
      );

      v_created := v_created + 1;
    END LOOP;
  END LOOP;

  PERFORM public.log_audit_event_v1(
    'SAVE_MANUAL_KNOCKOUT_BRACKET',
    'event',
    p_event_id,
    jsonb_build_object('bracket_size', p_bracket_size, 'slot_count', v_slot_count, 'created_matches', v_created)
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'bracket_size', p_bracket_size,
    'slot_count', v_slot_count,
    'created_matches', v_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_manual_knockout_bracket_v1(text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_manual_knockout_bracket_v1(text, integer, jsonb) TO authenticated;

COMMIT;
