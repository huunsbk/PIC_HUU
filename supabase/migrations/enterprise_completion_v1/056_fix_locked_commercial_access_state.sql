-- Locked self-service accounts do not have subscription or usage records yet.
-- Avoid dereferencing unassigned PL/pgSQL records on the unlock screen.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_commercial_access_state_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account record;
  v_subscription record;
  v_usage jsonb := NULL;
  v_entitlements jsonb := '[]'::jsonb;
  v_state text;
  v_has_subscription boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT
    a.id AS account_id,
    a.tenant_id,
    a.status AS account_status,
    t.name AS tenant_name,
    t.slug AS tenant_slug,
    t.status AS tenant_status,
    t.tenant_type,
    sscp.onboarding_status
  INTO v_account
  FROM public.accounts a
  JOIN public.tenants t ON t.id = a.tenant_id
  LEFT JOIN public.self_service_customer_profiles sscp ON sscp.account_id = a.id
  WHERE a.user_id = auth.uid()
    AND a.deleted_at IS NULL
    AND t.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND';
  END IF;

  IF v_account.tenant_type <> 'self_service_customer' THEN
    RETURN jsonb_build_object(
      'success', true,
      'commercial_state', 'not_applicable',
      'tenant_type', v_account.tenant_type,
      'business_access_active', true
    );
  END IF;

  SELECT
    ts.id,
    ts.status,
    ts.start_date,
    ts.end_date,
    ts.plan_id,
    sp.code AS plan_code,
    sp.name AS plan_name,
    sp.duration_days
  INTO v_subscription
  FROM public.tenant_subscriptions ts
  JOIN public.subscription_plans sp ON sp.id = ts.plan_id
  WHERE ts.tenant_id = v_account.tenant_id
    AND ts.status IN ('active', 'trial')
    AND ts.start_date <= now()
    AND (ts.end_date IS NULL OR ts.end_date > now())
    AND sp.is_active = true
  ORDER BY ts.created_at DESC
  LIMIT 1;

  v_has_subscription := FOUND;

  IF v_has_subscription THEN
    v_state := 'active';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'resource_type', se.resource_type,
      'base_limit', se.base_limit,
      'addon_limit', se.addon_limit,
      'effective_limit', se.base_limit + se.addon_limit
    ) ORDER BY se.resource_type), '[]'::jsonb)
    INTO v_entitlements
    FROM public.subscription_entitlements se
    WHERE se.subscription_id = v_subscription.id;

    SELECT to_jsonb(tu) INTO v_usage
    FROM public.tenant_usage tu
    WHERE tu.tenant_id = v_account.tenant_id;
  ELSE
    v_state := CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.tenant_subscriptions ts
        WHERE ts.tenant_id = v_account.tenant_id
      ) THEN 'expired'
      ELSE 'locked'
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'commercial_state', v_state,
    'business_access_active', v_state = 'active',
    'tenant', jsonb_build_object(
      'id', v_account.tenant_id,
      'name', v_account.tenant_name,
      'slug', v_account.tenant_slug,
      'type', v_account.tenant_type,
      'status', v_account.tenant_status
    ),
    'account', jsonb_build_object(
      'id', v_account.account_id,
      'status', v_account.account_status,
      'onboarding_status', v_account.onboarding_status
    ),
    'subscription', CASE WHEN NOT v_has_subscription THEN NULL ELSE jsonb_build_object(
      'id', v_subscription.id,
      'status', v_subscription.status,
      'start_date', v_subscription.start_date,
      'end_date', v_subscription.end_date,
      'plan_id', v_subscription.plan_id,
      'plan_code', v_subscription.plan_code,
      'plan_name', v_subscription.plan_name,
      'duration_days', v_subscription.duration_days
    ) END,
    'entitlements', v_entitlements,
    'usage', v_usage,
    'server_time', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_commercial_access_state_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commercial_access_state_v1() TO authenticated;

COMMIT;
