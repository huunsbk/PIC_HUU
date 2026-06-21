-- Prompt 12: score display data contract, balanced schedule courts, and persistent knockout seed labels.
BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS schedule_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS court_number integer,
  ADD COLUMN IF NOT EXISTS slot_number integer,
  ADD COLUMN IF NOT EXISTS display_order integer,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.event_knockout_selections
  ADD COLUMN IF NOT EXISTS seed_label text,
  ADD COLUMN IF NOT EXISTS seed_source jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS resolved_team_id text;

CREATE INDEX IF NOT EXISTS idx_matches_event_display_order
  ON public.matches(event_id, tenant_id, display_order)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.p12_rank_label_v1(p_rank integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_rank
    WHEN 1 THEN 'Nhất'
    WHEN 2 THEN 'Nhì'
    WHEN 3 THEN 'Ba'
    ELSE 'Hạng ' || p_rank::text
  END
$$;

CREATE OR REPLACE FUNCTION public.p12_short_ko_label_v1(p_knockout_match_id text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean text := upper(replace(COALESCE(p_knockout_match_id, ''), '-', ''));
BEGIN
  IF v_clean = 'F' THEN
    RETURN 'Chung kết';
  ELSIF v_clean = 'SF1' THEN
    RETURN 'Bán Kết 1';
  ELSIF v_clean = 'SF2' THEN
    RETURN 'Bán Kết 2';
  ELSIF v_clean = 'QF1' THEN
    RETURN 'Tứ Kết 1';
  ELSIF v_clean = 'QF2' THEN
    RETURN 'Tứ Kết 2';
  ELSIF v_clean = 'QF3' THEN
    RETURN 'Tứ Kết 3';
  ELSIF v_clean = 'QF4' THEN
    RETURN 'Tứ Kết 4';
  ELSIF v_clean LIKE 'R16%' THEN
    RETURN 'Vòng 16 ' || regexp_replace(v_clean, '^R16', '');
  ELSIF v_clean LIKE 'R32%' THEN
    RETURN 'Vòng 32 ' || regexp_replace(v_clean, '^R32', '');
  END IF;

  RETURN COALESCE(NULLIF(p_knockout_match_id, ''), 'KO');
END;
$$;

CREATE OR REPLACE FUNCTION public.p12_knockout_seed_label_v1(
  p_source text,
  p_group_name text,
  p_group_rank integer,
  p_suggested_seed integer
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_group_label text;
BEGIN
  v_group_label := trim(regexp_replace(COALESCE(p_group_name, ''), '^Bảng\s+', '', 'i'));

  IF p_source = 'best_third' THEN
    RETURN 'Ba XS ' || COALESCE(p_suggested_seed::text, '');
  END IF;

  IF COALESCE(p_group_rank, 0) > 0 AND v_group_label <> '' THEN
    RETURN public.p12_rank_label_v1(p_group_rank) || ' bảng ' || v_group_label;
  END IF;

  RETURN 'Seed ' || COALESCE(p_suggested_seed::text, '');
END;
$$;

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
  v_match_in_round integer;
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
          COALESCE(array_position(g.team_ids, t.id), 2147483647),
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

CREATE OR REPLACE FUNCTION public.prepare_knockout_candidates_v1(
  p_event_id text,
  p_top_per_group integer DEFAULT 2,
  p_best_third_count integer DEFAULT 0,
  p_exclude_bottom_results boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_format text;
  v_candidates jsonb;
BEGIN
  IF COALESCE(p_top_per_group, 0) < 0 THEN
    RAISE EXCEPTION 'p_top_per_group must be >= 0';
  END IF;

  IF COALESCE(p_best_third_count, 0) < 0 THEN
    RAISE EXCEPTION 'p_best_third_count must be >= 0';
  END IF;

  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_matches', 'prepare_knockout_candidates_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_format := COALESCE(v_ctx->>'format_type', 'group_then_knockout');

  IF v_format <> 'group_then_knockout' THEN
    RAISE EXCEPTION 'prepare_knockout_candidates_v1 applies only to group_then_knockout events';
  END IF;

  WITH base AS (
    SELECT
      g.id AS group_id,
      g.name AS group_name,
      t.id AS team_id,
      t.name AS team_name,
      count(m.id) FILTER (WHERE m.status = 'finished')::integer AS matches_played,
      count(m.id) FILTER (WHERE m.status = 'finished' AND m.winner_id = t.id)::integer AS wins,
      count(m.id) FILTER (WHERE m.status = 'finished' AND m.winner_id IS NOT NULL AND m.winner_id <> t.id)::integer AS losses,
      count(m.id) FILTER (WHERE m.status = 'finished' AND m.winner_id IS NULL)::integer AS draws,
      COALESCE(sum(
        CASE
          WHEN m.status <> 'finished' THEN 0
          WHEN m.team_a_id = t.id THEN COALESCE(m.score_a, 0) - COALESCE(m.score_b, 0)
          WHEN m.team_b_id = t.id THEN COALESCE(m.score_b, 0) - COALESCE(m.score_a, 0)
          ELSE 0
        END
      ), 0)::integer AS set_diff,
      COALESCE(sum(
        CASE
          WHEN m.status <> 'finished' THEN 0
          WHEN m.team_a_id = t.id THEN COALESCE(ms.score_a, m.score_a, 0) - COALESCE(ms.score_b, m.score_b, 0)
          WHEN m.team_b_id = t.id THEN COALESCE(ms.score_b, m.score_b, 0) - COALESCE(ms.score_a, m.score_a, 0)
          ELSE 0
        END
      ), 0)::integer AS point_diff
    FROM public.groups g
    JOIN public.teams t ON t.group_id = g.id
      AND t.event_id = g.event_id
      AND t.tenant_id = g.tenant_id
      AND t.deleted_at IS NULL
    LEFT JOIN public.matches m ON m.group_id = g.id
      AND m.event_id = g.event_id
      AND m.tenant_id = g.tenant_id
      AND m.deleted_at IS NULL
      AND (m.team_a_id = t.id OR m.team_b_id = t.id)
    LEFT JOIN LATERAL (
      SELECT sum(score_a)::integer AS score_a, sum(score_b)::integer AS score_b
      FROM public.match_sets
      WHERE match_id = m.id
        AND deleted_at IS NULL
    ) ms ON true
    WHERE g.event_id = p_event_id
      AND g.tenant_id = v_tenant_id
      AND g.deleted_at IS NULL
    GROUP BY g.id, g.name, t.id, t.name
  ),
  ranked AS (
    SELECT
      *,
      (wins * 3 + draws)::integer AS points,
      row_number() OVER (PARTITION BY group_id ORDER BY (wins * 3 + draws) DESC, set_diff DESC, point_diff DESC, lower(team_name), team_id) AS group_rank,
      count(*) OVER (PARTITION BY group_id) AS group_size
    FROM base
  ),
  bottom AS (
    SELECT group_id, team_id AS bottom_team_id
    FROM ranked
    WHERE group_rank = group_size
  ),
  thirds AS (
    SELECT
      r.*,
      CASE WHEN p_exclude_bottom_results THEN COALESCE(adj.points_delta, 0) ELSE 0 END AS points_delta,
      CASE WHEN p_exclude_bottom_results THEN COALESCE(adj.set_delta, 0) ELSE 0 END AS set_delta,
      CASE WHEN p_exclude_bottom_results THEN COALESCE(adj.point_delta, 0) ELSE 0 END AS point_delta
    FROM ranked r
    JOIN bottom b ON b.group_id = r.group_id
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN m.winner_id = r.team_id THEN -3
          WHEN m.winner_id IS NULL THEN -1
          ELSE 0
        END AS points_delta,
        -CASE
          WHEN m.team_a_id = r.team_id THEN COALESCE(m.score_a, 0) - COALESCE(m.score_b, 0)
          ELSE COALESCE(m.score_b, 0) - COALESCE(m.score_a, 0)
        END AS set_delta,
        -CASE
          WHEN m.team_a_id = r.team_id THEN COALESCE(ms.score_a, m.score_a, 0) - COALESCE(ms.score_b, m.score_b, 0)
          ELSE COALESCE(ms.score_b, m.score_b, 0) - COALESCE(ms.score_a, m.score_a, 0)
        END AS point_delta
      FROM public.matches m
      LEFT JOIN LATERAL (
        SELECT sum(score_a)::integer AS score_a, sum(score_b)::integer AS score_b
        FROM public.match_sets
        WHERE match_id = m.id
          AND deleted_at IS NULL
      ) ms ON true
      WHERE m.event_id = p_event_id
        AND m.tenant_id = v_tenant_id
        AND m.deleted_at IS NULL
        AND m.status = 'finished'
        AND m.group_id = r.group_id
        AND ((m.team_a_id = r.team_id AND m.team_b_id = b.bottom_team_id) OR (m.team_b_id = r.team_id AND m.team_a_id = b.bottom_team_id))
      LIMIT 1
    ) adj ON true
    WHERE r.group_rank = 3
  ),
  best_thirds_limited AS (
    SELECT
      team_id,
      team_name,
      group_id,
      group_name,
      matches_played,
      wins,
      losses,
      draws,
      (points + points_delta)::integer AS points,
      (set_diff + set_delta)::integer AS set_diff,
      (point_diff + point_delta)::integer AS point_diff,
      group_rank,
      group_size,
      'best_third'::text AS source,
      3 AS source_order
    FROM thirds
    ORDER BY (points + points_delta) DESC, (set_diff + set_delta) DESC, (point_diff + point_delta) DESC, lower(team_name), team_id
    LIMIT COALESCE(p_best_third_count, 0)
  ),
  selected AS (
    SELECT *, 'group_rank'::text AS source, group_rank AS source_order
    FROM ranked
    WHERE group_rank <= COALESCE(p_top_per_group, 2)
    UNION ALL
    SELECT *
    FROM best_thirds_limited
  ),
  numbered AS (
    SELECT
      *,
      row_number() OVER (ORDER BY source_order, group_name, group_rank, points DESC, set_diff DESC, point_diff DESC, lower(team_name), team_id) AS suggested_seed
    FROM selected
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id', team_id,
    'team_name', team_name,
    'group_id', group_id,
    'group_name', group_name,
    'group_rank', group_rank,
    'points', points,
    'score_diff', set_diff,
    'set_diff', set_diff,
    'point_diff', point_diff,
    'source', source,
    'seed_label', public.p12_knockout_seed_label_v1(source, group_name, group_rank, suggested_seed),
    'seed_source', jsonb_build_object(
      'source_type', source,
      'group_id', group_id,
      'rank', group_rank,
      'third_best_index', CASE WHEN source = 'best_third' THEN suggested_seed ELSE NULL END
    ),
    'suggested_seed', suggested_seed
  ) ORDER BY suggested_seed), '[]'::jsonb)
  INTO v_candidates
  FROM numbered;

  PERFORM public.log_audit_event_v1(
    'PREPARE_KNOCKOUT_CANDIDATES',
    'event',
    p_event_id,
    jsonb_build_object('top_per_group', p_top_per_group, 'best_third_count', p_best_third_count, 'exclude_bottom_results', p_exclude_bottom_results, 'candidate_count', jsonb_array_length(v_candidates))
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'candidates', v_candidates,
    'candidate_count', jsonb_array_length(v_candidates),
    'exclude_bottom_results', p_exclude_bottom_results
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_knockout_teams_v1(
  p_event_id text,
  p_teams jsonb,
  p_bracket_size integer,
  p_override_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_tenant_id uuid;
  v_account_id uuid;
  v_item jsonb;
  v_team_id text;
  v_seed integer;
  v_source text;
  v_source_group_id text;
  v_source_group_name text;
  v_group_rank integer;
  v_seed_label text;
  v_seed_source jsonb;
  v_selected_count integer;
  v_seen_teams text[] := ARRAY[]::text[];
  v_seen_seeds integer[] := ARRAY[]::integer[];
  v_teams_result jsonb := '[]'::jsonb;
BEGIN
  IF p_bracket_size NOT IN (4, 8, 16, 32) THEN
    RAISE EXCEPTION 'p_bracket_size must be one of 4, 8, 16, 32';
  END IF;

  IF p_teams IS NULL OR jsonb_typeof(p_teams) <> 'array' THEN
    RAISE EXCEPTION 'p_teams must be a jsonb array';
  END IF;

  v_selected_count := jsonb_array_length(p_teams);

  IF v_selected_count = 0 THEN
    RAISE EXCEPTION 'At least one knockout team must be selected';
  END IF;

  IF v_selected_count > p_bracket_size THEN
    RAISE EXCEPTION 'Selected team count (%) exceeds bracket size (%)', v_selected_count, p_bracket_size;
  END IF;

  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_matches', 'confirm_knockout_teams_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_account_id := (v_ctx->>'account_id')::uuid;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_teams)
  LOOP
    v_team_id := btrim(COALESCE(v_item->>'team_id', ''));
    v_seed := COALESCE((v_item->>'seed')::integer, 0);

    IF v_team_id = '' THEN
      RAISE EXCEPTION 'team_id is required in p_teams';
    END IF;

    IF v_seed < 1 OR v_seed > p_bracket_size THEN
      RAISE EXCEPTION 'seed must be between 1 and bracket size';
    END IF;

    IF v_team_id = ANY(v_seen_teams) THEN
      RAISE EXCEPTION 'Duplicate team selected: %', v_team_id;
    END IF;

    IF v_seed = ANY(v_seen_seeds) THEN
      RAISE EXCEPTION 'Duplicate seed selected: %', v_seed;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.teams t
      WHERE t.id = v_team_id
        AND t.event_id = p_event_id
        AND t.tenant_id = v_tenant_id
        AND t.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Selected team does not belong to this event: %', v_team_id;
    END IF;

    v_seen_teams := array_append(v_seen_teams, v_team_id);
    v_seen_seeds := array_append(v_seen_seeds, v_seed);
  END LOOP;

  UPDATE public.event_knockout_selections
  SET deleted_at = now(),
      updated_at = now()
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_teams)
  LOOP
    v_team_id := btrim(v_item->>'team_id');
    v_seed := (v_item->>'seed')::integer;
    v_source := COALESCE(v_item->>'source', 'admin');
    v_source_group_id := v_item->>'source_group_id';
    v_group_rank := NULLIF(v_item->>'group_rank', '')::integer;

    SELECT name
      INTO v_source_group_name
    FROM public.groups
    WHERE id = v_source_group_id
      AND event_id = p_event_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL;

    v_seed_label := COALESCE(
      NULLIF(v_item->>'seed_label', ''),
      public.p12_knockout_seed_label_v1(v_source, v_source_group_name, v_group_rank, v_seed)
    );
    v_seed_source := COALESCE(
      v_item->'seed_source',
      jsonb_build_object(
        'source_type', v_source,
        'group_id', v_source_group_id,
        'rank', v_group_rank,
        'third_best_index', CASE WHEN v_source = 'best_third' THEN v_seed ELSE NULL END
      )
    );

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
      override_reason,
      confirmed_by,
      seed_label,
      seed_source,
      resolved_team_id
    )
    VALUES (
      v_tenant_id,
      p_event_id,
      v_team_id,
      v_seed,
      p_bracket_size,
      v_source,
      v_source_group_id,
      v_group_rank,
      p_override_reason IS NOT NULL,
      p_override_reason,
      v_account_id,
      v_seed_label,
      v_seed_source,
      v_team_id
    );

    v_teams_result := v_teams_result || jsonb_build_array(jsonb_build_object(
      'team_id', v_team_id,
      'seed', v_seed,
      'source', v_source,
      'seed_label', v_seed_label,
      'seed_source', v_seed_source,
      'resolved_team_id', v_team_id
    ));
  END LOOP;

  UPDATE public.events
  SET ranking_config = jsonb_set(
    jsonb_set(COALESCE(ranking_config, '{}'::jsonb), '{knockout,bracketSize}', to_jsonb(p_bracket_size), true),
    '{knockout,confirmedTeamCount}',
    to_jsonb(v_selected_count),
    true
  )
  WHERE id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  PERFORM public.log_audit_event_v1(
    'CONFIRM_KNOCKOUT_TEAMS',
    'event',
    p_event_id,
    jsonb_build_object('bracket_size', p_bracket_size, 'selected_count', v_selected_count, 'bye_count', p_bracket_size - v_selected_count, 'override_reason', p_override_reason, 'teams', v_teams_result)
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'bracket_size', p_bracket_size,
    'selected_count', v_selected_count,
    'bye_count', p_bracket_size - v_selected_count,
    'teams', v_teams_result
  );
