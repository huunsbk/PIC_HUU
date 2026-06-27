-- Knockout hotfix: generate bracket directly from current event standings.
BEGIN;

CREATE OR REPLACE FUNCTION public.generate_knockout_bracket_v1(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_tournament_id text;
  v_account_id uuid;
  v_bracket_size integer;
  v_selected_count integer;
  v_round_count integer;
  v_round integer;
  v_match_index integer;
  v_matches_in_round integer;
  v_match_id text;
  v_next_match_id text;
  v_next_slot text;
  v_round_name text;
  v_knockout_match_id text;
  v_created integer := 0;
  v_seed_a integer;
  v_seed_b integer;
  v_sel_a_team text;
  v_sel_b_team text;
  v_sel_a_label text;
  v_sel_b_label text;
  v_sel_a_source jsonb;
  v_sel_b_source jsonb;
  v_prev_a_match text;
  v_prev_b_match text;
  v_prev_a_ko text;
  v_prev_b_ko text;
BEGIN
  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_matches', 'generate_knockout_bracket_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_tournament_id := v_ctx->>'tournament_id';
  v_account_id := public.current_account_id();

  IF EXISTS (
    SELECT 1
    FROM public.matches
    WHERE event_id = p_event_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL
      AND group_id = 'knockout'
  ) THEN
    RAISE EXCEPTION 'Đã có sơ đồ, hãy xóa trước khi tạo lại';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS p18_group_teams (
    group_id text,
    group_name text,
    group_order integer,
    team_id text,
    team_name text,
    team_order integer
  ) ON COMMIT DROP;
  TRUNCATE p18_group_teams;

  INSERT INTO p18_group_teams(group_id, group_name, group_order, team_id, team_name, team_order)
  SELECT
    g.id,
    g.name,
    dense_rank() OVER (ORDER BY g.name, g.id)::integer,
    team_item.team_id,
    COALESCE(t.name, team_item.team_id),
    team_item.ord::integer
  FROM public.groups g
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(g.team_ids, '[]'::jsonb)) WITH ORDINALITY AS team_item(team_id, ord)
  LEFT JOIN public.teams t
    ON t.id = team_item.team_id
   AND t.event_id = g.event_id
   AND t.tenant_id = g.tenant_id
   AND t.deleted_at IS NULL
  WHERE g.event_id = p_event_id
    AND g.tenant_id = v_tenant_id
    AND g.deleted_at IS NULL;

  IF NOT EXISTS (SELECT 1 FROM p18_group_teams) THEN
    RAISE EXCEPTION 'Không có bảng/đội để tạo sơ đồ knockout';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.groups g
    WHERE g.event_id = p_event_id
      AND g.tenant_id = v_tenant_id
      AND g.deleted_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.matches m
        WHERE m.event_id = p_event_id
          AND m.tenant_id = v_tenant_id
          AND m.group_id = g.id
          AND m.deleted_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM public.matches m
        WHERE m.event_id = p_event_id
          AND m.tenant_id = v_tenant_id
          AND m.group_id = g.id
          AND m.deleted_at IS NULL
          AND COALESCE(m.status, '') <> 'finished'
      )
  ) THEN
    RAISE EXCEPTION 'Vòng bảng chưa kết thúc, chưa thể tạo sơ đồ knockout';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS p18_ranked_teams (
    seed integer,
    group_id text,
    group_name text,
    group_order integer,
    team_id text,
    team_name text,
    group_rank integer,
    points integer,
    set_diff integer,
    point_diff integer,
    seed_label text,
    seed_source jsonb
  ) ON COMMIT DROP;
  TRUNCATE p18_ranked_teams;

  WITH stats AS (
    SELECT
      gt.group_id,
      gt.group_name,
      gt.group_order,
      gt.team_id,
      gt.team_name,
      gt.team_order,
      count(DISTINCT m.id) FILTER (WHERE m.id IS NOT NULL) AS matches_played,
      count(DISTINCT m.id) FILTER (WHERE m.winner_id = gt.team_id) AS wins,
      count(DISTINCT m.id) FILTER (WHERE m.id IS NOT NULL AND COALESCE(m.winner_id, '') <> gt.team_id) AS losses,
      coalesce(sum(
        CASE
          WHEN ms.id IS NULL THEN 0
          WHEN ms.winner_id = gt.team_id THEN 1
          ELSE 0
        END
      ), 0)::integer AS sets_won,
      coalesce(sum(
        CASE
          WHEN ms.id IS NULL THEN 0
          WHEN ms.winner_id IS NOT NULL AND ms.winner_id <> gt.team_id THEN 1
          ELSE 0
        END
      ), 0)::integer AS sets_lost,
      coalesce(sum(
        CASE
          WHEN ms.id IS NULL THEN 0
          WHEN m.team_a_id = gt.team_id THEN COALESCE(ms.score_a, 0) - COALESCE(ms.score_b, 0)
          WHEN m.team_b_id = gt.team_id THEN COALESCE(ms.score_b, 0) - COALESCE(ms.score_a, 0)
          ELSE 0
        END
      ), 0)::integer AS point_diff
    FROM p18_group_teams gt
    LEFT JOIN public.matches m
      ON m.event_id = p_event_id
     AND m.tenant_id = v_tenant_id
     AND m.group_id = gt.group_id
     AND m.deleted_at IS NULL
     AND m.status = 'finished'
     AND (m.team_a_id = gt.team_id OR m.team_b_id = gt.team_id)
    LEFT JOIN public.match_sets ms
      ON ms.match_id = m.id
     AND ms.event_id = p_event_id
     AND ms.tenant_id = v_tenant_id
     AND ms.deleted_at IS NULL
     AND ms.status = 'finished'
    GROUP BY gt.group_id, gt.group_name, gt.group_order, gt.team_id, gt.team_name, gt.team_order
  ),
  ranked AS (
    SELECT
      *,
      (wins * 2 + losses)::integer AS points,
      (sets_won - sets_lost)::integer AS set_diff,
      row_number() OVER (
        PARTITION BY group_id
        ORDER BY (wins * 2 + losses) DESC, (sets_won - sets_lost) DESC, point_diff DESC, wins DESC, team_order ASC
      )::integer AS group_rank
    FROM stats
  ),
  qualified AS (
    SELECT *
    FROM ranked
    WHERE group_rank <= 2
  ),
  seeded AS (
    SELECT
      row_number() OVER (ORDER BY group_rank ASC, group_order ASC)::integer AS seed,
      *
    FROM qualified
  )
  INSERT INTO p18_ranked_teams(seed, group_id, group_name, group_order, team_id, team_name, group_rank, points, set_diff, point_diff, seed_label, seed_source)
  SELECT
    seed,
    group_id,
    group_name,
    group_order,
    team_id,
    team_name,
    group_rank,
    points,
    set_diff,
    point_diff,
    'Hạng ' || group_rank::text || ' bảng ' || trim(regexp_replace(group_name, '^Bảng\s+', '', 'i')) AS seed_label,
    jsonb_build_object('source_type', 'group_rank', 'group_id', group_id, 'rank', group_rank)
  FROM seeded;

  SELECT count(*)::integer INTO v_selected_count FROM p18_ranked_teams;

  IF v_selected_count < 2 THEN
    RAISE EXCEPTION 'Không đủ đội đủ điều kiện để tạo sơ đồ knockout';
  END IF;

  v_bracket_size := CASE
    WHEN v_selected_count <= 4 THEN 4
    WHEN v_selected_count <= 8 THEN 8
    WHEN v_selected_count <= 16 THEN 16
    ELSE 32
  END;

  UPDATE public.event_knockout_selections
  SET deleted_at = now(), updated_at = now()
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  INSERT INTO public.event_knockout_selections(
    tenant_id,
    event_id,
    team_id,
    seed,
    bracket_size,
    source,
    source_group_id,
    group_rank,
    is_override,
    confirmed_by,
    seed_label,
    seed_source,
    resolved_team_id
  )
  SELECT
    v_tenant_id,
    p_event_id,
    team_id,
    seed,
    v_bracket_size,
    'group_rank',
    group_id,
    group_rank,
    false,
    v_account_id,
    seed_label,
    seed_source,
    team_id
  FROM p18_ranked_teams;

  v_round_count := CASE v_bracket_size WHEN 4 THEN 2 WHEN 8 THEN 3 WHEN 16 THEN 4 WHEN 32 THEN 5 END;

  CREATE TEMP TABLE IF NOT EXISTS p18_bracket_matches (
    round_no integer,
    match_index integer,
    match_id text,
    knockout_match_id text
  ) ON COMMIT DROP;
  TRUNCATE p18_bracket_matches;

  FOR v_round IN 1..v_round_count LOOP
    v_matches_in_round := (v_bracket_size / (2 ^ v_round))::integer;
    FOR v_match_index IN 1..v_matches_in_round LOOP
      v_round_name := CASE
        WHEN v_round = v_round_count THEN 'Chung Kết'
        WHEN v_round = v_round_count - 1 THEN 'Bán Kết'
        WHEN v_round = v_round_count - 2 THEN 'Tứ Kết'
        WHEN v_bracket_size = 16 AND v_round = 1 THEN 'Vòng 16 Đội'
        WHEN v_bracket_size = 32 AND v_round = 1 THEN 'Vòng 32 Đội'
        WHEN v_bracket_size = 32 AND v_round = 2 THEN 'Vòng 16 Đội'
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

      INSERT INTO p18_bracket_matches(round_no, match_index, match_id, knockout_match_id)
      VALUES (v_round, v_match_index, 'match-' || gen_random_uuid()::text, v_knockout_match_id);
    END LOOP;
  END LOOP;

  FOR v_round IN REVERSE v_round_count..1 LOOP
    v_matches_in_round := (v_bracket_size / (2 ^ v_round))::integer;
    v_round_name := CASE
      WHEN v_round = v_round_count THEN 'Chung Kết'
      WHEN v_round = v_round_count - 1 THEN 'Bán Kết'
      WHEN v_round = v_round_count - 2 THEN 'Tứ Kết'
      WHEN v_bracket_size = 16 AND v_round = 1 THEN 'Vòng 16 Đội'
      WHEN v_bracket_size = 32 AND v_round = 1 THEN 'Vòng 32 Đội'
      WHEN v_bracket_size = 32 AND v_round = 2 THEN 'Vòng 16 Đội'
      ELSE 'Vòng Knockout'
    END;

    FOR v_match_index IN 1..v_matches_in_round LOOP
      SELECT bm.match_id, bm.knockout_match_id
      INTO v_match_id, v_knockout_match_id
      FROM p18_bracket_matches bm
      WHERE bm.round_no = v_round
        AND bm.match_index = v_match_index;

      IF v_round < v_round_count THEN
        SELECT bm.match_id
        INTO v_next_match_id
        FROM p18_bracket_matches bm
        WHERE bm.round_no = v_round + 1
          AND bm.match_index = ceil(v_match_index / 2.0)::integer;
        v_next_slot := CASE WHEN v_match_index % 2 = 1 THEN 'A' ELSE 'B' END;
      ELSE
        v_next_match_id := NULL;
        v_next_slot := NULL;
      END IF;

      v_sel_a_team := NULL;
      v_sel_b_team := NULL;
      v_sel_a_label := NULL;
      v_sel_b_label := NULL;
      v_sel_a_source := '{}'::jsonb;
      v_sel_b_source := '{}'::jsonb;
      v_prev_a_match := NULL;
      v_prev_b_match := NULL;
      v_prev_a_ko := NULL;
      v_prev_b_ko := NULL;

      IF v_round = 1 THEN
        v_seed_a := v_match_index;
        v_seed_b := v_bracket_size - v_match_index + 1;

        SELECT r.team_id, r.seed_label, r.seed_source
        INTO v_sel_a_team, v_sel_a_label, v_sel_a_source
        FROM p18_ranked_teams r
        WHERE r.seed = v_seed_a
        LIMIT 1;

        SELECT r.team_id, r.seed_label, r.seed_source
        INTO v_sel_b_team, v_sel_b_label, v_sel_b_source
        FROM p18_ranked_teams r
        WHERE r.seed = v_seed_b
        LIMIT 1;
      ELSE
        SELECT bm.match_id, bm.knockout_match_id
        INTO v_prev_a_match, v_prev_a_ko
        FROM p18_bracket_matches bm
        WHERE bm.round_no = v_round - 1
          AND bm.match_index = (v_match_index * 2 - 1);

        SELECT bm.match_id, bm.knockout_match_id
        INTO v_prev_b_match, v_prev_b_ko
        FROM p18_bracket_matches bm
        WHERE bm.round_no = v_round - 1
          AND bm.match_index = (v_match_index * 2);
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
        CASE WHEN v_round = 1 THEN v_sel_a_team ELSE NULL END,
        CASE WHEN v_round = 1 THEN v_sel_b_team ELSE NULL END,
        CASE WHEN v_round = 1 THEN COALESCE(v_sel_a_label, 'BYE') ELSE 'Thắng ' || public.p12_short_ko_label_v1(v_prev_a_ko) END,
        CASE WHEN v_round = 1 THEN COALESCE(v_sel_b_label, 'BYE') ELSE 'Thắng ' || public.p12_short_ko_label_v1(v_prev_b_ko) END,
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
          'seed_label_a', CASE WHEN v_round = 1 THEN COALESCE(v_sel_a_label, 'BYE') ELSE 'Thắng ' || public.p12_short_ko_label_v1(v_prev_a_ko) END,
          'seed_label_b', CASE WHEN v_round = 1 THEN COALESCE(v_sel_b_label, 'BYE') ELSE 'Thắng ' || public.p12_short_ko_label_v1(v_prev_b_ko) END,
          'seed_source_a', CASE WHEN v_round = 1 THEN COALESCE(v_sel_a_source, '{}'::jsonb) ELSE jsonb_build_object('source_type', 'winner_of_match', 'winner_of_match_id', v_prev_a_match) END,
          'seed_source_b', CASE WHEN v_round = 1 THEN COALESCE(v_sel_b_source, '{}'::jsonb) ELSE jsonb_build_object('source_type', 'winner_of_match', 'winner_of_match_id', v_prev_b_match) END,
          'resolved_team_id_a', CASE WHEN v_round = 1 THEN v_sel_a_team ELSE NULL END,
          'resolved_team_id_b', CASE WHEN v_round = 1 THEN v_sel_b_team ELSE NULL END
        ),
        p_event_id,
        v_tenant_id,
        v_tournament_id
      );

      v_created := v_created + 1;
    END LOOP;
  END LOOP;

  PERFORM public.log_audit_event_v1(
    'GENERATE_KNOCKOUT_BRACKET',
    'event',
    p_event_id,
    jsonb_build_object('bracket_size', v_bracket_size, 'selected_count', v_selected_count, 'created_matches', v_created, 'source', 'standings_direct')
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'bracket_size', v_bracket_size,
    'selected_count', v_selected_count,
    'created_matches', v_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_knockout_bracket_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_knockout_bracket_v1(text) TO authenticated;

COMMIT;
