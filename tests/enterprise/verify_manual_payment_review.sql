CREATE TEMP TABLE __manual_payment_review_verification_guard(id integer) ON COMMIT DROP;

DO $$
DECLARE
  v_authenticated oid := (SELECT oid FROM pg_roles WHERE rolname = 'authenticated');
  v_anon oid := (SELECT oid FROM pg_roles WHERE rolname = 'anon');
  v_service_role oid := (SELECT oid FROM pg_roles WHERE rolname = 'service_role');
BEGIN
  IF has_function_privilege(v_authenticated, 'public.request_payment_manual_review_v1(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege(v_authenticated, 'public.list_payment_manual_reviews_v1(uuid)', 'EXECUTE')
     OR has_function_privilege(v_authenticated, 'public.confirm_payment_order_manual_v1(uuid,uuid,numeric,text)', 'EXECUTE')
     OR has_function_privilege(v_authenticated, 'public.reject_payment_order_manual_v1(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege(v_anon, 'public.confirm_payment_order_manual_v1(uuid,uuid,numeric,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'client role can execute manual payment mutation functions';
  END IF;

  IF NOT has_function_privilege(v_service_role, 'public.request_payment_manual_review_v1(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege(v_service_role, 'public.list_payment_manual_reviews_v1(uuid)', 'EXECUTE')
     OR NOT has_function_privilege(v_service_role, 'public.confirm_payment_order_manual_v1(uuid,uuid,numeric,text)', 'EXECUTE')
     OR NOT has_function_privilege(v_service_role, 'public.reject_payment_order_manual_v1(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role manual payment grants are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_orders
    WHERE status = 'paid'
      AND (paid_amount <> total_amount OR paid_at IS NULL OR settlement_source IS NULL)
  ) THEN
    RAISE EXCEPTION 'paid payment order invariant is broken';
  END IF;

  IF EXISTS (
    SELECT activation_order_id
    FROM public.tenant_subscriptions
    WHERE activation_order_id IS NOT NULL
    GROUP BY activation_order_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'an order activated more than one subscription';
  END IF;
END $$;

SELECT 'manual payment review verification passed' AS result;
