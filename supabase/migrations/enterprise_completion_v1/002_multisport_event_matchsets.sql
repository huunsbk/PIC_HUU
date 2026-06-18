-- Enterprise Completion V1 - Prompt 04
-- Multi-sport foundation, event configuration, and match_sets.
--
-- This migration does not reset data and does not touch auth.users.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.sports (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  scoring_type text DEFAULT 'sets',
  default_settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

INSERT INTO public.sports (
  id,
  name,
  slug,
  scoring_type,
  default_settings
)
VALUES (
  'sport_pickleball',
  'Pickleball',
  'pickleball',
  'sets',
  '{
    "maxScore": 15,
    "capScore": 17,
    "winByTwo": true,
    "matchSetMode": "single",
    "setsToWin": 1,
    "numberOfSets": 1
  }'::jsonb
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    scoring_type = EXCLUDED.scoring_type,
    default_settings = EXCLUDED.default_settings,
    updated_at = now(),
    deleted_at = NULL;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS sport_id text REFERENCES public.sports(id),
  ADD COLUMN IF NOT EXISTS competition_type text DEFAULT 'doubles',
  ADD COLUMN IF NOT EXISTS format_type text DEFAULT 'group_then_knockout',
  ADD COLUMN IF NOT EXISTS scoring_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ranking_config jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.events
SET sport_id = COALESCE(sport_id, 'sport_pickleball'),
    competition_type = COALESCE(competition_type, 'doubles'),
    format_type = COALESCE(format_type, 'group_then_knockout'),
    scoring_config = CASE
      WHEN scoring_config = '{}'::jsonb THEN (
        SELECT default_settings
        FROM public.sports
        WHERE id = 'sport_pickleball'
      )
      ELSE scoring_config
    END,
    ranking_config = CASE
      WHEN ranking_config = '{}'::jsonb THEN '{
        "pointsWin": 2,
        "pointsLoss": 1,
        "tieBreakers": ["points", "pointDiff", "pointsWon", "headToHead"]
      }'::jsonb
      ELSE ranking_config
    END
WHERE sport_id IS NULL
   OR competition_type IS NULL
   OR format_type IS NULL
   OR scoring_config = '{}'::jsonb
   OR ranking_config = '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_format_type_check'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_format_type_check
      CHECK (format_type IN ('round_robin_only', 'knockout_only', 'group_then_knockout'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_competition_type_check'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_competition_type_check
      CHECK (competition_type IN ('singles', 'doubles', 'team', 'individual_time', 'custom'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_scoring_config_shape_check'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_scoring_config_shape_check
      CHECK (
        jsonb_typeof(scoring_config) = 'object'
        AND (
          NOT scoring_config ? 'matchSetMode'
          OR scoring_config->>'matchSetMode' IN ('single', 'best_of_3')
        )
        AND (
          NOT scoring_config ? 'numberOfSets'
          OR (scoring_config->>'numberOfSets')::integer IN (1, 3)
        )
        AND (
          NOT scoring_config ? 'setsToWin'
          OR (scoring_config->>'setsToWin')::integer IN (1, 2)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_ranking_config_shape_check'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_ranking_config_shape_check
      CHECK (jsonb_typeof(ranking_config) = 'object');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.match_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id text NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  event_id text NOT NULL REFERENCES public.events(id),
  set_number integer NOT NULL,
  score_a integer,
  score_b integer,
  winner_id text REFERENCES public.teams(id),
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT uq_match_set_number UNIQUE (match_id, set_number),
  CONSTRAINT match_sets_set_number_check CHECK (set_number > 0),
  CONSTRAINT match_sets_score_a_check CHECK (score_a IS NULL OR score_a >= 0),
  CONSTRAINT match_sets_score_b_check CHECK (score_b IS NULL OR score_b >= 0),
  CONSTRAINT match_sets_status_check CHECK (status IN ('pending', 'playing', 'finished'))
);

CREATE INDEX IF NOT EXISTS idx_match_sets_match_id
ON public.match_sets(match_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_match_sets_event_id
ON public.match_sets(event_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_sport_id
ON public.events(sport_id)
WHERE deleted_at IS NULL;

ALTER TABLE public.sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sports_select_active_authenticated ON public.sports;
DROP POLICY IF EXISTS sports_admin_write ON public.sports;
DROP POLICY IF EXISTS match_sets_select_scoped ON public.match_sets;
DROP POLICY IF EXISTS match_sets_insert_scoped ON public.match_sets;
DROP POLICY IF EXISTS match_sets_update_scoped ON public.match_sets;
DROP POLICY IF EXISTS match_sets_delete_scoped ON public.match_sets;

CREATE POLICY sports_select_active_authenticated
ON public.sports
FOR SELECT
TO authenticated
USING (deleted_at IS NULL);

CREATE POLICY sports_admin_write
ON public.sports
FOR ALL
TO authenticated
USING (public.current_role_name() = 'SUPER_ADMIN')
WITH CHECK (public.current_role_name() = 'SUPER_ADMIN');

CREATE POLICY match_sets_select_scoped
ON public.match_sets
FOR SELECT
TO authenticated
USING (
  public.current_role_name() = 'SUPER_ADMIN'
  OR tenant_id = public.current_tenant_id()
  OR public.has_event_access(event_id)
);

CREATE POLICY match_sets_insert_scoped
ON public.match_sets
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN'
  OR (
    tenant_id = public.current_tenant_id()
    AND (
      public.current_role_name() = 'TENANT_ADMIN'
      OR (
        public.has_event_access(event_id)
        AND (
          public.has_permission('enter_scores')
          OR public.has_permission('manage_matches')
        )
      )
    )
  )
);

CREATE POLICY match_sets_update_scoped
ON public.match_sets
FOR UPDATE
TO authenticated
USING (
  public.current_role_name() = 'SUPER_ADMIN'
  OR (
    tenant_id = public.current_tenant_id()
    AND (
      public.current_role_name() = 'TENANT_ADMIN'
      OR (
        public.has_event_access(event_id)
        AND (
          public.has_permission('enter_scores')
          OR public.has_permission('manage_matches')
        )
      )
    )
  )
)
WITH CHECK (
  public.current_role_name() = 'SUPER_ADMIN'
  OR (
    tenant_id = public.current_tenant_id()
    AND (
      public.current_role_name() = 'TENANT_ADMIN'
      OR (
        public.has_event_access(event_id)
        AND (
          public.has_permission('enter_scores')
          OR public.has_permission('manage_matches')
        )
      )
    )
  )
);

CREATE POLICY match_sets_delete_scoped
ON public.match_sets
FOR DELETE
TO authenticated
USING (
  public.current_role_name() = 'SUPER_ADMIN'
  OR (
    tenant_id = public.current_tenant_id()
    AND (
      public.current_role_name() = 'TENANT_ADMIN'
      OR (
        public.has_event_access(event_id)
        AND public.has_permission('manage_matches')
      )
    )
  )
);

REVOKE ALL ON public.sports FROM PUBLIC;
REVOKE ALL ON public.sports FROM anon;
REVOKE ALL ON public.sports FROM authenticated;
REVOKE ALL ON public.match_sets FROM PUBLIC;
REVOKE ALL ON public.match_sets FROM anon;
REVOKE ALL ON public.match_sets FROM authenticated;

GRANT SELECT ON public.sports TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.sports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_sets TO authenticated;

COMMIT;
