-- Round-scoped set mode configuration.

CREATE OR REPLACE FUNCTION public.normalize_round_set_modes_v1(p_scoring_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_default_mode text := COALESCE(p_scoring_config->>'matchSetMode', 'single');
  v_modes jsonb := COALESCE(p_scoring_config->'roundSetModes', '{}'::jsonb);
  v_key text;
  v_value text;
  v_result jsonb := '{}'::jsonb;
BEGIN
  IF v_default_mode NOT IN ('single', 'best_of_3') THEN
    v_default_mode := 'single';
  END IF;

  FOREACH v_key IN ARRAY ARRAY['group', 'r32', 'r16', 'r8', 'qf', 'sf', 'final']
  LOOP
    v_value := COALESCE(v_modes->>v_key, v_default_mode);
    IF v_value NOT IN ('single', 'best_of_3') THEN
      RAISE EXCEPTION 'Invalid round set mode for %', v_key;
    END IF;
    v_result := jsonb_set(v_result, ARRAY[v_key], to_jsonb(v_value), true);
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_match_round_key_v1(
  p_group_id text,
  p_knockout_round_name text,
  p_knockout_match_id text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_round text := lower(coalesce(p_knockout_round_name, ''));
  v_code text := upper(coalesce(p_knockout_match_id, ''));
BEGIN
  IF coalesce(p_group_id, '') <> 'knockout' THEN
    RETURN 'group';
  END IF;

  IF v_code LIKE 'R32%' OR v_round LIKE '%32%' OR v_round LIKE '%1/32%' THEN
    RETURN 'r32';
  ELSIF v_code LIKE 'R16%' OR v_round LIKE '%16%' OR v_round LIKE '%1/16%' THEN
    RETURN 'r16';
  ELSIF v_code LIKE 'R8%' OR v_round LIKE '%vòng 8%' OR v_round LIKE '%vong 8%' OR v_round LIKE '%1/8%' THEN
    RETURN 'r8';
  ELSIF v_code LIKE 'QF%' OR v_round LIKE '%tứ kết%' OR v_round LIKE '%tu ket%' THEN
    RETURN 'qf';
  ELSIF v_code LIKE 'SF%' OR v_round LIKE '%bán kết%' OR v_round LIKE '%ban ket%' THEN
    RETURN 'sf';
  ELSIF v_code IN ('F', 'Y-F') OR v_code LIKE 'F-%' OR v_round LIKE '%chung kết%' OR v_round LIKE '%chung ket%' THEN
    RETURN 'final';
  END IF;

  RETURN 'r16';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_match_set_mode_v1(p_match_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_match record;
  v_scoring_config jsonb;
  v_modes jsonb;
  v_round_key text;
BEGIN
  SELECT
    m.group_id,
    m.knockout_round_name,
    m.knockout_match_id,
    e.scoring_config,
    e.sport_id
  INTO v_match
  FROM public.matches m
  JOIN public.events e ON e.id = m.event_id
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF v_match.group_id IS NULL THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND';
  END IF;

  v_scoring_config := CASE
    WHEN COALESCE(v_match.scoring_config, '{}'::jsonb) = '{}'::jsonb THEN (
      SELECT default_settings
      FROM public.sports
      WHERE id = COALESCE(v_match.sport_id, 'sport_pickleball')
    )
    ELSE v_match.scoring_config
  END;

  v_modes := public.normalize_round_set_modes_v1(COALESCE(v_scoring_config, '{}'::jsonb));
  v_round_key := public.get_match_round_key_v1(v_match.group_id, v_match.knockout_round_name, v_match.knockout_match_id);

  RETURN COALESCE(v_modes->>v_round_key, v_scoring_config->>'matchSetMode', 'single');
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_round_set_modes_change_allowed_v1(
  p_event_id text,
  p_old_scoring_config jsonb,
  p_new_scoring_config jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_old_modes jsonb := public.normalize_round_set_modes_v1(COALESCE(p_old_scoring_config, '{}'::jsonb));
  v_new_modes jsonb := public.normalize_round_set_modes_v1(COALESCE(p_new_scoring_config, '{}'::jsonb));
  v_key text;
  v_label text;
  v_has_result boolean;
BEGIN
  FOREACH v_key IN ARRAY ARRAY['group', 'r32', 'r16', 'r8', 'qf', 'sf', 'final']
  LOOP
    IF COALESCE(v_old_modes->>v_key, 'single') = COALESCE(v_new_modes->>v_key, 'single') THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.matches m
      WHERE m.event_id = p_event_id
        AND m.deleted_at IS NULL
        AND public.get_match_round_key_v1(m.group_id, m.knockout_round_name, m.knockout_match_id) = v_key
        AND (
          m.status IN ('playing', 'finished')
          OR m.score_a IS NOT NULL
          OR m.score_b IS NOT NULL
          OR m.winner_id IS NOT NULL
          OR EXISTS (
            SELECT 1
            FROM public.match_sets ms
            WHERE ms.match_id = m.id
              AND ms.deleted_at IS NULL
              AND (
                ms.score_a IS NOT NULL
                OR ms.score_b IS NOT NULL
                OR ms.winner_id IS NOT NULL
                OR ms.status = 'finished'
              )
          )
        )
    ) INTO v_has_result;

    IF v_has_result THEN
      v_label := CASE v_key
        WHEN 'group' THEN 'Vòng bảng'
        WHEN 'r32' THEN 'Vòng 1/32'
        WHEN 'r16' THEN 'Vòng 1/16'
        WHEN 'r8' THEN 'Vòng 1/8'
        WHEN 'qf' THEN 'Tứ kết'
        WHEN 'sf' THEN 'Bán kết'
        WHEN 'final' THEN 'Chung kết'
        ELSE v_key
      END;
      RAISE EXCEPTION 'ROUND_SET_MODE_LOCKED: % đã có kết quả. Hãy reset kết quả vòng này trước khi đổi số séc.', v_label;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_event_config_v1(
  p_sport_id text,
  p_competition_type text,
  p_format_type text,
  p_scoring_config jsonb,
  p_ranking_config jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_mode text;
  v_number_of_sets integer;
  v_sets_to_win integer;
BEGIN
  IF COALESCE(p_sport_id, '') = '' THEN
    RAISE EXCEPTION 'sport_id is required';
  END IF;

  IF p_format_type NOT IN ('round_robin_only', 'knockout_only', 'group_then_knockout') THEN
    RAISE EXCEPTION 'Invalid format_type';
  END IF;

  IF p_competition_type NOT IN ('singles', 'doubles', 'team', 'individual_time', 'custom') THEN
    RAISE EXCEPTION 'Invalid competition_type';
  END IF;

  IF jsonb_typeof(COALESCE(p_scoring_config, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Invalid scoring_config';
  END IF;

  PERFORM public.normalize_round_set_modes_v1(COALESCE(p_scoring_config, '{}'::jsonb));

  v_mode := COALESCE(p_scoring_config->>'matchSetMode', 'single');
  v_number_of_sets := COALESCE((p_scoring_config->>'numberOfSets')::integer, CASE WHEN v_mode = 'best_of_3' THEN 3 ELSE 1 END);
  v_sets_to_win := COALESCE((p_scoring_config->>'setsToWin')::integer, CASE WHEN v_mode = 'best_of_3' THEN 2 ELSE 1 END);

  IF v_mode NOT IN ('single', 'best_of_3') THEN
    RAISE EXCEPTION 'Invalid matchSetMode';
  END IF;

  IF v_mode = 'single' AND (v_number_of_sets <> 1 OR v_sets_to_win <> 1) THEN
    RAISE EXCEPTION 'single mode requires numberOfSets=1 and setsToWin=1';
  END IF;

  IF v_mode = 'best_of_3' AND (v_number_of_sets <> 3 OR v_sets_to_win <> 2) THEN
    RAISE EXCEPTION 'best_of_3 mode requires numberOfSets=3 and setsToWin=2';
  END IF;

  IF jsonb_typeof(COALESCE(p_ranking_config, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Invalid ranking_config';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_event_config_v1(
  p_event_id text,
  p_sport_id text,
  p_competition_type text,
  p_format_type text,
  p_scoring_config jsonb,
  p_ranking_config jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_existing public.events%ROWTYPE;
  v_event public.events%ROWTYPE;
BEGIN
  SELECT *
  INTO v_existing
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND';
  END IF;

  PERFORM public.p10_require_event_admin_v1(
    p_event_id,
    'manage_event_config',
    'update_event_config_v1'
  );

  PERFORM public.validate_event_config_v1(
    COALESCE(p_sport_id, v_existing.sport_id),
    COALESCE(p_competition_type, v_existing.competition_type),
    COALESCE(p_format_type, v_existing.format_type),
    COALESCE(p_scoring_config, v_existing.scoring_config, '{}'::jsonb),
    COALESCE(p_ranking_config, v_existing.ranking_config, '{}'::jsonb)
  );

  PERFORM public.assert_round_set_modes_change_allowed_v1(
    p_event_id,
    COALESCE(v_existing.scoring_config, '{}'::jsonb),
    COALESCE(p_scoring_config, v_existing.scoring_config, '{}'::jsonb)
  );

  UPDATE public.events
  SET sport_id = COALESCE(p_sport_id, sport_id),
      competition_type = COALESCE(p_competition_type, competition_type),
      format_type = COALESCE(p_format_type, format_type),
      scoring_config = COALESCE(p_scoring_config, scoring_config),
      ranking_config = COALESCE(p_ranking_config, ranking_config)
  WHERE id = p_event_id
  RETURNING * INTO v_event;

  PERFORM public.log_audit_event_v1(
    'UPDATE_EVENT_CONFIG',
    'event',
    p_event_id,
    jsonb_build_object(
      'old_scoring_config', v_existing.scoring_config,
      'new_scoring_config', v_event.scoring_config,
      'old_ranking_config', v_existing.ranking_config,
      'new_ranking_config', v_event.ranking_config
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', v_event.id,
    'sport_id', v_event.sport_id,
    'competition_type', v_event.competition_type,
    'format_type', v_event.format_type,
    'scoring_config', v_event.scoring_config,
    'ranking_config', v_event.ranking_config
  );
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
  v_ctx jsonb;
  v_match record;
  v_event record;
  v_config jsonb;
  v_mode text;
  v_number_of_sets integer;
  v_max_score integer;
  v_cap_score integer;
  v_win_by_two boolean;
  v_allow_draw boolean;
  v_set_winner_id text;
  v_winner_score integer;
  v_loser_score integer;
  v_sets_a integer;
  v_sets_b integer;
  v_saved_sets integer;
  v_match_status text;
BEGIN
  v_ctx := public.p10_require_match_score_context_v1(p_match_id, 'update_match_set_score_v1');

  SELECT m.*
    INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND';
  END IF;

  IF v_match.status = 'finished' THEN
    RAISE EXCEPTION 'Match is already finished; reset before editing scores';
  END IF;

  IF v_match.team_a_id IS NULL OR v_match.team_b_id IS NULL THEN
    RAISE EXCEPTION 'Match participants are not resolved';
  END IF;

  SELECT e.*
    INTO v_event
  FROM public.events e
  WHERE e.id = v_match.event_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND';
  END IF;

  v_config := CASE
    WHEN COALESCE(v_event.scoring_config, '{}'::jsonb) = '{}'::jsonb THEN (
      SELECT default_settings
      FROM public.sports
      WHERE id = COALESCE(v_event.sport_id, 'sport_pickleball')
    )
    ELSE v_event.scoring_config
  END;

  v_mode := public.get_match_set_mode_v1(p_match_id);
  v_number_of_sets := CASE WHEN v_mode = 'best_of_3' THEN 3 ELSE 1 END;

  IF p_set_number < 1 OR p_set_number > v_number_of_sets THEN
    RAISE EXCEPTION 'p_set_number is outside configured match set range';
  END IF;

  IF v_mode = 'best_of_3' AND p_set_number = 3 THEN
    SELECT
      count(*) FILTER (WHERE winner_id = v_match.team_a_id),
      count(*) FILTER (WHERE winner_id = v_match.team_b_id)
      INTO v_sets_a, v_sets_b
    FROM public.match_sets
    WHERE match_id = p_match_id
      AND set_number IN (1, 2)
      AND deleted_at IS NULL
      AND status = 'finished';

    IF v_sets_a >= 2 OR v_sets_b >= 2 THEN
      RAISE EXCEPTION 'Set 3 is not allowed after a 2-0 result';
    END IF;
  END IF;

  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Scores must be non-negative integers';
  END IF;

  v_max_score := COALESCE((v_config->>'maxScore')::integer, 15);
  v_cap_score := COALESCE((v_config->>'capScore')::integer, v_max_score);
  v_win_by_two := COALESCE((v_config->>'winByTwo')::boolean, true);
  v_allow_draw := COALESCE((v_config->>'allowDraw')::boolean, false);

  IF p_score_a > v_cap_score OR p_score_b > v_cap_score THEN
    RAISE EXCEPTION 'Score exceeds capScore';
  END IF;

  IF p_score_a = p_score_b AND NOT v_allow_draw THEN
    RAISE EXCEPTION 'Draw is not allowed for this event';
  END IF;

  IF p_score_a > p_score_b THEN
    v_set_winner_id := v_match.team_a_id;
    v_winner_score := p_score_a;
    v_loser_score := p_score_b;
  ELSIF p_score_b > p_score_a THEN
    v_set_winner_id := v_match.team_b_id;
    v_winner_score := p_score_b;
    v_loser_score := p_score_a;
  ELSE
    v_set_winner_id := NULL;
    v_winner_score := p_score_a;
    v_loser_score := p_score_b;
  END IF;

  IF v_set_winner_id IS NULL AND NOT v_allow_draw THEN
    RAISE EXCEPTION 'Set winner could not be determined';
  END IF;

  IF v_set_winner_id IS NOT NULL THEN
    IF v_winner_score < v_max_score THEN
      RAISE EXCEPTION 'Winner score must reach maxScore';
    END IF;

    IF v_win_by_two THEN
      IF v_winner_score < v_cap_score AND (v_winner_score - v_loser_score) < 2 THEN
        RAISE EXCEPTION 'Winner must lead by two before capScore';
      END IF;

      IF v_winner_score = v_cap_score AND (v_winner_score - v_loser_score) < 1 THEN
        RAISE EXCEPTION 'Winner must lead at capScore';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.match_sets (
    match_id,
    tenant_id,
    event_id,
    set_number,
    score_a,
    score_b,
    winner_id,
    status,
    updated_at,
    deleted_at
  )
  VALUES (
    p_match_id,
    v_match.tenant_id,
    v_match.event_id,
    p_set_number,
    p_score_a,
    p_score_b,
    v_set_winner_id,
    'finished',
    now(),
    NULL
  )
  ON CONFLICT (match_id, set_number) DO UPDATE
  SET score_a = EXCLUDED.score_a,
      score_b = EXCLUDED.score_b,
      winner_id = EXCLUDED.winner_id,
      status = 'finished',
      updated_at = now(),
      deleted_at = NULL;

  IF v_mode = 'best_of_3' AND p_set_number IN (1, 2) THEN
    SELECT
      count(*) FILTER (WHERE winner_id = v_match.team_a_id),
      count(*) FILTER (WHERE winner_id = v_match.team_b_id)
      INTO v_sets_a, v_sets_b
    FROM public.match_sets
    WHERE match_id = p_match_id
      AND set_number IN (1, 2)
      AND deleted_at IS NULL
      AND status = 'finished';

    IF v_sets_a >= 2 OR v_sets_b >= 2 THEN
      UPDATE public.match_sets
      SET deleted_at = now(),
          status = 'pending',
          updated_at = now()
      WHERE match_id = p_match_id
        AND set_number = 3
        AND deleted_at IS NULL;
    END IF;
  END IF;

  IF v_mode = 'single' THEN
    UPDATE public.match_sets
    SET deleted_at = now(),
        status = 'pending',
        updated_at = now()
    WHERE match_id = p_match_id
      AND set_number > 1
      AND deleted_at IS NULL;
  END IF;

  SELECT
    count(*) FILTER (WHERE winner_id = v_match.team_a_id),
    count(*) FILTER (WHERE winner_id = v_match.team_b_id),
    count(*)
    INTO v_sets_a, v_sets_b, v_saved_sets
  FROM public.match_sets
  WHERE match_id = p_match_id
    AND deleted_at IS NULL
    AND status = 'finished';

  v_match_status := CASE WHEN v_saved_sets > 0 THEN 'playing' ELSE 'pending' END;

  UPDATE public.matches
  SET score_a = v_sets_a,
      score_b = v_sets_b,
      winner_id = NULL,
      status = v_match_status
  WHERE id = p_match_id;

  PERFORM public.log_audit_event_v1(
    'SAVE_MATCH_SET_SCORE',
    'match',
    p_match_id,
    jsonb_build_object(
      'event_id', v_match.event_id,
      'set_number', p_set_number,
      'score_a', p_score_a,
      'score_b', p_score_b,
      'set_winner_id', v_set_winner_id,
      'match_status', v_match_status,
      'matchSetMode', v_mode,
      'round_key', public.get_match_round_key_v1(v_match.group_id, v_match.knockout_round_name, v_match.knockout_match_id)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'match_id', p_match_id,
    'set_number', p_set_number,
    'match_status', v_match_status,
    'winner_id', NULL,
    'score_a', v_sets_a,
    'score_b', v_sets_b
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_match_score_v1(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_match record;
  v_mode text;
  v_sets_to_win integer;
  v_sets_a integer;
  v_sets_b integer;
  v_saved_sets integer;
  v_match_winner_id text;
BEGIN
  v_ctx := public.p10_require_match_score_context_v1(p_match_id, 'finalize_match_score_v1');

  SELECT m.*
    INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND';
  END IF;

  IF v_match.team_a_id IS NULL OR v_match.team_b_id IS NULL THEN
    RAISE EXCEPTION 'Match participants are not resolved';
  END IF;

  v_mode := public.get_match_set_mode_v1(p_match_id);
  v_sets_to_win := CASE WHEN v_mode = 'best_of_3' THEN 2 ELSE 1 END;

  SELECT
    count(*) FILTER (WHERE winner_id = v_match.team_a_id),
    count(*) FILTER (WHERE winner_id = v_match.team_b_id),
    count(*)
    INTO v_sets_a, v_sets_b, v_saved_sets
  FROM public.match_sets
  WHERE match_id = p_match_id
    AND deleted_at IS NULL
    AND status = 'finished'
    AND set_number <= CASE WHEN v_mode = 'best_of_3' THEN 3 ELSE 1 END;

  IF v_saved_sets = 0 THEN
    RAISE EXCEPTION 'No saved set score found for this match';
  END IF;

  IF v_sets_a >= v_sets_to_win AND v_sets_a > v_sets_b THEN
    v_match_winner_id := v_match.team_a_id;
  ELSIF v_sets_b >= v_sets_to_win AND v_sets_b > v_sets_a THEN
    v_match_winner_id := v_match.team_b_id;
  ELSE
    RAISE EXCEPTION 'Match is not ready to finalize';
  END IF;

  UPDATE public.matches
  SET score_a = v_sets_a,
      score_b = v_sets_b,
      winner_id = v_match_winner_id,
      status = 'finished'
  WHERE id = p_match_id;

  PERFORM public.p12_propagate_knockout_winner_v1(p_match_id);

  PERFORM public.log_audit_event_v1(
    'FINALIZE_MATCH_SCORE',
    'match',
    p_match_id,
    jsonb_build_object(
      'event_id', v_match.event_id,
      'winner_id', v_match_winner_id,
      'score_a', v_sets_a,
      'score_b', v_sets_b,
      'matchSetMode', v_mode,
      'round_key', public.get_match_round_key_v1(v_match.group_id, v_match.knockout_round_name, v_match.knockout_match_id)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'match_id', p_match_id,
    'winner_id', v_match_winner_id,
    'score_a', v_sets_a,
    'score_b', v_sets_b,
    'status', 'finished'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_round_set_modes_v1(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_match_round_key_v1(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_match_set_mode_v1(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_round_set_modes_change_allowed_v1(text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_event_config_v1(text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_match_set_score_v1(text, integer, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_match_score_v1(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.normalize_round_set_modes_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_match_round_key_v1(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_match_set_mode_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_event_config_v1(text, text, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_match_set_score_v1(text, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_match_score_v1(text) TO authenticated;
