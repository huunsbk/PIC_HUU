-- Content PDF follow-up: allow public route context without leaking permissions.
BEGIN;

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
    AND ten.deleted_at IS NULL
    AND (
      t.slug = p_slug
      OR t.id = p_slug
      OR ten.slug = p_slug
      OR ten.id::text = p_slug
    )
  ORDER BY
    CASE WHEN t.status = 'active' THEN 0 ELSE 1 END,
    t.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_tournament.tournament_id IS NULL THEN
    RAISE EXCEPTION 'Workspace not found';
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'tenant_id', v_tournament.tenant_id,
      'tenant_name', v_tournament.tenant_name,
      'tournament_id', v_tournament.tournament_id,
      'tournament_name', v_tournament.tournament_name,
      'tournament_slug', v_tournament.tournament_slug,
      'user_role', 'guest',
      'permissions', '["view_public"]'::jsonb
    );
  END IF;

  v_account_id := public.current_account_id();
  v_role_name := public.current_role_name();

  IF v_account_id IS NULL OR v_role_name IS NULL THEN
    RAISE EXCEPTION 'Account context not found';
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
GRANT EXECUTE ON FUNCTION public.get_workspace_context_v1(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_context_v1(text) TO authenticated;

COMMIT;
