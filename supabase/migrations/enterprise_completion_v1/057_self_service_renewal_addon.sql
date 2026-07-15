-- Self-service commercialization PR-COM-07: period renewal and current-period add-ons.

BEGIN;

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT c.conname INTO v_constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'public.tenant_subscriptions'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%status%trial%active%expired%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tenant_subscriptions DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE public.tenant_subscriptions
    ADD CONSTRAINT tenant_subscriptions_status_check
    CHECK (status IN ('trial', 'active', 'scheduled', 'expired', 'cancelled', 'suspended'));
END $$;

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_scheduled_start
  ON public.tenant_subscriptions(tenant_id, start_date)
  WHERE status = 'scheduled';

CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_subscriptions_one_scheduled
  ON public.tenant_subscriptions(tenant_id)
  WHERE status = 'scheduled';

CREATE OR REPLACE FUNCTION public.advance_self_service_subscription_v1(p_tenant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_tenant_type text;
  v_subscription_id uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT tenant_type INTO v_tenant_type
  FROM public.tenants
  WHERE id = p_tenant_id AND deleted_at IS NULL;

  IF NOT FOUND OR v_tenant_type <> 'self_service_customer' THEN
    SELECT id INTO v_subscription_id
    FROM public.tenant_subscriptions
    WHERE tenant_id = p_tenant_id
      AND status IN ('active', 'trial')
      AND start_date <= now()
      AND (end_date IS NULL OR end_date > now())
    ORDER BY start_date DESC, created_at DESC
    LIMIT 1;
    RETURN v_subscription_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':subscription_period', 0));

  UPDATE public.tenant_subscriptions
  SET status = 'expired', updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND status IN ('active', 'trial')
    AND end_date IS NOT NULL
    AND end_date <= now();

  SELECT id INTO v_subscription_id
  FROM public.tenant_subscriptions
  WHERE tenant_id = p_tenant_id
    AND status = 'scheduled'
    AND start_date <= now()
    AND (end_date IS NULL OR end_date > now())
  ORDER BY start_date, created_at
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.tenant_subscriptions
    SET status = 'active', activated_at = COALESCE(activated_at, now()), updated_at = now()
    WHERE id = v_subscription_id;
    RETURN v_subscription_id;
  END IF;

  SELECT id INTO v_subscription_id
  FROM public.tenant_subscriptions
  WHERE tenant_id = p_tenant_id
    AND status IN ('active', 'trial')
    AND start_date <= now()
    AND (end_date IS NULL OR end_date > now())
  ORDER BY start_date DESC, created_at DESC
  LIMIT 1;

  RETURN v_subscription_id;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_self_service_subscription_v1(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.tenant_usage
WITH (security_invoker = true)
AS
WITH current_subscription AS (
  SELECT DISTINCT ON (ts.tenant_id)
    ts.id,
    ts.tenant_id,
    ts.plan_id,
    ts.status
  FROM public.tenant_subscriptions ts
  WHERE ts.status IN ('active', 'trial', 'scheduled')
    AND ts.start_date <= now()
    AND (ts.end_date IS NULL OR ts.end_date > now())
  ORDER BY ts.tenant_id, ts.start_date DESC, ts.created_at DESC
), entitlement_limits AS (
  SELECT
    se.subscription_id,
    max(se.base_limit + se.addon_limit) FILTER (WHERE se.resource_type = 'tournaments') AS tournaments_limit,
    max(se.base_limit + se.addon_limit) FILTER (WHERE se.resource_type = 'events') AS events_limit,
    max(se.base_limit + se.addon_limit) FILTER (WHERE se.resource_type = 'referees') AS referees_limit
  FROM public.subscription_entitlements se
  GROUP BY se.subscription_id
), account_usage AS (
  SELECT
    a.tenant_id,
    count(*) AS users_used,
    count(*) FILTER (WHERE r.name = 'REFEREE' AND a.status = 'active') AS referees_used
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  WHERE a.deleted_at IS NULL
  GROUP BY a.tenant_id
), event_usage AS (
  SELECT tenant_id, count(*) AS events_used
  FROM public.events
  WHERE deleted_at IS NULL AND COALESCE(status, 'active') <> 'archived'
  GROUP BY tenant_id
), team_usage AS (
  SELECT tenant_id, count(*) AS teams_used
  FROM public.teams
  WHERE deleted_at IS NULL
  GROUP BY tenant_id
), tournament_usage AS (
  SELECT tenant_id, count(*) AS tournaments_used
  FROM public.tournament
  WHERE deleted_at IS NULL AND COALESCE(status, 'active') <> 'archived'
  GROUP BY tenant_id
)
SELECT
  t.id AS tenant_id,
  COALESCE(au.users_used, 0::bigint) AS users_used,
  COALESCE(CASE WHEN t.tenant_type = 'self_service_customer' THEN el.referees_limit + 1 END, p.max_users, 1) AS users_limit,
  COALESCE(eu.events_used, 0::bigint) AS events_used,
  COALESCE(el.events_limit, p.max_events, 1) AS events_limit,
  COALESCE(tmu.teams_used, 0::bigint) AS teams_used,
  COALESCE(p.max_teams, 50) AS teams_limit,
  COALESCE(tu.tournaments_used, 0::bigint) AS tournaments_used,
  COALESCE(el.tournaments_limit, p.max_active_tournaments, 1) AS tournaments_limit,
  COALESCE(au.referees_used, 0::bigint) AS referees_used,
  COALESCE(el.referees_limit, p.max_active_referees, 1) AS referees_limit
FROM public.tenants t
LEFT JOIN account_usage au ON au.tenant_id = t.id
LEFT JOIN event_usage eu ON eu.tenant_id = t.id
LEFT JOIN team_usage tmu ON tmu.tenant_id = t.id
LEFT JOIN tournament_usage tu ON tu.tenant_id = t.id
LEFT JOIN current_subscription cs ON cs.tenant_id = t.id
LEFT JOIN public.subscription_plans p ON p.id = cs.plan_id
LEFT JOIN entitlement_limits el ON el.subscription_id = cs.id;

REVOKE ALL ON public.tenant_usage FROM PUBLIC, anon;
GRANT SELECT ON public.tenant_usage TO authenticated;

CREATE OR REPLACE FUNCTION public.business_access_active_v1(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT
      COALESCE(t.status, 'active') = 'active'
      AND t.deleted_at IS NULL
      AND (
        t.tenant_type <> 'self_service_customer'
        OR EXISTS (
          SELECT 1
          FROM public.tenant_subscriptions ts
          JOIN public.subscription_plans sp ON sp.id = ts.plan_id
          WHERE ts.tenant_id = t.id
            AND ts.status IN ('active', 'trial', 'scheduled')
            AND ts.start_date <= now()
            AND (ts.end_date IS NULL OR ts.end_date > now())
            AND sp.is_active = true
        )
      )
    FROM public.tenants t
    WHERE t.id = p_tenant_id
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.ensure_business_access_v1(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_REQUIRED';
  END IF;
  PERFORM public.advance_self_service_subscription_v1(p_tenant_id);
  IF NOT public.business_access_active_v1(p_tenant_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_INACTIVE';
  END IF;
END;
$$;

DO $$
DECLARE
  v_function record;
  v_definition text;
  v_old constant text := 'ts.status IN (''active'', ''trial'')';
BEGIN
  FOR v_function IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('has_permission', 'get_current_profile')
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    IF position(v_old IN v_definition) > 0 THEN
      EXECUTE replace(v_definition, v_old, 'ts.status IN (''active'', ''trial'', ''scheduled'')');
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.create_payment_order_v2(
  p_auth_user_id uuid,
  p_order_type text,
  p_plan_code text DEFAULT NULL,
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
  v_current public.tenant_subscriptions%ROWTYPE;
  v_existing public.payment_orders%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_has_current boolean := false;
  v_order_type text := lower(btrim(COALESCE(p_order_type, '')));
  v_provider_order_code bigint;
  v_event_addon integer := COALESCE(p_extra_event_quantity, 0);
  v_referee_addon integer := COALESCE(p_extra_referee_quantity, 0);
  v_base_amount numeric(12, 0) := 0;
  v_addon_amount numeric(12, 0);
  v_duration_days integer;
BEGIN
  IF v_claim_role IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  IF p_auth_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_USER_REQUIRED'; END IF;
  IF v_order_type NOT IN ('activation', 'renewal', 'addon') THEN RAISE EXCEPTION 'INVALID_ORDER_TYPE'; END IF;
  IF v_event_addon < 0 OR v_event_addon > 100 OR v_referee_addon < 0 OR v_referee_addon > 100 THEN
    RAISE EXCEPTION 'INVALID_ADDON_QUANTITY';
  END IF;
  IF v_order_type = 'addon' AND v_event_addon + v_referee_addon = 0 THEN
    RAISE EXCEPTION 'ADDON_QUANTITY_REQUIRED';
  END IF;
  IF p_client_request_id IS NULL OR length(btrim(p_client_request_id)) < 8 OR length(p_client_request_id) > 100 THEN
    RAISE EXCEPTION 'INVALID_CLIENT_REQUEST_ID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text || ':payment_order', 0));

  SELECT a.id AS account_id, a.tenant_id, a.status AS account_status,
         t.status AS tenant_status, t.tenant_type
  INTO v_actor
  FROM public.accounts a
  JOIN public.tenants t ON t.id = a.tenant_id
  WHERE a.user_id = p_auth_user_id AND a.deleted_at IS NULL AND t.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND OR v_actor.account_status <> 'active' OR v_actor.tenant_status <> 'active'
     OR v_actor.tenant_type <> 'self_service_customer' THEN
    RAISE EXCEPTION 'SELF_SERVICE_ACCOUNT_REQUIRED';
  END IF;

  SELECT * INTO v_existing
  FROM public.payment_orders
  WHERE account_id = v_actor.account_id AND client_request_id = btrim(p_client_request_id)
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'created', false, 'order', jsonb_build_object(
      'id', v_existing.id, 'order_code', v_existing.order_code, 'order_type', v_existing.order_type,
      'provider_order_code', v_existing.provider_order_code, 'status', v_existing.status,
      'total_amount', v_existing.total_amount, 'currency', v_existing.currency,
      'transfer_content', v_existing.transfer_content, 'checkout_url', v_existing.provider_checkout_url,
      'qr_code', v_existing.provider_qr_code, 'manual_review_available_at', v_existing.manual_review_available_at,
      'expires_at', v_existing.expires_at));
  END IF;

  SELECT * INTO v_existing
  FROM public.payment_orders
  WHERE account_id = v_actor.account_id
    AND status IN ('awaiting_payment', 'manual_review', 'payment_mismatch', 'webhook_invalid')
    AND expires_at > now()
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'created', false, 'order', jsonb_build_object(
      'id', v_existing.id, 'order_code', v_existing.order_code, 'order_type', v_existing.order_type,
      'provider_order_code', v_existing.provider_order_code, 'status', v_existing.status,
      'total_amount', v_existing.total_amount, 'currency', v_existing.currency,
      'transfer_content', v_existing.transfer_content, 'checkout_url', v_existing.provider_checkout_url,
      'qr_code', v_existing.provider_qr_code, 'manual_review_available_at', v_existing.manual_review_available_at,
      'expires_at', v_existing.expires_at));
  END IF;

  PERFORM public.advance_self_service_subscription_v1(v_actor.tenant_id);
  SELECT * INTO v_current
  FROM public.tenant_subscriptions
  WHERE tenant_id = v_actor.tenant_id
    AND status IN ('active', 'trial')
    AND start_date <= now() AND (end_date IS NULL OR end_date > now())
  ORDER BY start_date DESC, created_at DESC LIMIT 1 FOR UPDATE;
  v_has_current := FOUND;

  IF v_order_type = 'activation' AND v_has_current THEN RAISE EXCEPTION 'SUBSCRIPTION_ALREADY_ACTIVE'; END IF;
  IF v_order_type IN ('renewal', 'addon') AND NOT v_has_current THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_ACTIVE'; END IF;
  IF v_order_type = 'renewal' AND EXISTS (
    SELECT 1 FROM public.tenant_subscriptions
    WHERE tenant_id = v_actor.tenant_id AND status = 'scheduled'
  ) THEN RAISE EXCEPTION 'RENEWAL_ALREADY_SCHEDULED'; END IF;

  IF v_order_type = 'addon' THEN
    SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_current.plan_id AND is_active = true;
  ELSE
    SELECT * INTO v_plan FROM public.subscription_plans
    WHERE code = upper(btrim(p_plan_code)) AND billing_model = 'duration' AND is_active = true LIMIT 1;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_NOT_AVAILABLE'; END IF;

  v_base_amount := CASE WHEN v_order_type = 'addon' THEN 0 ELSE v_plan.price_vnd END;
  v_addon_amount := (v_event_addon + v_referee_addon) * 10000;
  v_duration_days := CASE WHEN v_order_type = 'addon' THEN NULL ELSE v_plan.duration_days END;
  v_provider_order_code := nextval('public.payment_provider_order_code_seq');

  INSERT INTO public.payment_orders(
    order_code, client_request_id, tenant_id, account_id, order_type, plan_id, status,
    base_amount, addon_amount, total_amount, duration_days_snapshot, transfer_content,
    payment_provider, provider_order_code, manual_review_available_at, expires_at, metadata
  ) VALUES (
    'PIC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    btrim(p_client_request_id), v_actor.tenant_id, v_actor.account_id, v_order_type, v_plan.id,
    'awaiting_payment', v_base_amount, v_addon_amount, v_base_amount + v_addon_amount,
    v_duration_days, 'PIC' || v_provider_order_code::text, 'payos', v_provider_order_code,
    now() + interval '5 minutes', now() + interval '24 hours',
    jsonb_build_object(
      'target_subscription_id', CASE WHEN v_has_current THEN v_current.id ELSE NULL END,
      'base_tournament_limit', v_plan.max_active_tournaments,
      'base_event_limit', v_plan.max_events,
      'base_referee_limit', v_plan.max_active_referees
    )
  ) RETURNING * INTO v_order;

  IF v_order_type <> 'addon' THEN
    INSERT INTO public.payment_order_items(order_id, item_type, description, quantity, unit_price, amount, metadata)
    VALUES (v_order.id, 'plan', v_plan.name, 1, v_plan.price_vnd, v_plan.price_vnd,
      jsonb_build_object('plan_code', v_plan.code, 'duration_days', v_plan.duration_days));
  END IF;
  IF v_event_addon > 0 THEN
    INSERT INTO public.payment_order_items(order_id, item_type, description, quantity, unit_price, amount)
    VALUES (v_order.id, 'event_addon', 'Nội dung thi đấu mua thêm', v_event_addon, 10000, v_event_addon * 10000);
  END IF;
  IF v_referee_addon > 0 THEN
    INSERT INTO public.payment_order_items(order_id, item_type, description, quantity, unit_price, amount)
    VALUES (v_order.id, 'referee_addon', 'Tài khoản trọng tài mua thêm', v_referee_addon, 10000, v_referee_addon * 10000);
  END IF;

  INSERT INTO public.audit_logs(
    timestamp, action, details, tenant_id, actor_account_id, actor_role,
    category, entity_type, entity_id, result, details_json
  ) VALUES (
    now()::text, 'COMMERCIAL_ORDER_CREATED',
    jsonb_build_object('order_type', v_order_type, 'plan_code', v_plan.code, 'total_amount', v_order.total_amount, 'currency', 'VND')::text,
    v_actor.tenant_id, v_actor.account_id, 'EVENT_ADMIN', 'billing', 'payment_order', v_order.id::text, 'allow',
    jsonb_build_object('order_type', v_order_type, 'plan_code', v_plan.code, 'total_amount', v_order.total_amount, 'currency', 'VND')
  );

  RETURN jsonb_build_object('success', true, 'created', true, 'order', jsonb_build_object(
    'id', v_order.id, 'order_code', v_order.order_code, 'order_type', v_order.order_type,
    'provider_order_code', v_order.provider_order_code, 'status', v_order.status,
    'total_amount', v_order.total_amount, 'currency', v_order.currency,
    'transfer_content', v_order.transfer_content, 'checkout_url', v_order.provider_checkout_url,
    'qr_code', v_order.provider_qr_code, 'manual_review_available_at', v_order.manual_review_available_at,
    'expires_at', v_order.expires_at));
END;
$$;

REVOKE ALL ON FUNCTION public.create_payment_order_v2(uuid,text,text,integer,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_order_v2(uuid,text,text,integer,integer,text)
  TO service_role;

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
  v_target public.tenant_subscriptions%ROWTYPE;
  v_current_id uuid;
  v_target_id uuid;
  v_event_addon integer := 0;
  v_referee_addon integer := 0;
  v_item_total numeric(12, 0) := 0;
  v_invoice_id uuid;
  v_period_number integer := 1;
  v_period_start timestamptz;
  v_period_status text;
  v_base_tournament_limit integer;
  v_base_event_limit integer;
  v_base_referee_limit integer;
BEGIN
  IF v_claim_role IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  IF p_settlement_source NOT IN ('webhook', 'manual') THEN RAISE EXCEPTION 'INVALID_SETTLEMENT_SOURCE'; END IF;
  IF NULLIF(btrim(p_provider_transaction_id), '') IS NULL THEN RAISE EXCEPTION 'PROVIDER_TRANSACTION_REQUIRED'; END IF;

  SELECT * INTO v_order
  FROM public.payment_orders
  WHERE provider_order_code = p_provider_order_code
  FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'result', 'order_not_found'); END IF;
  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('success', true, 'result', 'already_paid', 'order_id', v_order.id,
      'subscription_id', v_order.metadata->>'subscription_id');
  END IF;

  IF v_order.status IN ('expired', 'cancelled', 'rejected') OR v_order.expires_at <= now() THEN
    IF v_order.expires_at <= now() AND v_order.status NOT IN ('expired', 'cancelled', 'rejected') THEN
      UPDATE public.payment_orders SET status = 'expired', updated_at = now() WHERE id = v_order.id;
    END IF;
    RETURN jsonb_build_object('success', false, 'result', 'order_not_payable', 'order_id', v_order.id);
  END IF;

  IF p_paid_amount IS NULL OR p_paid_amount <> v_order.total_amount THEN
    UPDATE public.payment_orders
    SET status = 'payment_mismatch', paid_amount = p_paid_amount,
        webhook_received_at = CASE WHEN p_settlement_source = 'webhook' THEN now() ELSE webhook_received_at END,
        updated_at = now()
    WHERE id = v_order.id;
    INSERT INTO public.audit_logs(
      timestamp, action, details, tenant_id, actor_account_id, actor_role,
      category, entity_type, entity_id, result, reason, details_json
    ) VALUES (
      now()::text, 'PAYMENT_MISMATCH_DETECTED',
      jsonb_build_object('expected_amount', v_order.total_amount, 'received_amount', p_paid_amount,
        'settlement_source', p_settlement_source)::text,
      v_order.tenant_id, COALESCE(p_confirmed_by, v_order.account_id),
      CASE WHEN p_settlement_source = 'manual' THEN 'SUPER_ADMIN' ELSE 'PAYMENT_PROVIDER' END,
      'billing', 'payment_order', v_order.id::text, 'deny', 'PAYMENT_MISMATCH',
      jsonb_build_object('expected_amount', v_order.total_amount, 'received_amount', p_paid_amount,
        'settlement_source', p_settlement_source)
    );
    RETURN jsonb_build_object('success', false, 'result', 'payment_mismatch', 'order_id', v_order.id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_orders
    WHERE provider_transaction_id = p_provider_transaction_id AND id <> v_order.id
  ) THEN RAISE EXCEPTION 'PROVIDER_TRANSACTION_ALREADY_USED'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.accounts a
    JOIN public.tenants t ON t.id = a.tenant_id
    WHERE a.id = v_order.account_id AND a.tenant_id = v_order.tenant_id
      AND a.status = 'active' AND a.deleted_at IS NULL
      AND t.status = 'active' AND t.deleted_at IS NULL
      AND t.tenant_type = 'self_service_customer'
  ) THEN RAISE EXCEPTION 'ORDER_ACCOUNT_NOT_ACTIVE'; END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_order.plan_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_NOT_AVAILABLE'; END IF;

  SELECT
    COALESCE(sum(quantity) FILTER (WHERE item_type = 'event_addon'), 0),
    COALESCE(sum(quantity) FILTER (WHERE item_type = 'referee_addon'), 0),
    COALESCE(sum(amount), 0)
  INTO v_event_addon, v_referee_addon, v_item_total
  FROM public.payment_order_items WHERE order_id = v_order.id;
  IF v_item_total <> v_order.total_amount THEN RAISE EXCEPTION 'ORDER_ITEM_TOTAL_MISMATCH'; END IF;

  v_base_tournament_limit := COALESCE((v_order.metadata->>'base_tournament_limit')::integer, v_plan.max_active_tournaments);
  v_base_event_limit := COALESCE((v_order.metadata->>'base_event_limit')::integer, v_plan.max_events);
  v_base_referee_limit := COALESCE((v_order.metadata->>'base_referee_limit')::integer, v_plan.max_active_referees);

  PERFORM public.advance_self_service_subscription_v1(v_order.tenant_id);

  IF v_order.order_type = 'activation' THEN
    SELECT id INTO v_current_id
    FROM public.tenant_subscriptions
    WHERE tenant_id = v_order.tenant_id AND status IN ('active', 'trial')
      AND start_date <= now() AND (end_date IS NULL OR end_date > now())
    LIMIT 1 FOR UPDATE;
    IF FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_ALREADY_ACTIVE'; END IF;

    v_period_start := now();
    v_period_status := 'active';
    SELECT COALESCE(max(period_number), 0) + 1 INTO v_period_number
    FROM public.tenant_subscriptions WHERE tenant_id = v_order.tenant_id;

    INSERT INTO public.tenant_subscriptions(
      tenant_id, plan_id, status, start_date, end_date, auto_renew,
      activated_at, activation_order_id, confirmed_by, period_number
    ) VALUES (
      v_order.tenant_id, v_plan.id, v_period_status, v_period_start,
      v_period_start + make_interval(days => v_order.duration_days_snapshot), false,
      now(), v_order.id, p_confirmed_by, v_period_number
    ) RETURNING * INTO v_subscription;

    INSERT INTO public.subscription_entitlements(subscription_id, resource_type, base_limit, addon_limit)
    VALUES
      (v_subscription.id, 'tournaments', v_base_tournament_limit, 0),
      (v_subscription.id, 'events', v_base_event_limit, v_event_addon),
      (v_subscription.id, 'referees', v_base_referee_limit, v_referee_addon);

  ELSIF v_order.order_type = 'renewal' THEN
    v_target_id := (v_order.metadata->>'target_subscription_id')::uuid;
    SELECT * INTO v_target FROM public.tenant_subscriptions
    WHERE id = v_target_id AND tenant_id = v_order.tenant_id FOR UPDATE;
    IF NOT FOUND OR v_target.status IN ('cancelled', 'suspended') OR v_target.end_date IS NULL THEN
      RAISE EXCEPTION 'RENEWAL_TARGET_NOT_AVAILABLE';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.tenant_subscriptions
      WHERE tenant_id = v_order.tenant_id AND status = 'scheduled'
    ) THEN RAISE EXCEPTION 'RENEWAL_ALREADY_SCHEDULED'; END IF;

    v_period_start := GREATEST(v_target.end_date, now());
    v_period_status := CASE WHEN v_period_start > now() THEN 'scheduled' ELSE 'active' END;
    SELECT COALESCE(max(period_number), 0) + 1 INTO v_period_number
    FROM public.tenant_subscriptions WHERE tenant_id = v_order.tenant_id;

    INSERT INTO public.tenant_subscriptions(
      tenant_id, plan_id, status, start_date, end_date, auto_renew,
      activated_at, activation_order_id, confirmed_by, period_number
    ) VALUES (
      v_order.tenant_id, v_plan.id, v_period_status, v_period_start,
      v_period_start + make_interval(days => v_order.duration_days_snapshot), false,
      CASE WHEN v_period_status = 'active' THEN now() ELSE NULL END,
      v_order.id, p_confirmed_by, v_period_number
    ) RETURNING * INTO v_subscription;

    INSERT INTO public.subscription_entitlements(subscription_id, resource_type, base_limit, addon_limit)
    VALUES
      (v_subscription.id, 'tournaments', v_base_tournament_limit, 0),
      (v_subscription.id, 'events', v_base_event_limit, v_event_addon),
      (v_subscription.id, 'referees', v_base_referee_limit, v_referee_addon);

  ELSIF v_order.order_type = 'addon' THEN
    v_target_id := (v_order.metadata->>'target_subscription_id')::uuid;
    SELECT * INTO v_target FROM public.tenant_subscriptions
    WHERE id = v_target_id AND tenant_id = v_order.tenant_id
      AND status IN ('active', 'trial')
      AND start_date <= now() AND (end_date IS NULL OR end_date > now())
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ADDON_TARGET_NOT_ACTIVE'; END IF;
    IF v_event_addon + v_referee_addon = 0 THEN RAISE EXCEPTION 'ADDON_QUANTITY_REQUIRED'; END IF;

    INSERT INTO public.subscription_entitlements(subscription_id, resource_type, base_limit, addon_limit)
    VALUES
      (v_target.id, 'events', v_base_event_limit, v_event_addon),
      (v_target.id, 'referees', v_base_referee_limit, v_referee_addon)
    ON CONFLICT (subscription_id, resource_type) DO UPDATE
    SET addon_limit = public.subscription_entitlements.addon_limit + EXCLUDED.addon_limit,
        updated_at = now();
    v_subscription := v_target;
  ELSE
    RAISE EXCEPTION 'ORDER_TYPE_NOT_SUPPORTED';
  END IF;

  INSERT INTO public.invoices(
    tenant_id, subscription_id, invoice_number, billing_period,
    amount, status, invoice_date, due_date, paid_at
  ) VALUES (
    v_order.tenant_id, v_subscription.id, 'INV-' || replace(v_order.order_code, 'PIC-', ''),
    CASE WHEN v_order.order_type = 'addon' THEN 'addon'
         ELSE v_order.duration_days_snapshot::text || ' days' END,
    v_order.total_amount, 'paid', now(), now(), now()
  ) RETURNING id INTO v_invoice_id;

  UPDATE public.self_service_customer_profiles
  SET onboarding_status = 'ready', updated_at = now()
  WHERE account_id = v_order.account_id;

  UPDATE public.payment_orders
  SET status = 'paid', provider_transaction_id = btrim(p_provider_transaction_id),
      paid_amount = p_paid_amount, paid_at = now(), settlement_source = p_settlement_source,
      webhook_received_at = CASE WHEN p_settlement_source = 'webhook' THEN now() ELSE webhook_received_at END,
      confirmed_at = now(), confirmed_by = p_confirmed_by,
      metadata = metadata || jsonb_build_object('subscription_id', v_subscription.id, 'invoice_id', v_invoice_id),
      updated_at = now()
  WHERE id = v_order.id;

  INSERT INTO public.audit_logs(
    timestamp, action, details, tenant_id, actor_account_id, actor_role,
    category, entity_type, entity_id, result, details_json
  ) VALUES (
    now()::text,
    CASE WHEN p_settlement_source = 'webhook' THEN 'PAYMENT_AUTO_SETTLED' ELSE 'PAYMENT_MANUAL_CONFIRMED' END,
    jsonb_build_object('order_id', v_order.id, 'order_type', v_order.order_type,
      'account_id', v_order.account_id, 'expected_amount', v_order.total_amount,
      'received_amount', p_paid_amount, 'currency', v_order.currency,
      'settlement_source', p_settlement_source, 'subscription_id', v_subscription.id)::text,
    v_order.tenant_id, COALESCE(p_confirmed_by, v_order.account_id),
    CASE WHEN p_settlement_source = 'manual' THEN 'SUPER_ADMIN' ELSE 'PAYMENT_PROVIDER' END,
    'billing', 'payment_order', v_order.id::text, 'allow',
    jsonb_build_object('order_id', v_order.id, 'order_type', v_order.order_type,
      'account_id', v_order.account_id, 'expected_amount', v_order.total_amount,
      'received_amount', p_paid_amount, 'currency', v_order.currency,
      'settlement_source', p_settlement_source, 'subscription_id', v_subscription.id)
  );

  RETURN jsonb_build_object('success', true, 'result', 'paid', 'order_id', v_order.id,
    'order_type', v_order.order_type, 'subscription_id', v_subscription.id, 'invoice_id', v_invoice_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_commercial_access_state_v1()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account record;
  v_subscription record;
  v_scheduled record;
  v_usage jsonb := NULL;
  v_entitlements jsonb := '[]'::jsonb;
  v_state text;
  v_has_subscription boolean := false;
  v_has_scheduled boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT a.id AS account_id, a.tenant_id, a.status AS account_status,
         t.name AS tenant_name, t.slug AS tenant_slug, t.status AS tenant_status,
         t.tenant_type, sscp.onboarding_status
  INTO v_account
  FROM public.accounts a
  JOIN public.tenants t ON t.id = a.tenant_id
  LEFT JOIN public.self_service_customer_profiles sscp ON sscp.account_id = a.id
  WHERE a.user_id = auth.uid() AND a.deleted_at IS NULL AND t.deleted_at IS NULL
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND'; END IF;

  IF v_account.tenant_type <> 'self_service_customer' THEN
    RETURN jsonb_build_object('success', true, 'commercial_state', 'not_applicable',
      'tenant_type', v_account.tenant_type, 'business_access_active', true);
  END IF;

  PERFORM public.advance_self_service_subscription_v1(v_account.tenant_id);

  SELECT ts.id, ts.status, ts.start_date, ts.end_date, ts.plan_id,
         sp.code AS plan_code, sp.name AS plan_name, sp.duration_days
  INTO v_subscription
  FROM public.tenant_subscriptions ts
  JOIN public.subscription_plans sp ON sp.id = ts.plan_id
  WHERE ts.tenant_id = v_account.tenant_id
    AND ts.status IN ('active', 'trial')
    AND ts.start_date <= now() AND (ts.end_date IS NULL OR ts.end_date > now())
  ORDER BY ts.start_date DESC, ts.created_at DESC LIMIT 1;
  v_has_subscription := FOUND;

  SELECT ts.id, ts.status, ts.start_date, ts.end_date, sp.code AS plan_code, sp.name AS plan_name
  INTO v_scheduled
  FROM public.tenant_subscriptions ts
  JOIN public.subscription_plans sp ON sp.id = ts.plan_id
  WHERE ts.tenant_id = v_account.tenant_id AND ts.status = 'scheduled'
  ORDER BY ts.start_date, ts.created_at LIMIT 1;
  v_has_scheduled := FOUND;

  IF v_has_subscription THEN
    v_state := 'active';
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'resource_type', se.resource_type, 'base_limit', se.base_limit,
      'addon_limit', se.addon_limit, 'effective_limit', se.base_limit + se.addon_limit
    ) ORDER BY se.resource_type), '[]'::jsonb)
    INTO v_entitlements
    FROM public.subscription_entitlements se WHERE se.subscription_id = v_subscription.id;

    SELECT to_jsonb(tu) INTO v_usage FROM public.tenant_usage tu
    WHERE tu.tenant_id = v_account.tenant_id;
  ELSE
    v_state := CASE WHEN EXISTS (
      SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id = v_account.tenant_id
    ) THEN 'expired' ELSE 'locked' END;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'commercial_state', v_state, 'business_access_active', v_state = 'active',
    'tenant', jsonb_build_object('id', v_account.tenant_id, 'name', v_account.tenant_name,
      'slug', v_account.tenant_slug, 'type', v_account.tenant_type, 'status', v_account.tenant_status),
    'account', jsonb_build_object('id', v_account.account_id, 'status', v_account.account_status,
      'onboarding_status', v_account.onboarding_status),
    'subscription', CASE WHEN NOT v_has_subscription THEN NULL ELSE jsonb_build_object(
      'id', v_subscription.id, 'status', v_subscription.status,
      'start_date', v_subscription.start_date, 'end_date', v_subscription.end_date,
      'plan_id', v_subscription.plan_id, 'plan_code', v_subscription.plan_code,
      'plan_name', v_subscription.plan_name, 'duration_days', v_subscription.duration_days) END,
    'scheduled_renewal', CASE WHEN NOT v_has_scheduled THEN NULL ELSE jsonb_build_object(
      'id', v_scheduled.id, 'status', v_scheduled.status,
      'start_date', v_scheduled.start_date, 'end_date', v_scheduled.end_date,
      'plan_code', v_scheduled.plan_code, 'plan_name', v_scheduled.plan_name) END,
    'entitlements', v_entitlements, 'usage', v_usage, 'server_time', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.advance_self_service_subscription_v1(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.business_access_active_v1(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_business_access_v1(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_payment_order_v1(bigint,text,numeric,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_payment_order_v1(bigint,text,numeric,text,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.get_commercial_access_state_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commercial_access_state_v1() TO authenticated;

COMMIT;
