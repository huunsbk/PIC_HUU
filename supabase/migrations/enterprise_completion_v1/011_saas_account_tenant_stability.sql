-- Enterprise SaaS account/tenant stability hardening.
-- - create_tenant_v1 now provisions an Enterprise subscription; tenant_usage is a view.
-- - existing active tenants missing subscription/usage are backfilled.
-- - tenant_usage is a read-only view and is reconciled through subscriptions/current rows.
-- - cross-tenant account_event_permissions are soft-deleted.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH enterprise_plan AS (
  SELECT id
  FROM public.subscription_plans
  WHERE name = 'Enterprise' AND is_active = true
  ORDER BY monthly_price DESC
  LIMIT 1
),
fallback_plan AS (
  SELECT id
  FROM public.subscription_plans
  WHERE is_active = true
  ORDER BY monthly_price DESC
  LIMIT 1
),
selected_plan AS (
  SELECT id FROM enterprise_plan
  UNION ALL
  SELECT id FROM fallback_plan
  WHERE NOT EXISTS (SELECT 1 FROM enterprise_plan)
  LIMIT 1
)
INSERT INTO public.tenant_subscriptions (
  id,
  tenant_id,
  plan_id,
  status,
  start_date,
  end_date,
  auto_renew,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  t.id,
  sp.id,
  'active',
  now(),
  now() + interval '1 year',
  true,
  now(),
  now()
FROM public.tenants t
CROSS JOIN selected_plan sp
WHERE t.deleted_at IS NULL
  AND t.status = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM public.tenant_subscriptions ts
    WHERE ts.tenant_id = t.id
      AND ts.status IN ('active', 'trial')
  );

UPDATE public.account_event_permissions aep
SET deleted_at = now()
FROM public.accounts a, public.events e
WHERE a.id = aep.account_id
  AND e.id = aep.event_id
  AND aep.deleted_at IS NULL
  AND a.tenant_id IS DISTINCT FROM e.tenant_id;

CREATE OR REPLACE FUNCTION public.create_tenant_v1(p_name text, p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
BEGIN
  PERFORM public.ensure_manage_tenants_v1();

  IF NULLIF(trim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Tenant name is required';
  END IF;

  IF NULLIF(trim(p_slug), '') IS NULL THEN
    RAISE EXCEPTION 'Tenant slug is required';
  END IF;

  SELECT *
  INTO v_plan
  FROM public.subscription_plans
  WHERE is_active = true
  ORDER BY (name = 'Enterprise') DESC, monthly_price DESC
  LIMIT 1;

  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'No active subscription plan found';
  END IF;

  INSERT INTO public.tenants(name, slug, status)
  VALUES (trim(p_name), lower(trim(p_slug)), 'active')
  RETURNING * INTO v_tenant;

  INSERT INTO public.tenant_subscriptions(
    id,
    tenant_id,
    plan_id,
    status,
    start_date,
    end_date,
    auto_renew,
    created_at,
    updated_at
  )
  VALUES (
    gen_random_uuid(),
    v_tenant.id,
    v_plan.id,
    'active',
    now(),
    now() + interval '1 year',
    true,
    now(),
    now()
  );

  INSERT INTO public.audit_logs(tenant_id, action, details, timestamp)
  VALUES (v_tenant.id, 'tenant.create', 'Created tenant ' || v_tenant.slug || ' with plan ' || v_plan.name, now()::text);

  RETURN jsonb_build_object(
    'success', true,
    'tenant_id', v_tenant.id,
    'name', v_tenant.name,
    'slug', v_tenant.slug,
    'status', v_tenant.status,
    'plan', v_plan.name
  );
END;
$$;

COMMIT;
