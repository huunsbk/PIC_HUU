-- Store manual knockout bracket slot sources separately from matches.
BEGIN;

CREATE TABLE IF NOT EXISTS public.knockout_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tournament_id text NOT NULL,
  event_id text NOT NULL,
  match_id text NOT NULL,
  slot_code text NOT NULL CHECK (slot_code IN ('A', 'B')),
  label text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('group_rank', 'best_third', 'manual', 'bye')),
  group_id text NULL,
  group_rank integer NULL,
  best_third_index integer NULL,
  resolved_team_id text NULL,
  resolved_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_knockout_slots_event_active
  ON public.knockout_slots(event_id, match_id, slot_code)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_knockout_slots_active_match_slot
  ON public.knockout_slots(event_id, match_id, slot_code)
  WHERE deleted_at IS NULL;

ALTER TABLE public.knockout_slots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'knockout_slots'
      AND policyname = 'knockout_slots_select_tenant_or_super'
  ) THEN
    CREATE POLICY knockout_slots_select_tenant_or_super
      ON public.knockout_slots
      FOR SELECT
      TO authenticated
      USING (
        deleted_at IS NULL
        AND (
          public.current_role_name() = 'SUPER_ADMIN'
          OR tenant_id = public.current_tenant_id()
        )
      );
  END IF;
