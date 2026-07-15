-- Self-service commercialization PR-COM-03: payOS order and atomic settlement.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.payment_provider_order_code_seq
  AS bigint
  START WITH 1000000000
  INCREMENT BY 1
  NO CYCLE;

REVOKE ALL ON SEQUENCE public.payment_provider_order_code_seq
  FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.payment_provider_order_code_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  payload_hash text NOT NULL,
  signature_valid boolean NOT NULL,
  order_id uuid REFERENCES public.payment_orders(id),
  processing_status text NOT NULL,
  error_code text,
  sanitized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_order
  ON public.payment_webhook_events(order_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_status
  ON public.payment_webhook_events(processing_status, received_at DESC);

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_webhook_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_payment_order_v1(
  p_auth_user_id uuid,
  p_plan_code text,
  p_extra_event_quantity integer DEFAULT 0,
  p_extra_referee_quantity integer DEFAULT 0,
  p_client_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_claim_role text := public.request_claim_role_v1();
  v_actor record;
  v_plan public.subscription_plans%ROWTYPE;
  v_existing public.payment_orders%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_provider_order_code bigint;
  v_order_code text;
  v_transfer_content text;
  v_event_addon integer := COALESCE(p_extra_event_quantity, 0);
  v_referee_addon integer := COALESCE(p_extra_referee_quantity, 0);
  v_addon_amount numeric(12, 0);
BEGIN
  IF v_claim_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_USER_REQUIRED';
  END IF;

  IF v_event_addon < 0 OR v_event_addon > 100
     OR v_referee_addon < 0 OR v_referee_addon > 100 THEN
    RAISE EXCEPTION 'INVALID_ADDON_QUANTITY';
  END IF;

  IF p_client_request_id IS NULL OR length(btrim(p_client_request_id)) < 8
     OR length(p_client_request_id) > 100 THEN
    RAISE EXCEPTION 'INVALID_CLIENT_REQUEST_ID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text || ':payment_order', 0));

  SELECT
    a.id AS account_id,
    a.tenant_id,
    a.status AS account_status,
    t.status AS tenant_status,
    t.tenant_type
  INTO v_actor
  FROM public.accounts a
  JOIN public.tenants t ON t.id = a.tenant_id
  WHERE a.user_id = p_auth_user_id
    AND a.deleted_at IS NULL
    AND t.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND
     OR v_actor.account_status IS DISTINCT FROM 'active'
     OR v_actor.tenant_status IS DISTINCT FROM 'active'
     OR v_actor.tenant_type IS DISTINCT FROM 'self_service_customer' THEN
    RAISE EXCEPTION 'SELF_SERVICE_ACCOUNT_REQUIRED';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.payment_orders po
  WHERE po.account_id = v_actor.account_id
    AND po.client_request_id = btrim(p_client_request_id)
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'created', false,
      'order', jsonb_build_object(
        'id', v_existing.id,
        'order_code', v_existing.order_code,
        'provider_order_code', v_existing.provider_order_code,
        'status', v_existing.status,
        'total_amount', v_existing.total_amount,
        'currency', v_existing.currency,
        'transfer_content', v_existing.transfer_content,
        'checkout_url', v_existing.provider_checkout_url,
        'qr_code', v_existing.provider_qr_code,
        'manual_review_available_at', v_existing.manual_review_available_at,
        'expires_at', v_existing.expires_at
      )
    );
  END IF;

  SELECT *
  INTO v_existing
  FROM public.payment_orders po
  WHERE po.account_id = v_actor.account_id
    AND po.status IN ('awaiting_payment', 'manual_review', 'payment_mismatch', 'webhook_invalid')
    AND po.expires_at > now()
  ORDER BY po.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'created', false,
      'order', jsonb_build_object(
        'id', v_existing.id,
        'order_code', v_existing.order_code,
        'provider_order_code', v_existing.provider_order_code,
        'status', v_existing.status,
        'total_amount', v_existing.total_amount,
        'currency', v_existing.currency,
        'transfer_content', v_existing.transfer_content,
        'checkout_url', v_existing.provider_checkout_url,
        'qr_code', v_existing.provider_qr_code,
        'manual_review_available_at', v_existing.manual_review_available_at,
        'expires_at', v_existing.expires_at
      )
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenant_subscriptions ts
    WHERE ts.tenant_id = v_actor.tenant_id
      AND ts.status IN ('active', 'trial')
      AND ts.start_date <= now()
      AND (ts.end_date IS NULL OR ts.end_date > now())
  ) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_ALREADY_ACTIVE';
  END IF;

  SELECT *
  INTO v_plan
  FROM public.subscription_plans sp
  WHERE sp.code = upper(btrim(p_plan_code))
    AND sp.billing_model = 'duration'
    AND sp.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_NOT_AVAILABLE';
  END IF;

  v_provider_order_code := nextval('public.payment_provider_order_code_seq');
  v_order_code := 'PIC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_transfer_content := 'PIC' || v_provider_order_code::text;
  v_addon_amount := (v_event_addon + v_referee_addon) * 10000;

  INSERT INTO public.payment_orders(
    order_code,
    client_request_id,
    tenant_id,
    account_id,
    order_type,
    plan_id,
    status,
    base_amount,
    addon_amount,
    total_amount,
    duration_days_snapshot,
    transfer_content,
    payment_provider,
    provider_order_code,
    manual_review_available_at,
    expires_at,
    metadata
  )
  VALUES (
    v_order_code,
    btrim(p_client_request_id),
    v_actor.tenant_id,
    v_actor.account_id,
    'activation',
    v_plan.id,
    'awaiting_payment',
    v_plan.price_vnd,
    v_addon_amount,
    v_plan.price_vnd + v_addon_amount,
    v_plan.duration_days,
    v_transfer_content,
    'payos',
    v_provider_order_code,
    now() + interval '5 minutes',
    now() + interval '24 hours',
    jsonb_build_object(
      'base_tournament_limit', v_plan.max_active_tournaments,
      'base_event_limit', v_plan.max_events,
      'base_referee_limit', v_plan.max_active_referees
    )
  )
  RETURNING * INTO v_order;

  INSERT INTO public.payment_order_items(
    order_id,
    item_type,
    description,
    quantity,
    unit_price,
    amount,
    metadata
  )
  VALUES (
    v_order.id,
    'plan',
    v_plan.name,
    1,
    v_plan.price_vnd,
    v_plan.price_vnd,
    jsonb_build_object('plan_code', v_plan.code, 'duration_days', v_plan.duration_days)
  );

  IF v_event_addon > 0 THEN
    INSERT INTO public.payment_order_items(
      order_id, item_type, description, quantity, unit_price, amount
    )
    VALUES (
      v_order.id, 'event_addon', 'Nội dung thi đấu mua thêm',
      v_event_addon, 10000, v_event_addon * 10000
    );
  END IF;

  IF v_referee_addon > 0 THEN
    INSERT INTO public.payment_order_items(
      order_id, item_type, description, quantity, unit_price, amount
    )
    VALUES (
      v_order.id, 'referee_addon', 'Tài khoản trọng tài mua thêm',
      v_referee_addon, 10000, v_referee_addon * 10000
    );
  END IF;

  INSERT INTO public.audit_logs(
    timestamp, action, details, tenant_id, actor_account_id, actor_role,
    category, entity_type, entity_id, result, details_json
  )
  VALUES (
    now()::text,
    'COMMERCIAL_ORDER_CREATED',
    jsonb_build_object(
      'order_type', 'activation',
      'plan_code', v_plan.code,
      'total_amount', v_order.total_amount,
      'currency', 'VND'
    )::text,
    v_actor.tenant_id,
    v_actor.account_id,
    'EVENT_ADMIN',
    'billing',
    'payment_order',
    v_order.id::text,
    'allow',
    jsonb_build_object(
      'order_type', 'activation',
      'plan_code', v_plan.code,
      'total_amount', v_order.total_amount,
      'currency', 'VND'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'created', true,
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_code', v_order.order_code,
      'provider_order_code', v_order.provider_order_code,
      'status', v_order.status,
      'total_amount', v_order.total_amount,
      'currency', v_order.currency,
      'transfer_content', v_order.transfer_content,
      'checkout_url', v_order.provider_checkout_url,
      'qr_code', v_order.provider_qr_code,
      'manual_review_available_at', v_order.manual_review_available_at,
      'expires_at', v_order.expires_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_payment_provider_v1(
  p_order_id uuid,
  p_provider_order_id text,
  p_checkout_url text,
  p_qr_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_claim_role text := public.request_claim_role_v1();
  v_order public.payment_orders%ROWTYPE;
BEGIN
  IF v_claim_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  UPDATE public.payment_orders
  SET
    provider_order_id = COALESCE(NULLIF(btrim(p_provider_order_id), ''), provider_order_id),
    provider_checkout_url = COALESCE(NULLIF(btrim(p_checkout_url), ''), provider_checkout_url),
    provider_qr_code = COALESCE(NULLIF(btrim(p_qr_code), ''), provider_qr_code),
    updated_at = now()
  WHERE id = p_order_id
    AND status = 'awaiting_payment'
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    SELECT * INTO v_order
    FROM public.payment_orders
    WHERE id = p_order_id;
  END IF;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_code', v_order.order_code,
      'provider_order_code', v_order.provider_order_code,
      'status', v_order.status,
      'total_amount', v_order.total_amount,
      'currency', v_order.currency,
      'transfer_content', v_order.transfer_content,
      'checkout_url', v_order.provider_checkout_url,
      'qr_code', v_order.provider_qr_code,
      'manual_review_available_at', v_order.manual_review_available_at,
      'expires_at', v_order.expires_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_payment_order_v1(
  p_provider_order_code bigint,
  p_provider_transaction_id text,
  p_paid_amount numeric,
  p_settlement_source text,
  p_confirmed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_claim_role text := public.request_claim_role_v1();
  v_order public.payment_orders%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_subscription public.tenant_subscriptions%ROWTYPE;
  v_event_addon integer := 0;
  v_referee_addon integer := 0;
  v_invoice_id uuid;
BEGIN
  IF v_claim_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  IF p_settlement_source NOT IN ('webhook', 'manual') THEN
    RAISE EXCEPTION 'INVALID_SETTLEMENT_SOURCE';
  END IF;

  IF NULLIF(btrim(p_provider_transaction_id), '') IS NULL THEN
    RAISE EXCEPTION 'PROVIDER_TRANSACTION_REQUIRED';
  END IF;

  SELECT *
  INTO v_order
  FROM public.payment_orders
  WHERE provider_order_code = p_provider_order_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'result', 'order_not_found');
  END IF;

  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object(
      'success', true,
      'result', 'already_paid',
      'order_id', v_order.id,
      'subscription_id', v_order.metadata->>'subscription_id'
    );
  END IF;

  IF v_order.status IN ('expired', 'cancelled', 'rejected') OR v_order.expires_at <= now() THEN
    IF v_order.expires_at <= now() AND v_order.status NOT IN ('expired', 'cancelled', 'rejected') THEN
      UPDATE public.payment_orders
      SET status = 'expired', updated_at = now()
      WHERE id = v_order.id;
    END IF;
    RETURN jsonb_build_object('success', false, 'result', 'order_not_payable', 'order_id', v_order.id);
  END IF;

  IF p_paid_amount IS NULL OR p_paid_amount <> v_order.total_amount THEN
    UPDATE public.payment_orders
    SET
      status = 'payment_mismatch',
      paid_amount = p_paid_amount,
      webhook_received_at = CASE WHEN p_settlement_source = 'webhook' THEN now() ELSE webhook_received_at END,
      updated_at = now()
    WHERE id = v_order.id;

    INSERT INTO public.audit_logs(
      timestamp, action, details, tenant_id, actor_account_id, actor_role,
      category, entity_type, entity_id, result, reason, details_json
    )
    VALUES (
      now()::text,
      'PAYMENT_MISMATCH_DETECTED',
      jsonb_build_object(
        'expected_amount', v_order.total_amount,
        'received_amount', p_paid_amount,
        'settlement_source', p_settlement_source
      )::text,
      v_order.tenant_id,
      COALESCE(p_confirmed_by, v_order.account_id),
      CASE WHEN p_settlement_source = 'manual' THEN 'SUPER_ADMIN' ELSE 'PAYMENT_PROVIDER' END,
      'billing',
      'payment_order',
      v_order.id::text,
      'deny',
      'PAYMENT_MISMATCH',
      jsonb_build_object(
        'expected_amount', v_order.total_amount,
        'received_amount', p_paid_amount,
        'settlement_source', p_settlement_source
      )
    );

    RETURN jsonb_build_object('success', false, 'result', 'payment_mismatch', 'order_id', v_order.id);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_orders po
    WHERE po.provider_transaction_id = p_provider_transaction_id
      AND po.id <> v_order.id
  ) THEN
    RAISE EXCEPTION 'PROVIDER_TRANSACTION_ALREADY_USED';
  END IF;

  IF v_order.order_type <> 'activation' THEN
    RAISE EXCEPTION 'ORDER_TYPE_NOT_SUPPORTED_IN_COM03';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenant_subscriptions ts
    WHERE ts.tenant_id = v_order.tenant_id
      AND ts.status IN ('active', 'trial')
      AND ts.start_date <= now()
      AND (ts.end_date IS NULL OR ts.end_date > now())
  ) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_ALREADY_ACTIVE';
  END IF;

  SELECT * INTO v_plan
  FROM public.subscription_plans
  WHERE id = v_order.plan_id
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_NOT_AVAILABLE';
  END IF;

  SELECT
    COALESCE(sum(quantity) FILTER (WHERE item_type = 'event_addon'), 0),
    COALESCE(sum(quantity) FILTER (WHERE item_type = 'referee_addon'), 0)
  INTO v_event_addon, v_referee_addon
  FROM public.payment_order_items
  WHERE order_id = v_order.id;

  INSERT INTO public.tenant_subscriptions(
    tenant_id,
    plan_id,
    status,
    start_date,
    end_date,
    auto_renew,
    activated_at,
    activation_order_id,
    confirmed_by,
    period_number
  )
  VALUES (
    v_order.tenant_id,
    v_plan.id,
    'active',
    now(),
    now() + make_interval(days => v_order.duration_days_snapshot),
    false,
    now(),
    v_order.id,
    p_confirmed_by,
    1
  )
  RETURNING * INTO v_subscription;

  INSERT INTO public.subscription_entitlements(
    subscription_id, resource_type, base_limit, addon_limit
  )
  VALUES
    (v_subscription.id, 'tournaments', v_plan.max_active_tournaments, 0),
    (v_subscription.id, 'events', v_plan.max_events, v_event_addon),
    (v_subscription.id, 'referees', v_plan.max_active_referees, v_referee_addon);

  INSERT INTO public.invoices(
    tenant_id,
    subscription_id,
    invoice_number,
    billing_period,
    amount,
    status,
    invoice_date,
    due_date,
    paid_at
  )
  VALUES (
    v_order.tenant_id,
    v_subscription.id,
    'INV-' || replace(v_order.order_code, 'PIC-', ''),
    v_order.duration_days_snapshot::text || ' days',
    v_order.total_amount,
    'paid',
    now(),
    now(),
    now()
  )
  RETURNING id INTO v_invoice_id;

  UPDATE public.self_service_customer_profiles
  SET onboarding_status = 'ready', updated_at = now()
  WHERE account_id = v_order.account_id;

  UPDATE public.payment_orders
  SET
    status = 'paid',
    provider_transaction_id = NULLIF(btrim(p_provider_transaction_id), ''),
    paid_amount = p_paid_amount,
    paid_at = now(),
    settlement_source = p_settlement_source,
    webhook_received_at = CASE WHEN p_settlement_source = 'webhook' THEN now() ELSE webhook_received_at END,
    confirmed_at = now(),
    confirmed_by = p_confirmed_by,
    metadata = metadata || jsonb_build_object(
      'subscription_id', v_subscription.id,
      'invoice_id', v_invoice_id
    ),
    updated_at = now()
  WHERE id = v_order.id;

  INSERT INTO public.audit_logs(
    timestamp, action, details, tenant_id, actor_account_id, actor_role,
    category, entity_type, entity_id, result, details_json
  )
  VALUES (
    now()::text,
    CASE WHEN p_settlement_source = 'webhook' THEN 'PAYMENT_AUTO_SETTLED' ELSE 'PAYMENT_MANUAL_CONFIRMED' END,
    jsonb_build_object(
      'order_id', v_order.id,
      'account_id', v_order.account_id,
      'expected_amount', v_order.total_amount,
      'received_amount', p_paid_amount,
      'currency', v_order.currency,
      'settlement_source', p_settlement_source,
      'subscription_id', v_subscription.id
    )::text,
    v_order.tenant_id,
    COALESCE(p_confirmed_by, v_order.account_id),
    CASE WHEN p_settlement_source = 'manual' THEN 'SUPER_ADMIN' ELSE 'PAYMENT_PROVIDER' END,
    'billing',
    'payment_order',
    v_order.id::text,
    'allow',
    jsonb_build_object(
      'order_id', v_order.id,
      'account_id', v_order.account_id,
      'expected_amount', v_order.total_amount,
      'received_amount', p_paid_amount,
      'currency', v_order.currency,
      'settlement_source', p_settlement_source,
      'subscription_id', v_subscription.id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'result', 'paid',
    'order_id', v_order.id,
    'subscription_id', v_subscription.id,
    'invoice_id', v_invoice_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_payos_webhook_v1(
  p_provider_event_id text,
  p_payload_hash text,
  p_provider_order_code bigint,
  p_provider_transaction_id text,
  p_paid_amount numeric,
  p_payment_success boolean,
  p_sanitized_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_claim_role text := public.request_claim_role_v1();
  v_event_id uuid;
  v_order_id uuid;
  v_result jsonb;
BEGIN
  IF v_claim_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  IF NULLIF(btrim(p_provider_event_id), '') IS NULL
     OR NULLIF(btrim(p_payload_hash), '') IS NULL THEN
    RAISE EXCEPTION 'INVALID_WEBHOOK_IDENTITY';
  END IF;

  SELECT id INTO v_order_id
  FROM public.payment_orders
  WHERE provider_order_code = p_provider_order_code;

  INSERT INTO public.payment_webhook_events(
    provider,
    provider_event_id,
    payload_hash,
    signature_valid,
    order_id,
    processing_status,
    sanitized_payload
  )
  VALUES (
    'payos',
    btrim(p_provider_event_id),
    btrim(p_payload_hash),
    true,
    v_order_id,
    'received',
    COALESCE(p_sanitized_payload, '{}'::jsonb)
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'result', 'duplicate_webhook');
  END IF;

  IF v_order_id IS NULL THEN
    UPDATE public.payment_webhook_events
    SET processing_status = 'ignored', error_code = 'ORDER_NOT_FOUND', processed_at = now()
    WHERE id = v_event_id;
    RETURN jsonb_build_object('success', true, 'result', 'order_not_found');
  END IF;

  IF NOT COALESCE(p_payment_success, false) THEN
    UPDATE public.payment_orders
    SET status = 'webhook_invalid', webhook_received_at = now(), updated_at = now()
    WHERE id = v_order_id
      AND status NOT IN ('paid', 'expired', 'cancelled', 'rejected');

    UPDATE public.payment_webhook_events
    SET processing_status = 'rejected', error_code = 'PAYMENT_NOT_SUCCESSFUL', processed_at = now()
    WHERE id = v_event_id;

    RETURN jsonb_build_object('success', true, 'result', 'webhook_invalid', 'order_id', v_order_id);
  END IF;

  v_result := public.settle_payment_order_v1(
    p_provider_order_code,
    p_provider_transaction_id,
    p_paid_amount,
    'webhook',
    NULL
  );

  UPDATE public.payment_webhook_events
  SET
    processing_status = CASE
      WHEN v_result->>'result' IN ('paid', 'already_paid') THEN 'processed'
      WHEN v_result->>'result' = 'payment_mismatch' THEN 'manual_review_required'
      ELSE 'ignored'
    END,
    error_code = CASE
      WHEN v_result->>'result' IN ('paid', 'already_paid') THEN NULL
      ELSE upper(v_result->>'result')
    END,
    processed_at = now()
  WHERE id = v_event_id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_invalid_payos_webhook_v1(
  p_payload_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_claim_role text := public.request_claim_role_v1();
BEGIN
  IF v_claim_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  INSERT INTO public.payment_webhook_events(
    provider,
    provider_event_id,
    payload_hash,
    signature_valid,
    processing_status,
    error_code,
    sanitized_payload,
    processed_at
  )
  VALUES (
    'payos',
    'invalid:' || left(btrim(p_payload_hash), 32),
    btrim(p_payload_hash),
    false,
    'rejected',
    'INVALID_SIGNATURE',
    '{}'::jsonb,
    now()
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING;

  INSERT INTO public.audit_logs(
    timestamp, action, details, category, entity_type, result, reason, details_json
  )
  VALUES (
    now()::text,
    'PAYMENT_WEBHOOK_INVALID',
    jsonb_build_object('provider', 'payos', 'payload_hash_prefix', left(btrim(p_payload_hash), 12))::text,
    'security',
    'payment_webhook',
    'deny',
    'INVALID_SIGNATURE',
    jsonb_build_object('provider', 'payos', 'payload_hash_prefix', left(btrim(p_payload_hash), 12))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_current_payment_order_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid := public.current_account_id();
  v_order public.payment_orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_account_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT * INTO v_order
  FROM public.payment_orders po
  WHERE po.account_id = v_account_id
  ORDER BY po.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_code', v_order.order_code,
    'provider_order_code', v_order.provider_order_code,
    'order_type', v_order.order_type,
    'status', v_order.status,
    'total_amount', v_order.total_amount,
    'currency', v_order.currency,
    'transfer_content', v_order.transfer_content,
    'checkout_url', v_order.provider_checkout_url,
    'qr_code', v_order.provider_qr_code,
    'manual_review_available_at', v_order.manual_review_available_at,
    'manual_review_requested_at', v_order.manual_review_requested_at,
    'expires_at', v_order.expires_at,
    'paid_at', v_order.paid_at,
    'created_at', v_order.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_payment_order_v1(uuid, text, integer, integer, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_payment_provider_v1(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_payment_order_v1(bigint, text, numeric, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_payos_webhook_v1(text, text, bigint, text, numeric, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_invalid_payos_webhook_v1(text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_payment_order_v1(uuid, text, integer, integer, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_payment_provider_v1(uuid, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_payment_order_v1(bigint, text, numeric, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.process_payos_webhook_v1(text, text, bigint, text, numeric, boolean, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_invalid_payos_webhook_v1(text)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_my_current_payment_order_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_current_payment_order_v1() TO authenticated;

COMMIT;
