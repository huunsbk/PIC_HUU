-- Phase 5A: canonical Tenant -> Subscription -> Plan -> Usage entitlement contract.

CREATE OR REPLACE VIEW public.tenant_usage
WITH (security_invoker = true)
AS
SELECT
  t.id AS tenant_id,
  COALESCE(u.users_used, 0::bigint) AS users_used,
  COALESCE(p.max_users, 1) AS users_limit,
  COALESCE(e.events_used, 0::bigint) AS events_used,
  COALESCE(p.max_events, 1) AS events_limit,
  COALESCE(tm.teams_used, 0::bigint) AS teams_used,
  COALESCE(p.max_teams, 50) AS teams_limit
FROM public.tenants t
LEFT JOIN (
  SELECT tenant_id, count(*) AS users_used
  FROM public.accounts
  WHERE deleted_at IS NULL
  GROUP BY tenant_id
) u ON u.tenant_id = t.id
LEFT JOIN (
  SELECT tenant_id, count(*) AS events_used
  FROM public.events
  WHERE deleted_at IS NULL
  GROUP BY tenant_id
) e ON e.tenant_id = t.id
LEFT JOIN (
  SELECT tenant_id, count(*) AS teams_used
  FROM public.teams
  WHERE deleted_at IS NULL
  GROUP BY tenant_id
) tm ON tm.tenant_id = t.id
LEFT JOIN (
  SELECT DISTINCT ON (tenant_id)
    tenant_id,
    plan_id,
    status
  FROM public.tenant_subscriptions
  WHERE status IN ('active', 'trial')
  ORDER BY tenant_id, created_at DESC
) ts ON ts.tenant_id = t.id
LEFT JOIN public.subscription_plans p ON p.id = ts.plan_id;

REVOKE ALL ON public.tenant_usage FROM PUBLIC, anon;
GRANT SELECT ON public.tenant_usage TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_subscriptions_one_current
  ON public.tenant_subscriptions(tenant_id)
  WHERE status IN ('active', 'trial');

CREATE OR REPLACE FUNCTION public.get_tenant_entitlements_v1(
  p_tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := public.current_account_id();
  v_actor_tenant_id uuid := public.current_tenant_id();
  v_actor_role text := public.current_role_name();
  v_target_tenant_id uuid;
  v_tenant public.tenants%ROWTYPE;
  v_subscription public.tenant_subscriptions%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_usage record;
  v_subscription_current boolean;
BEGIN
  IF auth.uid() IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  v_target_tenant_id := COALESCE(p_tenant_id, v_actor_tenant_id);

  IF v_target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_REQUIRED';
  END IF;

  IF v_actor_role <> 'SUPER_ADMIN'
     AND v_target_tenant_id IS DISTINCT FROM v_actor_tenant_id THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT *
  INTO v_tenant
  FROM public.tenants
  WHERE id = v_target_tenant_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND';
  END IF;

  SELECT ts.*
  INTO v_subscription
  FROM public.tenant_subscriptions ts
  WHERE ts.tenant_id = v_target_tenant_id
    AND ts.status IN ('active', 'trial')
  ORDER BY ts.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'tenant', jsonb_build_object(
        'id', v_tenant.id,
        'name', v_tenant.name,
        'slug', v_tenant.slug,
        'status', v_tenant.status
      ),
      'subscription', NULL,
      'plan', NULL,
      'usage', NULL,
      'can_create', jsonb_build_object(
        'accounts', false,
        'events', false,
        'teams', false
      )
    );
  END IF;

  SELECT *
  INTO v_plan
  FROM public.subscription_plans
  WHERE id = v_subscription.plan_id
  LIMIT 1;

  SELECT *
  INTO v_usage
  FROM public.tenant_usage
  WHERE tenant_id = v_target_tenant_id
  LIMIT 1;

  v_subscription_current :=
    v_subscription.status IN ('active', 'trial')
    AND (v_subscription.end_date IS NULL OR v_subscription.end_date >= now())
    AND v_tenant.status = 'active';

  RETURN jsonb_build_object(
    'success', true,
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'name', v_tenant.name,
      'slug', v_tenant.slug,
      'status', v_tenant.status
    ),
    'subscription', jsonb_build_object(
      'id', v_subscription.id,
      'status', v_subscription.status,
      'start_date', v_subscription.start_date,
      'end_date', v_subscription.end_date,
      'auto_renew', v_subscription.auto_renew,
      'is_current', v_subscription_current
    ),
    'plan', jsonb_build_object(
      'id', v_plan.id,
      'name', v_plan.name,
      'description', v_plan.description,
      'max_users', v_plan.max_users,
      'max_events', v_plan.max_events,
      'max_teams', v_plan.max_teams,
      'storage_limit_mb', v_plan.storage_limit_mb
    ),
    'usage', jsonb_build_object(
      'users_used', COALESCE(v_usage.users_used, 0),
      'users_limit', COALESCE(v_usage.users_limit, v_plan.max_users),
      'events_used', COALESCE(v_usage.events_used, 0),
      'events_limit', COALESCE(v_usage.events_limit, v_plan.max_events),
      'teams_used', COALESCE(v_usage.teams_used, 0),
      'teams_limit', COALESCE(v_usage.teams_limit, v_plan.max_teams)
    ),
    'remaining', jsonb_build_object(
      'accounts', GREATEST(COALESCE(v_usage.users_limit, v_plan.max_users) - COALESCE(v_usage.users_used, 0), 0),
      'events', GREATEST(COALESCE(v_usage.events_limit, v_plan.max_events) - COALESCE(v_usage.events_used, 0), 0),
      'teams', GREATEST(COALESCE(v_usage.teams_limit, v_plan.max_teams) - COALESCE(v_usage.teams_used, 0), 0)
    ),
    'can_create', jsonb_build_object(
      'accounts', v_subscription_current AND COALESCE(v_usage.users_used, 0) < COALESCE(v_usage.users_limit, v_plan.max_users),
      'events', v_subscription_current AND COALESCE(v_usage.events_used, 0) < COALESCE(v_usage.events_limit, v_plan.max_events),
      'teams', v_subscription_current AND COALESCE(v_usage.teams_used, 0) < COALESCE(v_usage.teams_limit, v_plan.max_teams)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_entitlements_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_entitlements_v1(uuid) TO authenticated;

