CREATE TEMP TABLE __commercial_renewal_addon_guard(id integer) ON COMMIT DROP;

DO $$
DECLARE
  v_service_role oid := (SELECT oid FROM pg_roles WHERE rolname = 'service_role');
  v_authenticated oid := (SELECT oid FROM pg_roles WHERE rolname = 'authenticated');
  v_settle_definition text := pg_get_functiondef('public.settle_payment_order_v1(bigint,text,numeric,text,uuid)'::regprocedure);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tenant_subscriptions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%scheduled%'
  ) THEN RAISE EXCEPTION 'scheduled subscription status is missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'tenant_subscriptions'
      AND indexname = 'ux_tenant_subscriptions_one_scheduled'
  ) THEN RAISE EXCEPTION 'scheduled renewal uniqueness is missing'; END IF;

  IF NOT has_function_privilege(v_service_role,
      'public.create_payment_order_v2(uuid,text,text,integer,integer,text)', 'EXECUTE')
     OR has_function_privilege(v_authenticated,
      'public.create_payment_order_v2(uuid,text,text,integer,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'payment order v2 grants are invalid';
  END IF;

  IF v_settle_definition NOT LIKE '%v_order.order_type = ''renewal''%'
     OR v_settle_definition NOT LIKE '%v_order.order_type = ''addon''%'
     OR v_settle_definition LIKE '%ORDER_TYPE_NOT_SUPPORTED_IN_COM03%' THEN
    RAISE EXCEPTION 'settlement does not support renewal and add-on';
  END IF;

  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.get_commercial_access_state_v1()'::regprocedure) <> 'v' THEN
    RAISE EXCEPTION 'commercial access state must advance due periods';
  END IF;

  IF pg_get_viewdef('public.tenant_usage'::regclass) NOT LIKE '%scheduled%'
     OR pg_get_functiondef('public.has_permission(text)'::regprocedure) NOT LIKE '%scheduled%'
     OR pg_get_functiondef('public.get_current_profile()'::regprocedure) NOT LIKE '%scheduled%' THEN
    RAISE EXCEPTION 'scheduled period is missing from effective access contracts';
  END IF;
END $$;

SELECT 'self-service renewal and add-on contract verification passed' AS result;
