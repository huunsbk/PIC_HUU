-- Fix update_event_config_v1 for deployments where public.events has no updated_at column.

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

REVOKE ALL ON FUNCTION public.update_event_config_v1(text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_event_config_v1(text, text, text, text, jsonb, jsonb) TO authenticated;
