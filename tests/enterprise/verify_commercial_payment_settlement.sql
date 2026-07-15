CREATE TEMP TABLE __commercial_payment_verification_guard(id integer) ON COMMIT DROP;

DO $$
DECLARE
  v_authenticated oid := (SELECT oid FROM pg_roles WHERE rolname = 'authenticated');
  v_anon oid := (SELECT oid FROM pg_roles WHERE rolname = 'anon');
  v_service_role oid := (SELECT oid FROM pg_roles WHERE rolname = 'service_role');
BEGIN
  IF to_regclass('public.payment_webhook_events') IS NULL THEN
    RAISE EXCEPTION 'payment_webhook_events is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.payment_webhook_events'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'payment_webhook_events RLS is disabled';
  END IF;

  IF has_table_privilege(v_authenticated, 'public.payment_webhook_events', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege(v_anon, 'public.payment_webhook_events', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'client roles can mutate payment_webhook_events';
  END IF;

  IF has_function_privilege(v_authenticated, 'public.create_payment_order_v1(uuid,text,integer,integer,text)', 'EXECUTE')
     OR has_function_privilege(v_authenticated, 'public.create_payment_order_v2(uuid,text,text,integer,integer,text)', 'EXECUTE')
     OR has_function_privilege(v_authenticated, 'public.settle_payment_order_v1(bigint,text,numeric,text,uuid)', 'EXECUTE')
     OR has_function_privilege(v_authenticated, 'public.process_payos_webhook_v1(text,text,bigint,text,numeric,boolean,jsonb)', 'EXECUTE')
     OR has_function_privilege(v_anon, 'public.process_payos_webhook_v1(text,text,bigint,text,numeric,boolean,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'client role can execute payment mutation functions';
  END IF;

  IF NOT has_function_privilege(v_service_role, 'public.create_payment_order_v1(uuid,text,integer,integer,text)', 'EXECUTE')
     OR NOT has_function_privilege(v_service_role, 'public.create_payment_order_v2(uuid,text,text,integer,integer,text)', 'EXECUTE')
     OR NOT has_function_privilege(v_service_role, 'public.settle_payment_order_v1(bigint,text,numeric,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege(v_service_role, 'public.process_payos_webhook_v1(text,text,bigint,text,numeric,boolean,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role payment execution grants are missing';
  END IF;

  IF NOT has_function_privilege(v_authenticated, 'public.get_my_current_payment_order_v1()', 'EXECUTE')
     OR has_function_privilege(v_anon, 'public.get_my_current_payment_order_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'current payment order read grants are invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_orders
    WHERE provider_transaction_id IS NOT NULL
    GROUP BY provider_transaction_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'provider transaction id is not unique';
  END IF;
END $$;

SELECT 'commercial payment settlement verification passed' AS result;
