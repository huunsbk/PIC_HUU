-- Self-service commercialization PR-COM-04: manual payment review fallback.

BEGIN;

CREATE OR REPLACE FUNCTION public.request_payment_manual_review_v1(
  p_auth_user_id uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_claim_role text := public.request_claim_role_v1();
  v_account record;
  v_order public.payment_orders%ROWTYPE;
BEGIN
  IF v_claim_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  SELECT a.id, a.tenant_id, r.name AS role_name, a.status, t.tenant_type, t.status AS tenant_status
  INTO v_account
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  JOIN public.tenants t ON t.id = a.tenant_id
  WHERE a.user_id = p_auth_user_id
    AND a.deleted_at IS NULL
    AND t.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND OR v_account.status <> 'active' OR v_account.tenant_status <> 'active'
     OR v_account.tenant_type <> 'self_service_customer' THEN
    RAISE EXCEPTION 'SELF_SERVICE_ACCOUNT_REQUIRED';
  END IF;

  SELECT * INTO v_order
  FROM public.payment_orders
  WHERE id = p_order_id
    AND account_id = v_account.id
    AND tenant_id = v_account.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('success', true, 'result', 'already_paid', 'order_id', v_order.id);
  END IF;

  IF v_order.status = 'manual_review' THEN
    RETURN jsonb_build_object('success', true, 'result', 'already_requested', 'order_id', v_order.id);
  END IF;

  IF v_order.status NOT IN ('awaiting_payment', 'payment_mismatch', 'webhook_invalid')
     OR v_order.expires_at <= now() THEN
    RAISE EXCEPTION 'ORDER_NOT_REVIEWABLE';
  END IF;

  IF v_order.status = 'awaiting_payment'
     AND (v_order.manual_review_available_at IS NULL OR v_order.manual_review_available_at > now()) THEN
    RAISE EXCEPTION 'MANUAL_REVIEW_NOT_AVAILABLE';
  END IF;

  UPDATE public.payment_orders
  SET status = 'manual_review', manual_review_requested_at = now(), updated_at = now()
  WHERE id = v_order.id;

  INSERT INTO public.audit_logs(
    timestamp, action, details, tenant_id, actor_account_id, actor_role,
    category, entity_type, entity_id, result, details_json
  )
  VALUES (
    now()::text,
    'PAYMENT_MANUAL_REVIEW_REQUESTED',
    jsonb_build_object('order_id', v_order.id, 'previous_status', v_order.status)::text,
    v_order.tenant_id,
    v_account.id,
    v_account.role_name,
    'billing',
    'payment_order',
    v_order.id::text,
    'allow',
    jsonb_build_object('order_id', v_order.id, 'previous_status', v_order.status)
  );

  RETURN jsonb_build_object('success', true, 'result', 'manual_review', 'order_id', v_order.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_payment_manual_reviews_v1(
  p_actor_auth_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_claim_role text := public.request_claim_role_v1();
  v_actor record;
  v_rows jsonb;
BEGIN
  IF v_claim_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  SELECT a.id, r.name AS role_name, a.status
  INTO v_actor
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  WHERE a.user_id = p_actor_auth_user_id
    AND a.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND OR v_actor.status <> 'active' OR v_actor.role_name <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', po.id,
    'order_code', po.order_code,
    'status', po.status,
    'order_type', po.order_type,
    'total_amount', po.total_amount,
    'paid_amount', po.paid_amount,
    'currency', po.currency,
    'transfer_content', po.transfer_content,
    'manual_review_requested_at', po.manual_review_requested_at,
    'expires_at', po.expires_at,
    'created_at', po.created_at,
    'tenant_id', po.tenant_id,
    'tenant_name', t.name,
    'account_id', po.account_id,
    'account_name', a.display_name,
    'plan_code', sp.code,
    'plan_name', sp.name
  ) ORDER BY po.manual_review_requested_at NULLS LAST, po.created_at), '[]'::jsonb)
  INTO v_rows
  FROM public.payment_orders po
  JOIN public.tenants t ON t.id = po.tenant_id
  JOIN public.accounts a ON a.id = po.account_id
  LEFT JOIN public.subscription_plans sp ON sp.id = po.plan_id
  WHERE po.status IN ('manual_review', 'payment_mismatch', 'webhook_invalid');

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_payment_order_manual_v1(
  p_actor_auth_user_id uuid,
  p_order_id uuid,
  p_received_amount numeric,
  p_provider_transaction_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_claim_role text := public.request_claim_role_v1();
  v_actor record;
  v_order public.payment_orders%ROWTYPE;
  v_target record;
  v_result jsonb;
BEGIN
  IF v_claim_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  SELECT a.id, r.name AS role_name, a.status
  INTO v_actor
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  WHERE a.user_id = p_actor_auth_user_id
    AND a.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND OR v_actor.status <> 'active' OR v_actor.role_name <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED';
  END IF;

  IF NULLIF(btrim(p_provider_transaction_id), '') IS NULL THEN
    RAISE EXCEPTION 'PROVIDER_TRANSACTION_REQUIRED';
  END IF;

  SELECT * INTO v_order
  FROM public.payment_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object(
      'success', true,
      'result', 'already_paid',
      'order_id', v_order.id,
      'subscription_id', v_order.metadata->>'subscription_id'
    );
  END IF;

  IF v_order.status NOT IN ('manual_review', 'payment_mismatch', 'webhook_invalid')
     OR v_order.expires_at <= now() THEN
    RAISE EXCEPTION 'ORDER_NOT_CONFIRMABLE';
  END IF;

  SELECT a.status AS account_status, a.deleted_at AS account_deleted_at,
         t.status AS tenant_status, t.deleted_at AS tenant_deleted_at,
         t.tenant_type
  INTO v_target
  FROM public.accounts a
  JOIN public.tenants t ON t.id = a.tenant_id
  WHERE a.id = v_order.account_id
    AND t.id = v_order.tenant_id;

  IF NOT FOUND OR v_target.account_status <> 'active' OR v_target.account_deleted_at IS NOT NULL
     OR v_target.tenant_status <> 'active' OR v_target.tenant_deleted_at IS NOT NULL
     OR v_target.tenant_type <> 'self_service_customer' THEN
    RAISE EXCEPTION 'ORDER_TARGET_INACTIVE';
  END IF;

  IF p_received_amount IS NULL OR p_received_amount <> v_order.total_amount THEN
    UPDATE public.payment_orders
    SET status = 'payment_mismatch', paid_amount = p_received_amount, updated_at = now()
    WHERE id = v_order.id;

    INSERT INTO public.audit_logs(
      timestamp, action, details, tenant_id, actor_account_id, actor_role,
      category, entity_type, entity_id, result, reason, details_json
    ) VALUES (
      now()::text,
      'PAYMENT_MANUAL_CONFIRM_DENIED',
      jsonb_build_object('order_id', v_order.id, 'expected_amount', v_order.total_amount,
        'received_amount', p_received_amount)::text,
      v_order.tenant_id, v_actor.id, v_actor.role_name, 'billing', 'payment_order',
      v_order.id::text, 'deny', 'PAYMENT_MISMATCH',
      jsonb_build_object('order_id', v_order.id, 'expected_amount', v_order.total_amount,
        'received_amount', p_received_amount)
    );

    RETURN jsonb_build_object('success', false, 'result', 'payment_mismatch', 'order_id', v_order.id);
  END IF;

  v_result := public.settle_payment_order_v1(
    v_order.provider_order_code,
    btrim(p_provider_transaction_id),
    p_received_amount,
    'manual',
    v_actor.id
  );

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_payment_order_manual_v1(
  p_actor_auth_user_id uuid,
  p_order_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_claim_role text := public.request_claim_role_v1();
  v_actor record;
  v_order public.payment_orders%ROWTYPE;
  v_reason text := left(NULLIF(btrim(p_reason), ''), 500);
BEGIN
  IF v_claim_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  SELECT a.id, r.name AS role_name, a.status
  INTO v_actor
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  WHERE a.user_id = p_actor_auth_user_id
    AND a.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND OR v_actor.status <> 'active' OR v_actor.role_name <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'REJECTION_REASON_REQUIRED';
  END IF;

  SELECT * INTO v_order
  FROM public.payment_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF v_order.status = 'paid' THEN
    RAISE EXCEPTION 'PAID_ORDER_CANNOT_BE_REJECTED';
  END IF;
  IF v_order.status NOT IN ('manual_review', 'payment_mismatch', 'webhook_invalid') THEN
    RAISE EXCEPTION 'ORDER_NOT_REJECTABLE';
  END IF;

  UPDATE public.payment_orders
  SET status = 'rejected', rejection_reason = v_reason,
      confirmed_at = now(), confirmed_by = v_actor.id, updated_at = now()
  WHERE id = v_order.id;

  INSERT INTO public.audit_logs(
    timestamp, action, details, tenant_id, actor_account_id, actor_role,
    category, entity_type, entity_id, result, reason, details_json
  ) VALUES (
    now()::text,
    'PAYMENT_MANUAL_REJECTED',
    jsonb_build_object('order_id', v_order.id, 'reason', v_reason)::text,
    v_order.tenant_id, v_actor.id, v_actor.role_name, 'billing', 'payment_order',
    v_order.id::text, 'deny', v_reason,
    jsonb_build_object('order_id', v_order.id, 'reason', v_reason)
  );

  RETURN jsonb_build_object('success', true, 'result', 'rejected', 'order_id', v_order.id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_payment_manual_review_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_payment_manual_reviews_v1(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_payment_order_manual_v1(uuid, uuid, numeric, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_payment_order_manual_v1(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_payment_manual_review_v1(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_payment_manual_reviews_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_payment_order_manual_v1(uuid, uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_payment_order_manual_v1(uuid, uuid, text) TO service_role;

COMMIT;
