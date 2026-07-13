-- Phase 6A: versioned sport catalog and event ruleset enforcement for
-- set-based sports supported by the current scoring engine.

ALTER TABLE public.sports
  ADD COLUMN IF NOT EXISTS ruleset_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS default_ranking_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS sport_ruleset_version integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sports_ruleset_version_positive'
      AND conrelid = 'public.sports'::regclass
  ) THEN
    ALTER TABLE public.sports
      ADD CONSTRAINT sports_ruleset_version_positive CHECK (ruleset_version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sports_capabilities_object'
      AND conrelid = 'public.sports'::regclass
  ) THEN
    ALTER TABLE public.sports
      ADD CONSTRAINT sports_capabilities_object CHECK (jsonb_typeof(capabilities) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sports_default_ranking_object'
      AND conrelid = 'public.sports'::regclass
  ) THEN
    ALTER TABLE public.sports
      ADD CONSTRAINT sports_default_ranking_object CHECK (jsonb_typeof(default_ranking_config) = 'object');
  END IF;
END $$;

INSERT INTO public.sports (
  id,
  name,
  slug,
  scoring_type,
  default_settings,
  ruleset_version,
  capabilities,
  default_ranking_config,
  updated_at,
  deleted_at
)
VALUES
  (
    'sport_pickleball',
    'Pickleball',
    'pickleball',
    'sets',
    '{"matchSetMode":"single","numberOfSets":1,"setsToWin":1,"maxScore":15,"capScore":17,"winByTwo":true,"allowDraw":false}'::jsonb,
    1,
    '{"engine":"set_points_v1","supportedMatchSetModes":["single","best_of_3"],"competitionTypes":["singles","doubles","team","custom"],"supportsRoundRules":true,"allowsDraw":false,"participantLabel":"Đội/VĐV"}'::jsonb,
    '{"pointsWin":2,"pointsLoss":1,"pointsDraw":0,"tieBreakers":["points","setDiff","pointDiff","pointsWon","headToHead"]}'::jsonb,
    now(),
    NULL
  ),
  (
    'sport_badminton',
    'Cầu lông',
    'badminton',
    'sets',
    '{"matchSetMode":"best_of_3","numberOfSets":3,"setsToWin":2,"maxScore":21,"capScore":30,"winByTwo":true,"allowDraw":false}'::jsonb,
    1,
    '{"engine":"set_points_v1","supportedMatchSetModes":["single","best_of_3"],"competitionTypes":["singles","doubles","team"],"supportsRoundRules":true,"allowsDraw":false,"participantLabel":"Đội/VĐV"}'::jsonb,
    '{"pointsWin":2,"pointsLoss":0,"pointsDraw":0,"tieBreakers":["points","setDiff","pointDiff","pointsWon","headToHead"]}'::jsonb,
    now(),
    NULL
  ),
  (
    'sport_table_tennis',
    'Bóng bàn',
    'table-tennis',
    'sets',
    '{"matchSetMode":"best_of_3","numberOfSets":3,"setsToWin":2,"maxScore":11,"capScore":21,"winByTwo":true,"allowDraw":false}'::jsonb,
    1,
    '{"engine":"set_points_v1","supportedMatchSetModes":["single","best_of_3"],"competitionTypes":["singles","doubles","team"],"supportsRoundRules":true,"allowsDraw":false,"participantLabel":"Đội/VĐV"}'::jsonb,
    '{"pointsWin":2,"pointsLoss":0,"pointsDraw":0,"tieBreakers":["points","setDiff","pointDiff","pointsWon","headToHead"]}'::jsonb,
    now(),
    NULL
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  scoring_type = EXCLUDED.scoring_type,
  default_settings = EXCLUDED.default_settings,
  ruleset_version = EXCLUDED.ruleset_version,
  capabilities = EXCLUDED.capabilities,
  default_ranking_config = EXCLUDED.default_ranking_config,
  updated_at = now(),
  deleted_at = NULL;

UPDATE public.events e
SET sport_ruleset_version = s.ruleset_version
FROM public.sports s
WHERE s.id = e.sport_id
  AND e.sport_ruleset_version IS DISTINCT FROM s.ruleset_version;

CREATE OR REPLACE FUNCTION public.list_active_sports_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_account_id() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'slug', s.slug,
      'scoring_type', s.scoring_type,
      'default_settings', s.default_settings,
      'default_ranking_config', s.default_ranking_config,
      'ruleset_version', s.ruleset_version,
      'capabilities', s.capabilities
    ) ORDER BY CASE s.id WHEN 'sport_pickleball' THEN 0 WHEN 'sport_badminton' THEN 1 ELSE 2 END, s.name)
    FROM public.sports s
    WHERE s.deleted_at IS NULL
  ), '[]'::jsonb);
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
  v_sport public.sports%ROWTYPE;
  v_mode text;
  v_number_of_sets integer;
  v_sets_to_win integer;
  v_max_score integer;
  v_cap_score integer;
  v_rules jsonb;
  v_round record;
