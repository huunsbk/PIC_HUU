-- Prompt 07-C: context scope hardening
-- Separates tenant, tournament, and event context.

ALTER TABLE public.tournament
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

ALTER TABLE public.tournament
  ADD COLUMN IF NOT EXISTS slug text;

ALTER TABLE public.tournament
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournament' AND column_name = 'tenant_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tournament_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.tournament
      ADD CONSTRAINT tournament_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'tournament_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_tournament_id_fkey'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_tournament_id_fkey
      FOREIGN KEY (tournament_id) REFERENCES public.tournament(id);
  END IF;
END $$;

DO $$
DECLARE
  v_table text;
  v_constraint text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['teams', 'groups', 'matches', 'match_sets']
  LOOP
    v_constraint := v_table || '_event_id_fkey';
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_table AND column_name = 'event_id'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = v_constraint
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (event_id) REFERENCES public.events(id)',
        v_table,
        v_constraint
      );
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_tournament_tenant_id
  ON public.tournament(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tournament_tenant_slug
  ON public.tournament(tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_events_tournament_id
  ON public.events(tournament_id);

CREATE INDEX IF NOT EXISTS idx_teams_event_id_partial
  ON public.teams(event_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_groups_event_id_partial
  ON public.groups(event_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_matches_event_id_partial
  ON public.matches(event_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_match_sets_event_id_partial
  ON public.match_sets(event_id)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_workspace_context_v1(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
  v_role_name text;
  v_tournament record;
  v_permissions text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_account_id := public.current_account_id();
  v_role_name := public.current_role_name();

  IF v_account_id IS NULL OR v_role_name IS NULL THEN
    RAISE EXCEPTION 'Account context not found';
  END IF;

  SELECT
    t.id AS tournament_id,
    t.name AS tournament_name,
    t.slug AS tournament_slug,
    t.tenant_id,
    ten.name AS tenant_name
  INTO v_tournament
  FROM public.tournament t
  JOIN public.tenants ten ON ten.id = t.tenant_id
  WHERE t.deleted_at IS NULL
    AND (
      t.slug = p_slug
      OR t.id = p_slug
    )
  LIMIT 1;

  IF v_tournament.tournament_id IS NULL THEN
    RAISE EXCEPTION 'Workspace not found';
  END IF;

  IF v_role_name <> 'SUPER_ADMIN'
    AND NOT public.has_permission('manage_tournaments')
    AND NOT EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.id = v_account_id
        AND a.tenant_id = v_tournament.tenant_id
        AND a.status = 'active'
    )
  THEN
    RAISE EXCEPTION 'Access denied for workspace';
  END IF;

  SELECT array_agg(DISTINCT permission_name ORDER BY permission_name)
  INTO v_permissions
  FROM (
    SELECT p.name AS permission_name
    FROM public.accounts a
    JOIN public.role_permissions rp ON rp.role_id = a.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE a.id = v_account_id
    UNION
    SELECT p.name AS permission_name
    FROM public.account_permissions ap
    JOIN public.permissions p ON p.id = ap.permission_id
    WHERE ap.account_id = v_account_id
  ) permissions_union;

  RETURN jsonb_build_object(
    'tenant_id', v_tournament.tenant_id,
    'tenant_name', v_tournament.tenant_name,
    'tournament_id', v_tournament.tournament_id,
    'tournament_name', v_tournament.tournament_name,
    'tournament_slug', v_tournament.tournament_slug,
    'user_role', v_role_name,
    'permissions', COALESCE(to_jsonb(v_permissions), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_context_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_workspace_context_v1(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_context_v1(text) TO authenticated;
