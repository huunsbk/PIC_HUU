-- Save a completed set and finalize the match atomically when a winner is known.
-- Also prevent destructive knockout resets once a downstream match has started.
BEGIN;

CREATE OR REPLACE FUNCTION public.p65_assert_knockout_reset_allowed_v1(p_match_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_blocking_match_id text;
BEGIN
  WITH RECURSIVE downstream AS (
    SELECT m.next_match_id AS match_id
    FROM public.matches m
    WHERE m.id = p_match_id
      AND m.deleted_at IS NULL
      AND m.group_id = 'knockout'

    UNION ALL

    SELECT m.next_match_id
    FROM downstream d
    JOIN public.matches m
      ON m.id = d.match_id
     AND m.deleted_at IS NULL
    WHERE d.match_id IS NOT NULL
  )
  SELECT m.id
    INTO v_blocking_match_id
  FROM downstream d
  JOIN public.matches m
    ON m.id = d.match_id
   AND m.deleted_at IS NULL
  WHERE m.status <> 'pending'
     OR m.winner_id IS NOT NULL
     OR m.score_a IS NOT NULL
     OR m.score_b IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM public.match_sets ms
       WHERE ms.match_id = m.id
         AND ms.deleted_at IS NULL
         AND (
           ms.status <> 'pending'
           OR ms.score_a IS NOT NULL
           OR ms.score_b IS NOT NULL
           OR ms.winner_id IS NOT NULL
         )
     )
  LIMIT 1;

  IF v_blocking_match_id IS NOT NULL THEN
    RAISE EXCEPTION 'Không thể reset vì trận KO phía sau (%) đã bắt đầu hoặc có kết quả. Hãy reset từ vòng cuối quay ngược lại.', v_blocking_match_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_and_maybe_finalize_match_set_v1(
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
  v_match record;
  v_mode text;
  v_sets_to_win integer;
  v_sets_a integer := 0;
  v_sets_b integer := 0;
  v_save_result jsonb;
  v_finalize_result jsonb;
  v_knockout_sync jsonb := NULL;
BEGIN
  PERFORM public.p10_require_match_score_context_v1(
    p_match_id,
    'save_and_maybe_finalize_match_set_v1'
  );

  SELECT m.*
    INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND';
  END IF;

  IF v_match.status = 'finished' THEN
    RAISE EXCEPTION 'Trận đã chốt. Hãy reset trước khi nhập lại điểm.';
  END IF;

  IF v_match.group_id <> 'knockout' THEN
    PERFORM public.p22_assert_group_stage_change_allowed_v1(p_match_id);
  END IF;

  -- The set must be persisted and validated before finalization is considered.
  v_save_result := public.update_match_set_score_v1(
    p_match_id,
    p_set_number,
    p_score_a,
    p_score_b
  );

  v_mode := public.get_match_set_mode_v1(p_match_id);
  v_sets_to_win := CASE WHEN v_mode = 'best_of_3' THEN 2 ELSE 1 END;

  SELECT
    count(*) FILTER (WHERE ms.winner_id = v_match.team_a_id),
    count(*) FILTER (WHERE ms.winner_id = v_match.team_b_id)
    INTO v_sets_a, v_sets_b
  FROM public.match_sets ms
  WHERE ms.match_id = p_match_id
    AND ms.deleted_at IS NULL
    AND ms.status = 'finished'
    AND ms.set_number <= CASE WHEN v_mode = 'best_of_3' THEN 3 ELSE 1 END;

  IF v_sets_a >= v_sets_to_win OR v_sets_b >= v_sets_to_win THEN
    v_finalize_result := public.finalize_match_score_v1(p_match_id);

    IF v_match.group_id <> 'knockout' THEN
      v_knockout_sync := public.p22_sync_knockout_after_group_stage_change_v1(p_match_id);
    END IF;

    PERFORM public.log_audit_event_v1(
      'AUTO_FINALIZE_MATCH_SCORE',
      'match',
      p_match_id,
      jsonb_build_object(
        'event_id', v_match.event_id,
        'set_number', p_set_number,
        'score_a', p_score_a,
        'score_b', p_score_b,
        'winner_id', v_finalize_result->>'winner_id',
        'matchSetMode', v_mode
      )
    );

    RETURN COALESCE(v_save_result, '{}'::jsonb)
      || COALESCE(v_finalize_result, '{}'::jsonb)
      || jsonb_build_object(
        'auto_finalized', true,
        'match_status', 'finished',
        'knockout_sync', v_knockout_sync
      );
  END IF;

  RETURN COALESCE(v_save_result, '{}'::jsonb)
    || jsonb_build_object(
      'auto_finalized', false,
      'match_status', 'playing'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_match_score_v1(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_match record;
  v_result jsonb;
  v_sync_result jsonb := NULL;
BEGIN
  PERFORM public.p10_require_match_score_context_v1(p_match_id, 'reset_match_score_v1');

  SELECT m.*
    INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND';
  END IF;

  IF v_match.group_id = 'knockout' THEN
    PERFORM public.p65_assert_knockout_reset_allowed_v1(p_match_id);
  ELSE
    PERFORM public.p22_assert_group_stage_change_allowed_v1(p_match_id);
  END IF;

  v_result := public.p10_core_reset_match_score_v1(p_match_id);

  IF v_match.group_id = 'knockout' THEN
    PERFORM public.p12_reset_knockout_downstream_v1(p_match_id);
  ELSE
    v_sync_result := public.p22_sync_knockout_after_group_stage_change_v1(p_match_id);
  END IF;

  RETURN COALESCE(v_result, '{}'::jsonb)
    || jsonb_build_object('knockout_sync', v_sync_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_match_score_for_reentry_v1(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_match record;
  v_result jsonb;
BEGIN
  PERFORM public.p10_require_match_score_context_v1(
    p_match_id,
    'reset_match_score_for_reentry_v1'
  );

  SELECT m.*
    INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND';
  END IF;

  v_result := public.reset_match_score_v1(p_match_id);

  UPDATE public.matches
  SET status = 'playing'
  WHERE id = p_match_id
    AND deleted_at IS NULL;

  PERFORM public.log_audit_event_v1(
    'RESET_MATCH_SCORE_FOR_REENTRY',
    'match',
    p_match_id,
    jsonb_build_object(
      'event_id', v_match.event_id,
      'previous_status', v_match.status,
      'new_status', 'playing'
    )
  );

  RETURN COALESCE(v_result, '{}'::jsonb)
    || jsonb_build_object('status', 'playing');
END;
$$;

REVOKE ALL ON FUNCTION public.p65_assert_knockout_reset_allowed_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_and_maybe_finalize_match_set_v1(text, integer, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reset_match_score_v1(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reset_match_score_for_reentry_v1(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_and_maybe_finalize_match_set_v1(text, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_match_score_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_match_score_for_reentry_v1(text) TO authenticated;

COMMIT;
