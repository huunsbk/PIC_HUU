-- Prompt 07-F: tournament management RPCs

ALTER TABLE public.tournament
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

ALTER TABLE public.tournament
  ADD COLUMN IF NOT EXISTS slug text;

ALTER TABLE public.tournament
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

ALTER TABLE public.tournament
  ADD COLUMN IF NOT EXISTS start_date date;

ALTER TABLE public.tournament
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_tournament_tenant_id
  ON public.tournament(tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS tournament_tenant_slug_unique_idx
  ON public.tournament(tenant_id, slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tournament_status
  ON public.tournament(status);

CREATE OR REPLACE FUNCTION public.ensure_manage_tournaments_v1(p_tenant_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_current_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.current_role_name() = 'SUPER_ADMIN' THEN
    RETURN;
  END IF;

  v_current_tenant := public.current_tenant_id();

  IF NOT public.has_permission('manage_tournaments') THEN
    RAISE EXCEPTION 'Permission denied: manage_tournaments required';
  END IF;

  IF p_tenant_id IS NOT NULL AND p_tenant_id <> v_current_tenant THEN
    RAISE EXCEPTION 'Cross-tenant tournament operation denied';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_tournaments_v1(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF public.current_role_name() = 'SUPER_ADMIN' THEN
    v_tenant_id := p_tenant_id;
  ELSE
    v_tenant_id := public.current_tenant_id();
    PERFORM public.ensure_manage_tournaments_v1(v_tenant_id);
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'tournament_id', t.id,
        'id', t.id,
        'tenant_id', t.tenant_id,
        'name', t.name,
        'slug', t.slug,
        'location', t.location,
        'start_date', COALESCE(t.start_date::text, t.date),
        'status', COALESCE(t.status, 'active'),
        'created_at', t.created_at,
        'updated_at', t.updated_at,
        'events_count', (SELECT count(*) FROM public.events e WHERE e.tournament_id = t.id AND e.deleted_at IS NULL),
        'teams_count', (SELECT count(*) FROM public.teams tm WHERE tm.tournament_id = t.id AND tm.deleted_at IS NULL),
        'matches_count', (SELECT count(*) FROM public.matches m WHERE m.tournament_id = t.id AND m.deleted_at IS NULL)
      )
      ORDER BY t.created_at DESC NULLS LAST
    ), '[]'::jsonb)
    FROM public.tournament t
    WHERE t.deleted_at IS NULL
      AND (v_tenant_id IS NULL OR t.tenant_id = v_tenant_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_tournament_v1(
  p_tenant_id uuid,
  p_name text,
  p_slug text,
  p_location text DEFAULT NULL,
  p_start_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_tournament public.tournament%ROWTYPE;
BEGIN
  PERFORM public.ensure_manage_tournaments_v1(p_tenant_id);

  IF NULLIF(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Tournament name is required';
  END IF;

  IF NULLIF(trim(p_slug), '') IS NULL THEN
    RAISE EXCEPTION 'Tournament slug is required';
  END IF;

  INSERT INTO public.tournament(id, tenant_id, name, slug, location, start_date, date, status, settings)
  VALUES (
    'tournament-' || gen_random_uuid()::text,
    p_tenant_id,
    trim(p_name),
    lower(trim(p_slug)),
    p_location,
    p_start_date,
    COALESCE(p_start_date::text, ''),
    'active',
    '{}'::jsonb
  )
  RETURNING * INTO v_tournament;

  RETURN to_jsonb(v_tournament);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_tournament_v1(
  p_tournament_id text,
  p_name text DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_existing public.tournament%ROWTYPE;
  v_tournament public.tournament%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.tournament
  WHERE id = p_tournament_id
    AND deleted_at IS NULL;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'Tournament not found';
  END IF;

  PERFORM public.ensure_manage_tournaments_v1(v_existing.tenant_id);

  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'archived', 'completed', 'draft') THEN
    RAISE EXCEPTION 'Invalid tournament status';
  END IF;

  UPDATE public.tournament
  SET
    name = COALESCE(NULLIF(trim(p_name), ''), name),
    slug = COALESCE(NULLIF(lower(trim(p_slug)), ''), slug),
    location = COALESCE(p_location, location),
    start_date = COALESCE(p_start_date, start_date),
    date = COALESCE(p_start_date::text, date),
    status = COALESCE(p_status, status),
    updated_at = now()
  WHERE id = p_tournament_id
  RETURNING * INTO v_tournament;

  RETURN to_jsonb(v_tournament);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_tournament_v1(p_tournament_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  RETURN public.update_tournament_v1(p_tournament_id, NULL, NULL, NULL, NULL, 'archived');
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_tournament_v1(p_tournament_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  RETURN public.update_tournament_v1(p_tournament_id, NULL, NULL, NULL, NULL, 'active');
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_manage_tournaments_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_tournaments_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_tournament_v1(uuid, text, text, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_tournament_v1(text, text, text, text, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_tournament_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_tournament_v1(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.ensure_manage_tournaments_v1(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.list_tournaments_v1(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.create_tournament_v1(uuid, text, text, text, date) FROM anon;
REVOKE ALL ON FUNCTION public.update_tournament_v1(text, text, text, text, date, text) FROM anon;
REVOKE ALL ON FUNCTION public.archive_tournament_v1(text) FROM anon;
REVOKE ALL ON FUNCTION public.restore_tournament_v1(text) FROM anon;

GRANT EXECUTE ON FUNCTION public.list_tournaments_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tournament_v1(uuid, text, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_tournament_v1(text, text, text, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_tournament_v1(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_tournament_v1(text) TO authenticated;