END $$;

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
  v_slot_a jsonb;
  v_slot_b jsonb;
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

  CREATE TEMP TABLE IF NOT EXISTS p20_slots (
    match_index integer PRIMARY KEY,
    slot_a jsonb NOT NULL,
    slot_b jsonb NOT NULL,
    label_a text NOT NULL,
    label_b text NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE p20_slots;

  INSERT INTO p20_slots(match_index, slot_a, slot_b, label_a, label_b)
  SELECT
    COALESCE((slot_item.value->>'match_index')::integer, slot_item.ordinality::integer),
    slot_item.value->'slot_a',
    slot_item.value->'slot_b',
    btrim(COALESCE(slot_item.value->'slot_a'->>'label', '')),
    btrim(COALESCE(slot_item.value->'slot_b'->>'label', ''))
  FROM jsonb_array_elements(p_slots) WITH ORDINALITY AS slot_item(value, ordinality);

  IF EXISTS (
    SELECT 1
    FROM p20_slots
    WHERE match_index < 1
       OR match_index > v_expected_slots
       OR label_a = ''
       OR label_b = ''
       OR COALESCE(slot_a->>'source_type', '') NOT IN ('group_rank', 'best_third')
       OR COALESCE(slot_b->>'source_type', '') NOT IN ('group_rank', 'best_third')
  ) THEN
    RAISE EXCEPTION 'Invalid or empty manual knockout source slot';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM p20_slots s
    WHERE (s.slot_a->>'source_type' = 'group_rank' AND NOT EXISTS (
             SELECT 1 FROM public.groups g
             WHERE g.id = s.slot_a->>'group_id'
               AND g.event_id = p_event_id
               AND g.tenant_id = v_tenant_id
               AND g.deleted_at IS NULL
           ))
       OR (s.slot_b->>'source_type' = 'group_rank' AND NOT EXISTS (
             SELECT 1 FROM public.groups g
             WHERE g.id = s.slot_b->>'group_id'
               AND g.event_id = p_event_id
               AND g.tenant_id = v_tenant_id
               AND g.deleted_at IS NULL
           ))
       OR (s.slot_a->>'source_type' = 'best_third' AND COALESCE((s.slot_a->>'best_third_index')::integer, 0) < 1)
       OR (s.slot_b->>'source_type' = 'best_third' AND COALESCE((s.slot_b->>'best_third_index')::integer, 0) < 1)
  ) THEN
    RAISE EXCEPTION 'Invalid knockout slot source context';
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

  UPDATE public.knockout_slots
  SET deleted_at = now(),
      updated_at = now()
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

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

  CREATE TEMP TABLE IF NOT EXISTS p20_bracket_matches (
    round_no integer,
    match_index integer,
    match_id text,
    knockout_match_id text
  ) ON COMMIT DROP;
  TRUNCATE p20_bracket_matches;

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

      INSERT INTO p20_bracket_matches(round_no, match_index, match_id, knockout_match_id)
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
      FROM p20_bracket_matches bm
      WHERE bm.round_no = v_round
        AND bm.match_index = v_match_index;

      IF v_round < v_round_count THEN
        SELECT bm.match_id
        INTO v_next_match_id
        FROM p20_bracket_matches bm
        WHERE bm.round_no = v_round + 1
          AND bm.match_index = ceil(v_match_index / 2.0)::integer;
        v_next_slot := CASE WHEN v_match_index % 2 = 1 THEN 'A' ELSE 'B' END;
      ELSE
        v_next_match_id := NULL;
        v_next_slot := NULL;
      END IF;

      IF v_round = 1 THEN
        SELECT s.slot_a, s.slot_b, s.label_a, s.label_b
        INTO v_slot_a, v_slot_b, v_placeholder_a, v_placeholder_b
        FROM p20_slots s
        WHERE s.match_index = v_match_index;
        v_prev_a_match := NULL;
        v_prev_b_match := NULL;
        v_prev_a_ko := NULL;
        v_prev_b_ko := NULL;
      ELSE
        SELECT bm.match_id, bm.knockout_match_id
        INTO v_prev_a_match, v_prev_a_ko
        FROM p20_bracket_matches bm
        WHERE bm.round_no = v_round - 1
          AND bm.match_index = (v_match_index * 2 - 1);

        SELECT bm.match_id, bm.knockout_match_id
        INTO v_prev_b_match, v_prev_b_ko
        FROM p20_bracket_matches bm
        WHERE bm.round_no = v_round - 1
          AND bm.match_index = (v_match_index * 2);

        v_slot_a := jsonb_build_object('source_type', 'winner_of_match', 'winner_of_match_id', v_prev_a_match);
        v_slot_b := jsonb_build_object('source_type', 'winner_of_match', 'winner_of_match_id', v_prev_b_match);
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
          'bracket_mode', 'manual_rank_source',
          'seed_label_a', v_placeholder_a,
          'seed_label_b', v_placeholder_b,
          'seed_source_a', v_slot_a,
          'seed_source_b', v_slot_b
        ),
        p_event_id,
        v_tenant_id,
        v_tournament_id
      );

      IF v_round = 1 THEN
        INSERT INTO public.knockout_slots(
          tenant_id, tournament_id, event_id, match_id, slot_code, label, source_type,
          group_id, group_rank, best_third_index, metadata
        )
        VALUES
        (
          v_tenant_id, v_tournament_id, p_event_id, v_match_id, 'A', v_placeholder_a, v_slot_a->>'source_type',
          NULLIF(v_slot_a->>'group_id', ''), NULLIF(v_slot_a->>'group_rank', '')::integer,
          NULLIF(v_slot_a->>'best_third_index', '')::integer, v_slot_a
        ),
        (
          v_tenant_id, v_tournament_id, p_event_id, v_match_id, 'B', v_placeholder_b, v_slot_b->>'source_type',
          NULLIF(v_slot_b->>'group_id', ''), NULLIF(v_slot_b->>'group_rank', '')::integer,
          NULLIF(v_slot_b->>'best_third_index', '')::integer, v_slot_b
        );
      END IF;

      v_created := v_created + 1;
    END LOOP;
  END LOOP;

  PERFORM public.log_audit_event_v1(
    'SAVE_MANUAL_KNOCKOUT_BRACKET',
    'event',
    p_event_id,
    jsonb_build_object('bracket_size', p_bracket_size, 'slot_count', v_slot_count, 'created_matches', v_created, 'mode', 'manual_rank_source')
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

CREATE OR REPLACE FUNCTION public.clear_knockout_bracket_v1(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_match_count integer := 0;
  v_set_count integer := 0;
  v_slot_count integer := 0;
BEGIN
  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_matches', 'clear_knockout_bracket_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;

  UPDATE public.match_sets ms
  SET deleted_at = now(),
      status = 'pending',
      updated_at = now()
  FROM public.matches m
  WHERE ms.match_id = m.id
    AND m.event_id = p_event_id
    AND m.tenant_id = v_tenant_id
    AND m.group_id = 'knockout'
    AND m.deleted_at IS NULL
    AND ms.deleted_at IS NULL;
  GET DIAGNOSTICS v_set_count = ROW_COUNT;

  UPDATE public.knockout_slots
  SET deleted_at = now(),
      updated_at = now()
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_slot_count = ROW_COUNT;

  UPDATE public.matches
  SET deleted_at = now(),
      score_a = NULL,
      score_b = NULL,
      winner_id = NULL,
      status = 'pending'
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND group_id = 'knockout'
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_match_count = ROW_COUNT;

  PERFORM public.log_audit_event_v1(
    'CLEAR_KNOCKOUT_BRACKET',
    'event',
    p_event_id,
    jsonb_build_object('deleted_matches', v_match_count, 'deleted_match_sets', v_set_count, 'deleted_slots', v_slot_count)
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'deleted_matches', v_match_count,
    'deleted_match_sets', v_set_count,
    'deleted_slots', v_slot_count
  );
END;
$$;

REVOKE ALL ON TABLE public.knockout_slots FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.knockout_slots TO authenticated;
REVOKE ALL ON FUNCTION public.save_manual_knockout_bracket_v1(text, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_manual_knockout_bracket_v1(text, integer, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.clear_knockout_bracket_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_knockout_bracket_v1(text) TO authenticated;

COMMIT;
