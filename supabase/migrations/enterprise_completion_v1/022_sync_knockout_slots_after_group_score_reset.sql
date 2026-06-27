-- Keep resolved KO teams in sync when group-stage scores are reset or changed.
BEGIN;

CREATE OR REPLACE FUNCTION public.p22_assert_group_stage_change_allowed_v1(p_match_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_match record;
  v_blocking_count integer := 0;
BEGIN
  SELECT m.*
    INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND OR v_match.group_id = 'knockout' THEN
    RETURN;
  END IF;

  SELECT count(*)::integer
    INTO v_blocking_count
  FROM public.knockout_slots ks
  JOIN public.matches km
    ON km.id = ks.match_id
   AND km.event_id = ks.event_id
   AND km.tenant_id = ks.tenant_id
   AND km.deleted_at IS NULL
  WHERE ks.event_id = v_match.event_id
    AND ks.tenant_id = v_match.tenant_id
    AND ks.deleted_at IS NULL
    AND (
      ks.group_id = v_match.group_id
      OR ks.source_type = 'best_third'
    )
    AND (
      km.status <> 'pending'
      OR EXISTS (
        SELECT 1
        FROM public.match_sets ms
        WHERE ms.match_id = km.id
          AND ms.deleted_at IS NULL
      )
    );

  IF v_blocking_count > 0 THEN
    RAISE EXCEPTION 'Cannot change group-stage score because related knockout matches already have scores or are in progress';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.p22_sync_knockout_after_group_stage_change_v1(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_match record;
BEGIN
  SELECT m.*
    INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND OR v_match.group_id = 'knockout' THEN
    RETURN jsonb_build_object('success', true, 'synced', false);
  END IF;

  RETURN public.resolve_knockout_slots_v1(v_match.event_id);
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
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND';
  END IF;

  IF v_match.group_id <> 'knockout' THEN
    PERFORM public.p22_assert_group_stage_change_allowed_v1(p_match_id);
  END IF;

  v_result := public.p10_core_reset_match_score_v1(p_match_id);

  IF v_match.group_id = 'knockout' THEN
    PERFORM public.p12_reset_knockout_downstream_v1(p_match_id);
  ELSE
    v_sync_result := public.p22_sync_knockout_after_group_stage_change_v1(p_match_id);
  END IF;

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('knockout_sync', v_sync_result);
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
  v_match record;
  v_result jsonb;
  v_sync_result jsonb := NULL;
BEGIN
  PERFORM public.p10_require_match_score_context_v1(p_match_id, 'update_match_score_v1');

  SELECT m.*
    INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND';
  END IF;

  IF v_match.group_id <> 'knockout' THEN
    PERFORM public.p22_assert_group_stage_change_allowed_v1(p_match_id);
  END IF;

  v_result := public.p10_core_update_match_score_v1(p_match_id, p_score_a, p_score_b);

  IF v_match.group_id = 'knockout' THEN
    PERFORM public.p12_propagate_knockout_winner_v1(p_match_id);
  ELSE
    v_sync_result := public.p22_sync_knockout_after_group_stage_change_v1(p_match_id);
  END IF;

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('knockout_sync', v_sync_result);
END;
$$;

REVOKE ALL ON FUNCTION public.p22_assert_group_stage_change_allowed_v1(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.p22_sync_knockout_after_group_stage_change_v1(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reset_match_score_v1(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_match_score_v1(text, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.reset_match_score_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_match_score_v1(text, integer, integer) TO authenticated;

COMMIT;
