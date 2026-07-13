WITH expected_sports(id, max_score, cap_score) AS (
  VALUES
    ('sport_pickleball'::text, 15, 17),
    ('sport_badminton'::text, 21, 30),
    ('sport_table_tennis'::text, 11, 21)
), missing_or_invalid_sports AS (
  SELECT expected_sports.id
  FROM expected_sports
  LEFT JOIN public.sports sports ON sports.id = expected_sports.id
  WHERE sports.id IS NULL
     OR sports.deleted_at IS NOT NULL
     OR sports.ruleset_version < 1
     OR sports.scoring_type <> 'sets'
     OR (sports.default_settings->>'maxScore')::integer <> expected_sports.max_score
     OR (sports.default_settings->>'capScore')::integer <> expected_sports.cap_score
), events_without_ruleset AS (
  SELECT id
  FROM public.events
  WHERE sport_id IS NULL
     OR sport_ruleset_version IS NULL
), trigger_missing AS (
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_events_sport_ruleset_v1'
      AND NOT tgisinternal
  ) AS missing
)
SELECT jsonb_build_object(
  'success',
    NOT EXISTS (SELECT 1 FROM missing_or_invalid_sports)
    AND NOT EXISTS (SELECT 1 FROM events_without_ruleset)
    AND NOT (SELECT missing FROM trigger_missing)
    AND has_function_privilege('authenticated', 'public.list_active_sports_v1()'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.validate_event_config_v1(text,text,text,jsonb,jsonb)'::regprocedure, 'EXECUTE'),
  'missing_or_invalid_sports', COALESCE((SELECT jsonb_agg(id) FROM missing_or_invalid_sports), '[]'::jsonb),
  'events_without_ruleset', COALESCE((SELECT jsonb_agg(id) FROM events_without_ruleset), '[]'::jsonb)
) AS multisport_ruleset_047;

