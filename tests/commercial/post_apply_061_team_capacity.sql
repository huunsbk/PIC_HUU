WITH plans AS (
  SELECT public.list_self_service_plans_v1() AS payload
), entitlement_limits AS (
  SELECT se.base_limit + se.addon_limit AS effective_limit, count(*) AS subscription_count
  FROM public.subscription_entitlements se
  WHERE se.resource_type = 'teams_per_event'
  GROUP BY se.base_limit + se.addon_limit
)
SELECT
  (SELECT jsonb_build_object(
    '48', public.commercial_team_capacity_price_v1(48),
    '64', public.commercial_team_capacity_price_v1(64),
    '96', public.commercial_team_capacity_price_v1(96)
  )) AS team_capacity_prices,
  (SELECT payload FROM plans) AS self_service_plans,
  (SELECT COALESCE(jsonb_object_agg(effective_limit, subscription_count), '{}'::jsonb)
   FROM entitlement_limits) AS team_entitlement_counts,
  (SELECT count(*)
   FROM public.tenant_subscriptions ts
   WHERE ts.status IN ('active', 'trial', 'scheduled')
     AND NOT EXISTS (
       SELECT 1
       FROM public.subscription_entitlements se
       WHERE se.subscription_id = ts.id
         AND se.resource_type = 'teams_per_event'
     )) AS subscriptions_missing_team_entitlement,
  (SELECT count(*)
   FROM public.accounts a
   JOIN public.tenants t ON t.id = a.tenant_id
   WHERE t.tenant_type = 'self_service_customer'
     AND a.status = 'active' AND a.deleted_at IS NULL
     AND t.status = 'active' AND t.deleted_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.tenant_subscriptions ts
       WHERE ts.tenant_id = a.tenant_id
         AND ts.status IN ('active', 'trial')
         AND ts.start_date <= now()
         AND (ts.end_date IS NULL OR ts.end_date > now())
     )) AS self_service_accounts_without_active_subscription,
  (SELECT count(*)
   FROM public.accounts a
   JOIN public.tenants t ON t.id = a.tenant_id
   WHERE t.tenant_type = 'self_service_customer'
     AND a.status = 'active' AND a.deleted_at IS NULL
     AND t.status = 'active' AND t.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.tenant_subscriptions ts
       WHERE ts.tenant_id = a.tenant_id
         AND ts.status IN ('active', 'trial')
         AND ts.start_date <= now()
         AND (ts.end_date IS NULL OR ts.end_date > now())
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.tenant_subscriptions ts
       WHERE ts.tenant_id = a.tenant_id AND ts.status = 'scheduled'
     )) AS self_service_accounts_active_without_scheduled_renewal,
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.teams'::regclass
      AND tgname = 'trg_teams_saas_quota_v1'
      AND tgenabled <> 'D'
  ) AS team_quota_trigger_enabled,
  has_function_privilege('service_role', 'public.create_payment_order_v3(uuid,text,text,integer,integer,integer,text)', 'EXECUTE') AS service_can_create_order,
  NOT has_function_privilege('authenticated', 'public.create_payment_order_v3(uuid,text,text,integer,integer,integer,text)', 'EXECUTE') AS authenticated_cannot_create_order_directly,
  has_function_privilege('service_role', 'public.cancel_payment_order_v1(uuid,uuid)', 'EXECUTE') AS service_can_cancel_order,
  NOT has_function_privilege('authenticated', 'public.cancel_payment_order_v1(uuid,uuid)', 'EXECUTE') AS authenticated_cannot_cancel_order_directly,
  has_function_privilege('authenticated', 'public.list_self_service_plans_v1()', 'EXECUTE') AS authenticated_can_list_plans,
  NOT has_function_privilege('anon', 'public.list_self_service_plans_v1()', 'EXECUTE') AS anonymous_cannot_list_plans,
  (SELECT count(*) FROM public.payment_orders WHERE client_request_id LIKE 'test-061-%') AS rollback_test_orders_remaining,
  (SELECT count(*) FROM public.payment_orders
   WHERE status IN ('awaiting_payment', 'manual_review', 'payment_mismatch')) AS open_payment_orders;
