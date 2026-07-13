DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_events_lock_scored_sport_v1'
      AND tgrelid = 'public.events'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'sport change lock trigger is missing';
  END IF;

  IF has_function_privilege('authenticated', 'public.prevent_scored_event_sport_change_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'internal sport lock function is exposed to authenticated';
  END IF;
END;
$$;
