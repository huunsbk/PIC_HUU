-- Give SUPER_ADMIN a tenant-aware, policy-safe path for helping tenants that
-- do not yet have an active tournament.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_tenant_tournament_summary_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_account_id() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF public.current_role_name() <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Permission denied: SUPER_ADMIN required';
  END IF;

  RETURN (
    SELECT COALESCE(
      jsonb_agg(summary.row_data ORDER BY summary.tenant_name),
      '[]'::jsonb
    )
    FROM (
      SELECT
        ten.name AS tenant_name,
        jsonb_build_object(
          'tenant_id', ten.id,
          'tenant_name', ten.name,
          'tenant_slug', ten.slug,
          'tenant_status', COALESCE(ten.status, 'active'),
          'tenant_type', ten.tenant_type,
          'onboarding_status', sscp.onboarding_status,
          'business_access_active', public.business_access_active_v1(ten.id),
          'subscription_status', subscription.status,
          'subscription_end_date', subscription.end_date,
          'active_tournament_count', (
            SELECT count(*)
            FROM public.tournament tournament
            WHERE tournament.tenant_id = ten.id
              AND tournament.deleted_at IS NULL
              AND COALESCE(tournament.status, 'active') <> 'archived'
          ),
          'archived_tournament_count', (
            SELECT count(*)
            FROM public.tournament tournament
            WHERE tournament.tenant_id = ten.id
              AND tournament.deleted_at IS NULL
              AND COALESCE(tournament.status, 'active') = 'archived'
          ),
          'account_count', (
            SELECT count(*)
            FROM public.accounts account
            WHERE account.tenant_id = ten.id
              AND account.deleted_at IS NULL
              AND account.status = 'active'
          )
        ) AS row_data
      FROM public.tenants ten
      LEFT JOIN public.self_service_customer_profiles sscp
        ON sscp.tenant_id = ten.id
      LEFT JOIN LATERAL (
        SELECT subscription_row.status, subscription_row.end_date
        FROM public.tenant_subscriptions subscription_row
        WHERE subscription_row.tenant_id = ten.id
        ORDER BY
          CASE
            WHEN subscription_row.status IN ('active', 'trial', 'scheduled')
              AND subscription_row.start_date <= now()
              AND (subscription_row.end_date IS NULL OR subscription_row.end_date > now())
            THEN 0
            ELSE 1
          END,
          subscription_row.created_at DESC
        LIMIT 1
      ) subscription ON true
      WHERE ten.deleted_at IS NULL
        AND COALESCE(ten.status, 'active') <> 'archived'
    ) summary
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_ensure_self_service_workspace_v1(
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_actor_account_id uuid := public.current_account_id();
  v_owner_account_id uuid;
  v_tenant record;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_actor_account_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF public.current_role_name() <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Permission denied: SUPER_ADMIN required';
  END IF;

  SELECT
    ten.id,
    ten.name,
    ten.status,
    ten.tenant_type,
    sscp.account_id,
    sscp.onboarding_status
  INTO v_tenant
  FROM public.tenants ten
  LEFT JOIN public.self_service_customer_profiles sscp
    ON sscp.tenant_id = ten.id
  WHERE ten.id = p_tenant_id
    AND ten.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND';
  END IF;

  IF COALESCE(v_tenant.status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'TENANT_NOT_ACTIVE';
  END IF;

  IF v_tenant.tenant_type <> 'self_service_customer' THEN
    RAISE EXCEPTION 'SELF_SERVICE_TENANT_REQUIRED';
  END IF;

  IF v_tenant.onboarding_status <> 'ready' OR v_tenant.account_id IS NULL THEN
    RAISE EXCEPTION 'SELF_SERVICE_OWNER_NOT_READY';
  END IF;

  PERFORM public.ensure_business_access_v1(p_tenant_id);
  v_owner_account_id := v_tenant.account_id;

  v_result := public.provision_self_service_workspace_v1(
    p_tenant_id,
    v_owner_account_id
  );

  INSERT INTO public.audit_logs(
    timestamp,
    action,
    details,
    created_at,
    tenant_id,
    actor_account_id,
    actor_role,
    category,
    entity_type,
    entity_id,
    result,
    details_json
  )
  VALUES (
    to_char(now(), 'HH24:MI:SS DD/MM/YYYY'),
    'SELF_SERVICE_WORKSPACE_ENSURED_BY_ADMIN',
    jsonb_build_object(
      'target_tenant_id', p_tenant_id,
      'owner_account_id', v_owner_account_id,
      'created', COALESCE((v_result->>'created')::boolean, false)
    )::text,
    now(),
    p_tenant_id,
    v_actor_account_id,
    'SUPER_ADMIN',
    'operations',
    'tenant',
    p_tenant_id::text,
    'allow',
    jsonb_build_object(
      'owner_account_id', v_owner_account_id,
      'created', COALESCE((v_result->>'created')::boolean, false),
      'source', 'super_admin_assistance'
    )
  );

  RETURN v_result || jsonb_build_object('assisted_by_super_admin', true);
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
  v_actor_account_id uuid := public.current_account_id();
  v_tenant public.tenants%ROWTYPE;
  v_tournament public.tournament%ROWTYPE;
BEGIN
  PERFORM public.ensure_manage_tournaments_v1(p_tenant_id);

  SELECT *
  INTO v_tenant
  FROM public.tenants
  WHERE id = p_tenant_id
    AND deleted_at IS NULL;

  IF v_tenant.id IS NULL THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND';
  END IF;

  IF COALESCE(v_tenant.status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'TENANT_NOT_ACTIVE';
  END IF;

  IF v_tenant.tenant_type = 'self_service_customer' THEN
    RAISE EXCEPTION 'SELF_SERVICE_WORKSPACE_MANAGED_BY_SYSTEM';
  END IF;

  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Tournament name is required';
  END IF;

  IF NULLIF(btrim(p_slug), '') IS NULL THEN
    RAISE EXCEPTION 'Tournament slug is required';
  END IF;

  INSERT INTO public.tournament(
    id,
    tenant_id,
    name,
    slug,
    location,
    start_date,
    date,
    status,
    settings
  )
  VALUES (
    'tournament-' || gen_random_uuid()::text,
    p_tenant_id,
    btrim(p_name),
    lower(btrim(p_slug)),
    p_location,
    p_start_date,
    COALESCE(p_start_date::text, ''),
    'active',
    '{}'::jsonb
  )
  RETURNING * INTO v_tournament;

  INSERT INTO public.audit_logs(
    timestamp,
    action,
    details,
    created_at,
    tenant_id,
    actor_account_id,
    actor_role,
    category,
    entity_type,
    entity_id,
    result,
    details_json
  )
  VALUES (
    to_char(now(), 'HH24:MI:SS DD/MM/YYYY'),
    'TOURNAMENT_CREATED',
    jsonb_build_object(
      'tournament_id', v_tournament.id,
      'slug', v_tournament.slug
    )::text,
    now(),
    p_tenant_id,
    v_actor_account_id,
    public.current_role_name(),
    'operations',
    'tournament',
    v_tournament.id,
    'allow',
    jsonb_build_object('slug', v_tournament.slug)
  );

  RETURN to_jsonb(v_tournament);
END;
$$;

REVOKE ALL ON FUNCTION public.list_tenant_tournament_summary_v1()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tenant_tournament_summary_v1()
  TO authenticated;

REVOKE ALL ON FUNCTION public.admin_ensure_self_service_workspace_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ensure_self_service_workspace_v1(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.create_tournament_v1(uuid, text, text, text, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tournament_v1(uuid, text, text, text, date)
  TO authenticated;

COMMIT;
