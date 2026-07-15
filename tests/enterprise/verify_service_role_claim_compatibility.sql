WITH commercial_functions(signature) AS (
  VALUES
    ('public.bootstrap_self_service_customer_v1(uuid)'::regprocedure),
    ('public.create_payment_order_v1(uuid,text,integer,integer,text)'::regprocedure),
    ('public.attach_payment_provider_v1(uuid,text,text,text)'::regprocedure),
    ('public.settle_payment_order_v1(bigint,text,numeric,text,uuid)'::regprocedure),
    ('public.process_payos_webhook_v1(text,text,bigint,text,numeric,boolean,jsonb)'::regprocedure),
    ('public.record_invalid_payos_webhook_v1(text)'::regprocedure),
    ('public.request_payment_manual_review_v1(uuid,uuid)'::regprocedure),
    ('public.list_payment_manual_reviews_v1(uuid)'::regprocedure),
    ('public.confirm_payment_order_manual_v1(uuid,uuid,numeric,text)'::regprocedure),
    ('public.reject_payment_order_manual_v1(uuid,uuid,text)'::regprocedure)
), invalid_functions AS (
  SELECT signature::text AS signature
  FROM commercial_functions
  WHERE pg_get_functiondef(signature::oid) NOT LIKE '%public.request_claim_role_v1()%'
)
SELECT jsonb_build_object(
  'success', NOT EXISTS (SELECT 1 FROM invalid_functions),
  'invalid_functions', COALESCE((SELECT jsonb_agg(signature) FROM invalid_functions), '[]'::jsonb),
  'helper_exposed_to_authenticated', has_function_privilege(
    'authenticated', 'public.request_claim_role_v1()', 'EXECUTE'
  )
) AS service_role_claim_compatibility;
