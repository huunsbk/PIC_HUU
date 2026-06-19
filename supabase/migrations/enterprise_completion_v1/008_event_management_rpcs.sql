-- Prompt 07-G: event/content management RPCs

CREATE INDEX IF NOT EXISTS idx_events_tournament_status
  ON public.events(tournament_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_tournament_name_active
  ON public.events(tournament_id, lower(name))
  WHERE deleted_at IS NULL;

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
  v_match_set_mode text;
  v_number_of_sets integer;
  v_sets_to_win integer;
  v_max_score integer;
  v_cap_score integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.sports
    WHERE id = p_sport_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Sport not found';
  END IF;

  IF p_format_type NOT IN ('round_robin_only', 'knockout_only', 'group_then_knockout') THEN
    RAISE EXCEPTION 'Invalid format_type: %', p_format_type;
  END IF;

  IF p_competition_type NOT IN ('singles', 'doubles', 'team', 'individual_time', 'custom') THEN
    RAISE EXCEPTION 'Invalid competition_type: %', p_competition_type;
  END IF;

  v_match_set_mode := COALESCE(p_scoring_config->>'matchSetMode', 'single');
  v_number_of_sets := COALESCE((p_scoring_config->>'numberOfSets')::integer, 1);
  v_sets_to_win := COALESCE((p_scoring_config->>'setsToWin')::integer, 1);
  v_max_score := COALESCE((p_scoring_config->>'maxScore')::integer, 15);
  v_cap_score := COALESCE((p_scoring_config->>'capScore')::integer, v_max_score);

  IF v_match_set_mode NOT IN ('single', 'best_of_3') THEN
    RAISE EXCEPTION 'Invalid matchSetMode: %', v_match_set_mode;
  END IF;

  IF v_match_set_mode = 'single' AND (v_number_of_sets <> 1 OR v_sets_to_win <> 1) THEN
    RAISE EXCEPTION 'single mode requires numberOfSets=1 and setsToWin=1';
  END IF;

  IF v_match_set_mode = 'best_of_3' AND (v_number_of_sets <> 3 OR v_sets_to_win <> 2) THEN
    RAISE EXCEPTION 'best_of_3 mode requires numberOfSets=3 and setsToWin=2';
  END IF;

  IF v_max_score <= 0 THEN
    RAISE EXCEPTION 'maxScore must be greater than 0';
  END IF;

  IF v_cap_score < v_max_score THEN
    RAISE EXCEPTION 'capScore must be greater than or equal to maxScore';
  END IF;

  IF p_scoring_config ? 'winByTwo'
    AND jsonb_typeof(p_scoring_config->'winByTwo') <> 'boolean'
  THEN
    RAISE EXCEPTION 'winByTwo must be boolean';
  END IF;

  IF p_scoring_config ? 'allowDraw'
    AND jsonb_typeof(p_scoring_config->'allowDraw') <> 'boolean'
  THEN
    RAISE EXCEPTION 'allowDraw must be boolean';
  END IF;

  IF p_ranking_config ? 'groupCount'
    AND (
      (p_ranking_config->>'groupCount')::integer < 1
      OR (p_ranking_config->>'groupCount')::integer > 32
    )
  THEN
    RAISE EXCEPTION 'groupCount must be between 1 and 32';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_manage_event_for_tournament_v1(p_tournament_id text)
RETURNS public.tournament
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_tournament public.tournament%ROWTYPE;
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_tournament
  FROM public.tournament
  WHERE id = p_tournament_id
    AND deleted_at IS NULL;

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'Tournament not found';
  END IF;

  v_role := public.current_role_name();

  IF v_role = 'SUPER_ADMIN' THEN
    RETURN v_tournament;
  END IF;

  IF v_role = 'TENANT_ADMIN'
    AND v_tournament.tenant_id = public.current_tenant_id()
    AND public.has_permission('manage_events')
  THEN
    RETURN v_tournament;
  END IF;

  RAISE EXCEPTION 'Permission denied: manage_events required';
END;
$$;

CREATE OR REPLACE FUNCTION public.list_events_by_tournament_v1(p_tournament_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_tournament public.tournament%ROWTYPE;
  v_role text;
  v_account_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_tournament
  FROM public.tournament
  WHERE id = p_tournament_id
    AND deleted_at IS NULL;

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'Tournament not found';
  END IF;

  v_role := public.current_role_name();
  v_account_id := public.current_account_id();

  IF v_role = 'SUPER_ADMIN'
    OR (v_role = 'TENANT_ADMIN' AND v_tournament.tenant_id = public.current_tenant_id())
  THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.name), '[]'::jsonb)
      FROM public.events e
      WHERE e.tournament_id = p_tournament_id
        AND e.deleted_at IS NULL
    );
  END IF;

  IF v_role IN ('EVENT_ADMIN', 'REFEREE') THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.name), '[]'::jsonb)
      FROM public.events e
      JOIN public.account_event_permissions aep ON aep.event_id = e.id
      WHERE e.tournament_id = p_tournament_id
        AND e.deleted_at IS NULL
        AND aep.deleted_at IS NULL
        AND aep.account_id = v_account_id
        AND aep.tenant_id = v_tournament.tenant_id
    );
  END IF;

  RAISE EXCEPTION 'Permission denied for list_events_by_tournament_v1';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_event_v1(
  p_tournament_id text,
  p_name text,
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
  v_tournament public.tournament%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_event_id text;
BEGIN
  v_tournament := public.ensure_manage_event_for_tournament_v1(p_tournament_id);

  IF NULLIF(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Event name is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.tournament_id = p_tournament_id
      AND e.deleted_at IS NULL
      AND lower(e.name) = lower(trim(p_name))
  ) THEN
    RAISE EXCEPTION 'Event name already exists in this tournament';
  END IF;

  PERFORM public.validate_event_config_v1(
    p_sport_id,
    p_competition_type,
    p_format_type,
    COALESCE(p_scoring_config, '{}'::jsonb),
    COALESCE(p_ranking_config, '{}'::jsonb)
  );

  v_event_id := 'evt_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.events(
    id,
    name,
    settings,
    tenant_id,
    tournament_id,
    slug,
    status,
    sport_id,
    competition_type,
    format_type,
    scoring_config,
    ranking_config
  )
  VALUES (
    v_event_id,
    trim(p_name),
    '{}'::jsonb,
    v_tournament.tenant_id,
    p_tournament_id,
    v_event_id,
    'active',
    p_sport_id,
    p_competition_type,
    p_format_type,
    COALESCE(p_scoring_config, '{}'::jsonb),
    COALESCE(p_ranking_config, '{}'::jsonb)
  )
  RETURNING * INTO v_event;

  PERFORM public.log_audit_event_v1(
    'CREATE_EVENT',
    'event',
    v_event.id,
    jsonb_build_object(
      'event', to_jsonb(v_event),
      'tournament_id', p_tournament_id,
      'tenant_id', v_tournament.tenant_id
    )
  );

  RETURN jsonb_build_object('success', true, 'event', to_jsonb(v_event), 'event_id', v_event.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_event_v1(
  p_event_id text,
  p_name text,
  p_sport_id text,
  p_competition_type text,
  p_format_type text,
  p_scoring_config jsonb,
  p_ranking_config jsonb,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_existing public.events%ROWTYPE;
  v_tournament public.tournament%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_role text;
BEGIN
  SELECT *
  INTO v_existing
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  SELECT *
  INTO v_tournament
  FROM public.tournament
  WHERE id = v_existing.tournament_id
    AND deleted_at IS NULL;

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'Tournament not found';
  END IF;

  v_role := public.current_role_name();

  IF NOT (
    v_role = 'SUPER_ADMIN'
    OR (v_role = 'TENANT_ADMIN' AND v_tournament.tenant_id = public.current_tenant_id() AND public.has_permission('manage_events'))
    OR (v_role = 'EVENT_ADMIN' AND public.has_event_access(p_event_id))
  ) THEN
    RAISE EXCEPTION 'Permission denied for update_event_v1';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('draft', 'active', 'completed', 'archived') THEN
    RAISE EXCEPTION 'Invalid event status';
  END IF;

  PERFORM public.validate_event_config_v1(
    COALESCE(p_sport_id, v_existing.sport_id),
    COALESCE(p_competition_type, v_existing.competition_type),
    COALESCE(p_format_type, v_existing.format_type),
    COALESCE(p_scoring_config, v_existing.scoring_config),
    COALESCE(p_ranking_config, v_existing.ranking_config)
  );

  UPDATE public.events
  SET
    name = COALESCE(NULLIF(trim(p_name), ''), name),
    sport_id = COALESCE(p_sport_id, sport_id),
    competition_type = COALESCE(p_competition_type, competition_type),
    format_type = COALESCE(p_format_type, format_type),
    scoring_config = COALESCE(p_scoring_config, scoring_config),
    ranking_config = COALESCE(p_ranking_config, ranking_config),
    status = COALESCE(p_status, status),
    archived_at = CASE WHEN p_status = 'archived' THEN now() WHEN p_status = 'active' THEN NULL ELSE archived_at END
  WHERE id = p_event_id
  RETURNING * INTO v_event;

  PERFORM public.log_audit_event_v1(
    'UPDATE_EVENT',
    'event',
    p_event_id,
    jsonb_build_object('old', to_jsonb(v_existing), 'new', to_jsonb(v_event))
  );

  RETURN jsonb_build_object('success', true, 'event', to_jsonb(v_event), 'event_id', v_event.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_event_v1(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  RETURN public.update_event_v1(p_event_id, NULL, NULL, NULL, NULL, NULL, NULL, 'archived');
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_event_v1(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  RETURN public.update_event_v1(p_event_id, NULL, NULL, NULL, NULL, NULL, NULL, 'active');
END;
$$;

REVOKE ALL ON FUNCTION public.validate_event_config_v1(text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_manage_event_for_tournament_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_events_by_tournament_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_event_v1(text, text, text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_event_v1(text, text, text, text, text, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_event_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_event_v1(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.validate_event_config_v1(text, text, text, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_manage_event_for_tournament_v1(text) FROM anon;
REVOKE ALL ON FUNCTION public.list_events_by_tournament_v1(text) FROM anon;
REVOKE ALL ON FUNCTION public.create_event_v1(text, text, text, text, text, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.update_event_v1(text, text, text, text, text, jsonb, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.archive_event_v1(text) FROM anon;
REVOKE ALL ON FUNCTION public.restore_event_v1(text) FROM anon;

GRANT EXECUTE ON FUNCTION public.list_events_by_tournament_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_v1(text, text, text, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_event_v1(text, text, text, text, text, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_event_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_event_v1(text) TO authenticated;
