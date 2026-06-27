-- Add a score-entry status RPC so playing/pending is persisted for TV display.
BEGIN;

CREATE OR REPLACE FUNCTION public.update_match_status_v1(
  p_match_id text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_match record;
  v_has_saved_scores boolean := false;
BEGIN
  PERFORM public.p10_require_match_score_context_v1(p_match_id, 'update_match_status_v1');

  IF p_status NOT IN ('pending', 'playing') THEN
    RAISE EXCEPTION 'Match status must be pending or playing';
  END IF;

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
    RAISE EXCEPTION 'Finished match status cannot be changed here';
  END IF;

  IF p_status = 'playing' AND (v_match.team_a_id IS NULL OR v_match.team_b_id IS NULL) THEN
    RAISE EXCEPTION 'Match participants are not resolved';
  END IF;

  IF p_status = 'pending' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.match_sets ms
      WHERE ms.match_id = p_match_id
        AND ms.deleted_at IS NULL
        AND (ms.score_a IS NOT NULL OR ms.score_b IS NOT NULL)
    )
      INTO v_has_saved_scores;

    IF v_has_saved_scores THEN
      RAISE EXCEPTION 'Cannot set match back to pending while saved set scores exist';
    END IF;
  END IF;

  UPDATE public.matches
  SET status = p_status
  WHERE id = p_match_id
    AND deleted_at IS NULL;

  PERFORM public.log_audit_event_v1(
    'update_match_status_v1',
    'match',
    p_match_id,
    jsonb_build_object('from_status', v_match.status, 'to_status', p_status)
  );

  RETURN jsonb_build_object(
    'success', true,
    'match_id', p_match_id,
    'status', p_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_match_status_v1(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_match_status_v1(text, text) TO authenticated;

COMMIT;