END;
$$;

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
  v_sel_a record;
  v_sel_b record;
  v_prev_a record;
  v_prev_b record;
BEGIN
  v_ctx := public.p06_require_event_admin_v1(p_event_id, 'manage_matches', 'generate_knockout_bracket_v1');
  v_tenant_id := (v_ctx->>'tenant_id')::uuid;
  v_tournament_id := v_ctx->>'tournament_id';

  IF EXISTS (
    SELECT 1
    FROM public.matches
    WHERE event_id = p_event_id
      AND tenant_id = v_tenant_id
      AND deleted_at IS NULL
      AND group_id = 'knockout'
  ) THEN
    RAISE EXCEPTION 'Active knockout bracket already exists';
  END IF;

  SELECT max(bracket_size), count(*)::integer
    INTO v_bracket_size, v_selected_count
  FROM public.event_knockout_selections
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND deleted_at IS NULL;

  IF v_selected_count = 0 OR v_bracket_size IS NULL THEN
    RAISE EXCEPTION 'No confirmed knockout teams found';
  END IF;

  IF v_bracket_size NOT IN (4, 8, 16, 32) THEN
    RAISE EXCEPTION 'Invalid confirmed bracket size: %', v_bracket_size;
  END IF;

  v_round_count := CASE v_bracket_size WHEN 4 THEN 2 WHEN 8 THEN 3 WHEN 16 THEN 4 WHEN 32 THEN 5 END;

  CREATE TEMP TABLE IF NOT EXISTS p12_bracket_matches (
    round_no integer,
    match_index integer,
    match_id text,
    knockout_match_id text
  ) ON COMMIT DROP;
  TRUNCATE p12_bracket_matches;

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
      INSERT INTO p12_bracket_matches(round_no, match_index, match_id, knockout_match_id)
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
      SELECT match_id, knockout_match_id
        INTO v_match_id, v_knockout_match_id
      FROM p12_bracket_matches
      WHERE round_no = v_round
        AND match_index = v_match_index;

      IF v_round < v_round_count THEN
        SELECT match_id
          INTO v_next_match_id
        FROM p12_bracket_matches
        WHERE round_no = v_round + 1
          AND match_index = ceil(v_match_index / 2.0)::integer;
        v_next_slot := CASE WHEN v_match_index % 2 = 1 THEN 'A' ELSE 'B' END;
      ELSE
        v_next_match_id := NULL;
        v_next_slot := NULL;
      END IF;

      IF v_round = 1 THEN
        v_seed_a := v_match_index;
        v_seed_b := v_bracket_size - v_match_index + 1;

        SELECT *
          INTO v_sel_a
        FROM public.event_knockout_selections
        WHERE event_id = p_event_id
          AND tenant_id = v_tenant_id
          AND deleted_at IS NULL
          AND seed = v_seed_a
        LIMIT 1;

        SELECT *
          INTO v_sel_b
        FROM public.event_knockout_selections
        WHERE event_id = p_event_id
          AND tenant_id = v_tenant_id
          AND deleted_at IS NULL
          AND seed = v_seed_b
        LIMIT 1;
      ELSE
        SELECT *
          INTO v_prev_a
        FROM p12_bracket_matches
        WHERE round_no = v_round - 1
          AND match_index = (v_match_index * 2 - 1);

        SELECT *
          INTO v_prev_b
        FROM p12_bracket_matches
        WHERE round_no = v_round - 1
          AND match_index = (v_match_index * 2);
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
        metadata,
        event_id,
        tenant_id,
        tournament_id
      )
      VALUES (
        v_match_id,
        'knockout',
        CASE WHEN v_round = 1 THEN v_sel_a.resolved_team_id ELSE NULL END,
        CASE WHEN v_round = 1 THEN v_sel_b.resolved_team_id ELSE NULL END,
        CASE WHEN v_round = 1 THEN COALESCE(v_sel_a.seed_label, 'BYE') ELSE 'Thắng ' || public.p12_short_ko_label_v1(v_prev_a.knockout_match_id) END,
        CASE WHEN v_round = 1 THEN COALESCE(v_sel_b.seed_label, 'BYE') ELSE 'Thắng ' || public.p12_short_ko_label_v1(v_prev_b.knockout_match_id) END,
        NULL,
        NULL,
        NULL,
        'pending',
        v_round,
        v_round_name,
        v_knockout_match_id,
        v_next_match_id,
        v_next_slot,
        jsonb_build_object(
          'seed_label_a', CASE WHEN v_round = 1 THEN COALESCE(v_sel_a.seed_label, 'BYE') ELSE 'Thắng ' || public.p12_short_ko_label_v1(v_prev_a.knockout_match_id) END,
          'seed_label_b', CASE WHEN v_round = 1 THEN COALESCE(v_sel_b.seed_label, 'BYE') ELSE 'Thắng ' || public.p12_short_ko_label_v1(v_prev_b.knockout_match_id) END,
          'seed_source_a', CASE WHEN v_round = 1 THEN COALESCE(v_sel_a.seed_source, '{}'::jsonb) ELSE jsonb_build_object('source_type', 'winner_of_match', 'winner_of_match_id', v_prev_a.match_id) END,
          'seed_source_b', CASE WHEN v_round = 1 THEN COALESCE(v_sel_b.seed_source, '{}'::jsonb) ELSE jsonb_build_object('source_type', 'winner_of_match', 'winner_of_match_id', v_prev_b.match_id) END,
          'resolved_team_id_a', CASE WHEN v_round = 1 THEN v_sel_a.resolved_team_id ELSE NULL END,
          'resolved_team_id_b', CASE WHEN v_round = 1 THEN v_sel_b.resolved_team_id ELSE NULL END
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
    jsonb_build_object('bracket_size', v_bracket_size, 'selected_count', v_selected_count, 'bye_count', v_bracket_size - v_selected_count, 'created_matches', v_created)
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'bracket_size', v_bracket_size,
    'selected_count', v_selected_count,
    'bye_count', v_bracket_size - v_selected_count,
    'created_matches', v_created
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.p12_propagate_knockout_winner_v1(p_match_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_match record;
  v_slot text;
BEGIN
  SELECT *
    INTO v_match
  FROM public.matches
  WHERE id = p_match_id
    AND deleted_at IS NULL
    AND group_id = 'knockout'
    AND status = 'finished'
    AND winner_id IS NOT NULL;

  IF NOT FOUND OR v_match.next_match_id IS NULL THEN
    RETURN;
  END IF;

  v_slot := COALESCE(v_match.next_match_slot, 'A');

  IF v_slot = 'A' THEN
    UPDATE public.matches
    SET team_a_id = v_match.winner_id,
        metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{resolved_team_id_a}', to_jsonb(v_match.winner_id), true)
    WHERE id = v_match.next_match_id
      AND deleted_at IS NULL;
  ELSE
    UPDATE public.matches
    SET team_b_id = v_match.winner_id,
        metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{resolved_team_id_b}', to_jsonb(v_match.winner_id), true)
    WHERE id = v_match.next_match_id
      AND deleted_at IS NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.p12_reset_knockout_downstream_v1(p_match_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_match record;
  v_next record;
  v_slot text;
BEGIN
  SELECT *
    INTO v_match
  FROM public.matches
  WHERE id = p_match_id
    AND deleted_at IS NULL
    AND group_id = 'knockout';

  IF NOT FOUND OR v_match.next_match_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
    INTO v_next
  FROM public.matches
  WHERE id = v_match.next_match_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_slot := COALESCE(v_match.next_match_slot, 'A');

  UPDATE public.match_sets
  SET deleted_at = now(),
      status = 'pending',
      updated_at = now()
  WHERE match_id = v_next.id
    AND deleted_at IS NULL;

  IF v_slot = 'A' THEN
    UPDATE public.matches
    SET team_a_id = NULL,
        score_a = NULL,
        score_b = NULL,
        winner_id = NULL,
        status = 'pending',
        metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{resolved_team_id_a}', 'null'::jsonb, true)
    WHERE id = v_next.id;
  ELSE
    UPDATE public.matches
    SET team_b_id = NULL,
        score_a = NULL,
        score_b = NULL,
        winner_id = NULL,
        status = 'pending',
        metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{resolved_team_id_b}', 'null'::jsonb, true)
    WHERE id = v_next.id;
  END IF;

  PERFORM public.p12_reset_knockout_downstream_v1(v_next.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_match_score_v1(
  p_match_id text,
  p_score_a integer,
  p_score_b integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.p10_require_match_score_context_v1(p_match_id, 'update_match_score_v1');
  v_result := public.p10_core_update_match_score_v1(p_match_id, p_score_a, p_score_b);
  PERFORM public.p12_propagate_knockout_winner_v1(p_match_id);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_match_set_score_v1(
  p_match_id text,
  p_set_number integer,
  p_score_a integer,
  p_score_b integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.p10_require_match_score_context_v1(p_match_id, 'update_match_set_score_v1');
  v_result := public.p10_core_update_match_set_score_v1(p_match_id, p_set_number, p_score_a, p_score_b);
  IF COALESCE(v_result->>'match_status', '') = 'finished' THEN
    PERFORM public.p12_propagate_knockout_winner_v1(p_match_id);
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_match_score_v1(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.p10_require_match_score_context_v1(p_match_id, 'reset_match_score_v1');
  v_result := public.p10_core_reset_match_score_v1(p_match_id);
  PERFORM public.p12_reset_knockout_downstream_v1(p_match_id);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_schedule_v1(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prepare_knockout_candidates_v1(text, integer, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_knockout_teams_v1(text, jsonb, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_knockout_bracket_v1(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_match_score_v1(text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_match_set_score_v1(text, integer, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reset_match_score_v1(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.generate_schedule_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_knockout_candidates_v1(text, integer, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_knockout_teams_v1(text, jsonb, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_knockout_bracket_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_match_score_v1(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_match_set_score_v1(text, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_match_score_v1(text) TO authenticated;

COMMIT;