BEGIN
  IF NULLIF(btrim(p_sport_id), '') IS NULL THEN
    RAISE EXCEPTION 'SPORT_REQUIRED';
  END IF;

  SELECT * INTO v_sport
  FROM public.sports
  WHERE id = p_sport_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SPORT_NOT_SUPPORTED';
  END IF;

  IF v_sport.scoring_type <> 'sets'
     OR v_sport.capabilities->>'engine' <> 'set_points_v1' THEN
    RAISE EXCEPTION 'SPORT_SCORING_ENGINE_NOT_SUPPORTED';
  END IF;

  IF p_format_type NOT IN ('round_robin_only', 'knockout_only', 'group_then_knockout') THEN
    RAISE EXCEPTION 'INVALID_FORMAT_TYPE';
  END IF;

  IF NOT COALESCE(v_sport.capabilities->'competitionTypes', '[]'::jsonb) ? p_competition_type THEN
    RAISE EXCEPTION 'COMPETITION_TYPE_NOT_SUPPORTED_FOR_SPORT';
  END IF;

  IF jsonb_typeof(COALESCE(p_scoring_config, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_SCORING_CONFIG';
  END IF;

  IF jsonb_typeof(COALESCE(p_ranking_config, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_RANKING_CONFIG';
  END IF;

  v_mode := COALESCE(p_scoring_config->>'matchSetMode', v_sport.default_settings->>'matchSetMode', 'single');
  v_number_of_sets := COALESCE(
    (p_scoring_config->>'numberOfSets')::integer,
    (v_sport.default_settings->>'numberOfSets')::integer,
    CASE WHEN v_mode = 'best_of_3' THEN 3 ELSE 1 END
  );
  v_sets_to_win := COALESCE(
    (p_scoring_config->>'setsToWin')::integer,
    (v_sport.default_settings->>'setsToWin')::integer,
    CASE WHEN v_mode = 'best_of_3' THEN 2 ELSE 1 END
  );
  v_max_score := COALESCE((p_scoring_config->>'maxScore')::integer, (v_sport.default_settings->>'maxScore')::integer);
  v_cap_score := COALESCE((p_scoring_config->>'capScore')::integer, (v_sport.default_settings->>'capScore')::integer, v_max_score);

  IF NOT COALESCE(v_sport.capabilities->'supportedMatchSetModes', '[]'::jsonb) ? v_mode THEN
    RAISE EXCEPTION 'MATCH_SET_MODE_NOT_SUPPORTED_FOR_SPORT';
  END IF;

  IF v_mode = 'single' AND (v_number_of_sets <> 1 OR v_sets_to_win <> 1) THEN
    RAISE EXCEPTION 'single mode requires numberOfSets=1 and setsToWin=1';
  END IF;

  IF v_mode = 'best_of_3' AND (v_number_of_sets <> 3 OR v_sets_to_win <> 2) THEN
    RAISE EXCEPTION 'best_of_3 mode requires numberOfSets=3 and setsToWin=2';
  END IF;

  IF v_max_score IS NULL OR v_max_score < 1 OR v_cap_score < v_max_score THEN
    RAISE EXCEPTION 'INVALID_SPORT_SCORE_LIMITS';
  END IF;

  IF COALESCE((p_scoring_config->>'allowDraw')::boolean, false)
     AND NOT COALESCE((v_sport.capabilities->>'allowsDraw')::boolean, false) THEN
    RAISE EXCEPTION 'DRAW_NOT_SUPPORTED_FOR_SPORT';
  END IF;

  v_rules := public.normalize_round_scoring_rules_v1(COALESCE(p_scoring_config, v_sport.default_settings));
  FOR v_round IN SELECT key, value FROM jsonb_each(v_rules)
  LOOP
    IF NOT COALESCE(v_sport.capabilities->'supportedMatchSetModes', '[]'::jsonb) ? (v_round.value->>'matchSetMode') THEN
      RAISE EXCEPTION 'ROUND_MATCH_SET_MODE_NOT_SUPPORTED_FOR_SPORT: %', v_round.key;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_event_sport_ruleset_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_sport public.sports%ROWTYPE;
BEGIN
  SELECT * INTO v_sport
  FROM public.sports
  WHERE id = NEW.sport_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SPORT_NOT_SUPPORTED';
  END IF;

  IF COALESCE(NEW.scoring_config, '{}'::jsonb) = '{}'::jsonb THEN
    NEW.scoring_config := v_sport.default_settings;
  END IF;

  IF COALESCE(NEW.ranking_config, '{}'::jsonb) = '{}'::jsonb THEN
    NEW.ranking_config := v_sport.default_ranking_config;
  END IF;

  PERFORM public.validate_event_config_v1(
    NEW.sport_id,
    NEW.competition_type,
    NEW.format_type,
    NEW.scoring_config,
    NEW.ranking_config
  );

  NEW.sport_ruleset_version := v_sport.ruleset_version;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_sport_ruleset_v1 ON public.events;
CREATE TRIGGER trg_events_sport_ruleset_v1
BEFORE INSERT OR UPDATE OF sport_id, competition_type, format_type, scoring_config, ranking_config
ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.enforce_event_sport_ruleset_v1();

REVOKE ALL ON FUNCTION public.list_active_sports_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_sports_v1() TO authenticated;
REVOKE ALL ON FUNCTION public.validate_event_config_v1(text, text, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_event_sport_ruleset_v1()
  FROM PUBLIC, anon, authenticated;

