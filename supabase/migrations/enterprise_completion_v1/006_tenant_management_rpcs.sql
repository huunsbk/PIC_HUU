-- Prompt 07-E: tenant management RPCs

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_unique_idx
  ON public.tenants(slug)
  WHERE status <> 'archived';

CREATE INDEX IF NOT EXISTS idx_tenants_status
  ON public.tenants(status);

CREATE OR REPLACE FUNCTION public.ensure_manage_tenants_v1()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.current_role_name() <> 'SUPER_ADMIN'
    AND NOT public.has_permission('manage_tenants')
  THEN
    RAISE EXCEPTION 'Permission denied: manage_tenants required';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_tenants_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  PERFORM public.ensure_manage_tenants_v1();

  RETURN (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', ten.id,
        'tenant_id', ten.id,
        'name', ten.name,
        'slug', ten.slug,
        'status', COALESCE(ten.status, 'active'),
        'created_at', ten.created_at,
        'updated_at', ten.updated_at,
        'tournament_count', (
          SELECT count(*) FROM public.tournament t
          WHERE t.tenant_id = ten.id AND t.deleted_at IS NULL
        ),
        'account_count', (
          SELECT count(*) FROM public.accounts a
          WHERE a.tenant_id = ten.id AND a.status = 'active'
        )
      )
      ORDER BY ten.created_at DESC NULLS LAST
    )
    FROM public.tenants ten
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_tenant_v1(p_name text, p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
BEGIN
  PERFORM public.ensure_manage_tenants_v1();

  IF NULLIF(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Tenant name is required';
  END IF;

  IF NULLIF(trim(p_slug), '') IS NULL THEN
    RAISE EXCEPTION 'Tenant slug is required';
  END IF;

  INSERT INTO public.tenants(name, slug, status)
  VALUES (trim(p_name), lower(trim(p_slug)), 'active')
  RETURNING * INTO v_tenant;

  RETURN to_jsonb(v_tenant);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_tenant_v1(p_tenant_id uuid, p_name text, p_slug text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
BEGIN
  PERFORM public.ensure_manage_tenants_v1();

  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'suspended', 'archived') THEN
    RAISE EXCEPTION 'Invalid tenant status';
  END IF;

  UPDATE public.tenants
  SET
    name = COALESCE(NULLIF(trim(p_name), ''), name),
    slug = COALESCE(NULLIF(lower(trim(p_slug)), ''), slug),
    status = COALESCE(p_status, status),
    updated_at = now()
  WHERE id = p_tenant_id
  RETURNING * INTO v_tenant;

  IF v_tenant.id IS NULL THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  RETURN to_jsonb(v_tenant);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_tenant_v1(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  RETURN public.update_tenant_v1(p_tenant_id, NULL, NULL, 'archived');
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_tenant_v1(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  RETURN public.update_tenant_v1(p_tenant_id, NULL, NULL, 'active');
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_manage_tenants_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_tenants_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_tenant_v1(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_tenant_v1(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_tenant_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_tenant_v1(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.ensure_manage_tenants_v1() FROM anon;
REVOKE ALL ON FUNCTION public.list_tenants_v1() FROM anon;
REVOKE ALL ON FUNCTION public.create_tenant_v1(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.update_tenant_v1(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.archive_tenant_v1(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.restore_tenant_v1(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.list_tenants_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tenant_v1(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_tenant_v1(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_tenant_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_tenant_v1(uuid) TO authenticated;
