SELECT
  (
    SELECT count(*) = 4
      AND min(price_vnd) = 20000
      AND max(price_vnd) = 200000
    FROM public.subscription_plans
    WHERE code IN ('SELF_3D', 'SELF_7D', 'SELF_30D', 'SELF_60D')
      AND billing_model = 'duration'
      AND is_active = true
  ) AS four_duration_plans_ready,
  to_regclass('public.payment_orders') IS NOT NULL AS payment_orders_exists,
  to_regclass('public.payment_order_items') IS NOT NULL AS payment_order_items_exists,
  to_regclass('public.subscription_entitlements') IS NOT NULL AS subscription_entitlements_exists,
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.payment_orders'::regclass
  ) AS payment_orders_rls_enabled,
  NOT has_table_privilege('authenticated', 'public.payment_orders', 'INSERT') AS authenticated_cannot_insert_orders,
  NOT has_table_privilege('authenticated', 'public.subscription_entitlements', 'UPDATE') AS authenticated_cannot_update_entitlements,
  to_regprocedure('public.list_self_service_plans_v1()') IS NOT NULL AS plans_rpc_exists,
  to_regprocedure('public.get_commercial_access_state_v1()') IS NOT NULL AS access_state_rpc_exists,
  has_function_privilege(
    'authenticated',
    'public.list_self_service_plans_v1()'::regprocedure,
    'EXECUTE'
  ) AS authenticated_can_list_plans,
  has_function_privilege(
    'authenticated',
    'public.get_commercial_access_state_v1()'::regprocedure,
    'EXECUTE'
  ) AS authenticated_can_read_access_state,
  (
    SELECT count(*) = 4
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenant_usage'
      AND column_name IN (
        'tournaments_used',
        'tournaments_limit',
        'referees_used',
        'referees_limit'
      )
  ) AS tenant_usage_has_commercial_quotas,
  (
    SELECT count(*) = 0
    FROM public.payment_orders
  ) AS migration_created_no_orders;
