-- Phase 6C: preserve sport semantics once an event has live or scored matches.

CREATE OR REPLACE FUNCTION public.prevent_scored_event_sport_change_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF NEW.sport_id IS NOT DISTINCT FROM OLD.sport_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.event_id = OLD.id
      AND m.deleted_at IS NULL
      AND (
        m.status IN ('playing', 'finished')
        OR m.score_a IS NOT NULL
        OR m.score_b IS NOT NULL
        OR m.winner_id IS NOT NULL
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.match_sets ms
    WHERE ms.event_id = OLD.id
      AND ms.deleted_at IS NULL
      AND (
        ms.status IN ('playing', 'finished')
        OR ms.score_a IS NOT NULL
        OR ms.score_b IS NOT NULL
        OR ms.winner_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'SPORT_CHANGE_LOCKED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_lock_scored_sport_v1 ON public.events;
CREATE TRIGGER trg_events_lock_scored_sport_v1
BEFORE UPDATE OF sport_id ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.prevent_scored_event_sport_change_v1();

REVOKE ALL ON FUNCTION public.prevent_scored_event_sport_change_v1()
  FROM PUBLIC, anon, authenticated;
