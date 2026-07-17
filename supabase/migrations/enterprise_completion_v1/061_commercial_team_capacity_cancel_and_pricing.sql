-- Commercial quota hardening: per-event team capacity, 20k add-ons,
-- safe payment cancellation, and backward-compatible settlement.

BEGIN;

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS max_teams_per_event integer NOT NULL DEFAULT 48;

UPDATE public.subscription_plans
SET max_teams_per_event = CASE
  WHEN billing_model = 'duration' AND code IN ('SELF_3D', 'SELF_7D', 'SELF_30D', 'SELF_60D') THEN 48
  ELSE 96
END,
updated_at = now();

ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_max_teams_per_event_check;
ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_max_teams_per_event_check
  CHECK (max_teams_per_event BETWEEN 1 AND 96);

ALTER TABLE public.subscription_entitlements
  DROP CONSTRAINT IF EXISTS subscription_entitlements_resource_type_check;
ALTER TABLE public.subscription_entitlements
  ADD CONSTRAINT subscription_entitlements_resource_type_check
  CHECK (resource_type IN ('tournaments', 'events', 'referees', 'teams_per_event'));

ALTER TABLE public.payment_order_items
  DROP CONSTRAINT IF EXISTS payment_order_items_item_type_check;
ALTER TABLE public.payment_order_items
  ADD CONSTRAINT payment_order_items_item_type_check
  CHECK (item_type IN ('plan', 'event_addon', 'referee_addon', 'team_capacity'));

-- Preserve existing production usage. A current period receives the smallest
-- supported tier that can contain its largest event, capped at the hard limit.
WITH event_team_usage AS (
  SELECT e.tenant_id, max(team_count)::integer AS largest_event_team_count
  FROM public.events e
  LEFT JOIN LATERAL (
    SELECT count(*) AS team_count
    FROM public.teams tm
    WHERE tm.event_id = e.id
      AND tm.deleted_at IS NULL
  ) usage ON true
  WHERE e.deleted_at IS NULL
    AND COALESCE(e.status, 'active') <> 'archived'
  GROUP BY e.tenant_id
)
INSERT INTO public.subscription_entitlements(
  subscription_id,
  resource_type,
  base_limit,
  addon_limit
)
SELECT
  ts.id,
  'teams_per_event',
  CASE
    WHEN t.tenant_type <> 'self_service_customer' THEN 96
    WHEN COALESCE(etu.largest_event_team_count, 0) <= 48 THEN 48
    WHEN etu.largest_event_team_count <= 64 THEN 64
    ELSE 96
  END,
  0
FROM public.tenant_subscriptions ts
JOIN public.tenants t ON t.id = ts.tenant_id
LEFT JOIN event_team_usage etu ON etu.tenant_id = ts.tenant_id
WHERE ts.status IN ('active', 'trial', 'scheduled')
ON CONFLICT (subscription_id, resource_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.commercial_team_capacity_price_v1(p_capacity integer)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  RETURN CASE p_capacity
    WHEN 48 THEN 0
    WHEN 64 THEN 50000
    WHEN 96 THEN 100000
    ELSE NULL
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_self_service_plans_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', sp.id,
    'code', sp.code,
    'name', sp.name,
    'description', sp.description,
    'duration_days', sp.duration_days,
    'price_vnd', sp.price_vnd,
    'max_active_tournaments', sp.max_active_tournaments,
    'max_events', sp.max_events,
    'max_active_referees', sp.max_active_referees,
    'max_teams_per_event', sp.max_teams_per_event,
    'event_addon_price_vnd', 20000,
    'referee_addon_price_vnd', 20000,
    'team_capacity_options', jsonb_build_array(
      jsonb_build_object('limit', 48, 'price_vnd', 0),
      jsonb_build_object('limit', 64, 'price_vnd', 50000),
      jsonb_build_object('limit', 96, 'price_vnd', 100000)
    )
  ) ORDER BY sp.duration_days), '[]'::jsonb)
  FROM public.subscription_plans sp
  WHERE sp.billing_model = 'duration'
    AND sp.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.ensure_event_team_quota_v1(
  p_event_id text,
  p_expected_tenant_id uuid,
  p_delta integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_event record;
  v_tenant_type text;
  v_subscription_id uuid;
  v_limit integer;
  v_used bigint;
BEGIN
  IF NULLIF(btrim(p_event_id), '') IS NULL OR p_expected_tenant_id IS NULL THEN
    RAISE EXCEPTION 'EVENT_CONTEXT_REQUIRED';
  END IF;
  IF p_delta IS NULL OR p_delta < 1 THEN
    RAISE EXCEPTION 'INVALID_QUOTA_DELTA';
  END IF;

  SELECT e.id, e.tenant_id, t.tenant_type
  INTO v_event
  FROM public.events e
  JOIN public.tenants t ON t.id = e.tenant_id
  WHERE e.id = p_event_id
    AND e.deleted_at IS NULL
    AND COALESCE(e.status, 'active') <> 'archived'
    AND t.deleted_at IS NULL
    AND COALESCE(t.status, 'active') = 'active'
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_FOUND'; END IF;
  IF v_event.tenant_id <> p_expected_tenant_id THEN
    RAISE EXCEPTION 'INVALID_TEAM_EVENT_CONTEXT';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id || ':teams_per_event', 0));
  v_tenant_type := v_event.tenant_type;

  IF v_tenant_type = 'self_service_customer' THEN
    PERFORM public.ensure_business_access_v1(v_event.tenant_id);
    SELECT ts.id
    INTO v_subscription_id
    FROM public.tenant_subscriptions ts
    WHERE ts.tenant_id = v_event.tenant_id
      AND ts.status IN ('active', 'trial')
      AND ts.start_date <= now()
      AND (ts.end_date IS NULL OR ts.end_date > now())
    ORDER BY ts.start_date DESC, ts.created_at DESC
    LIMIT 1;

    IF v_subscription_id IS NULL THEN RAISE EXCEPTION 'SUBSCRIPTION_INACTIVE'; END IF;

    SELECT COALESCE(se.base_limit + se.addon_limit, sp.max_teams_per_event, 48)
    INTO v_limit
    FROM public.tenant_subscriptions ts
    JOIN public.subscription_plans sp ON sp.id = ts.plan_id
    LEFT JOIN public.subscription_entitlements se
      ON se.subscription_id = ts.id
     AND se.resource_type = 'teams_per_event'
    WHERE ts.id = v_subscription_id;
  ELSE
    v_limit := 96;
  END IF;

  v_limit := LEAST(COALESCE(v_limit, 48), 96);
  SELECT count(*) INTO v_used
  FROM public.teams tm
  WHERE tm.event_id = p_event_id
    AND tm.deleted_at IS NULL;

  IF v_used + p_delta > v_limit THEN
    RAISE EXCEPTION 'TEAM_EVENT_QUOTA_EXCEEDED:%/%', v_used, v_limit;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_saas_quota_trigger_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_resource text;
  v_new_counted boolean;
  v_old_counted boolean := false;
  v_should_check boolean;
  v_is_initial_self_service_owner boolean := false;
BEGIN
  v_resource := CASE TG_TABLE_NAME
    WHEN 'accounts' THEN 'accounts'
    WHEN 'events' THEN 'events'
    WHEN 'teams' THEN 'teams'
    WHEN 'tournament' THEN 'tournaments'
    ELSE NULL
  END;
  IF v_resource IS NULL THEN RAISE EXCEPTION 'INVALID_QUOTA_RESOURCE'; END IF;

  v_new_counted := (to_jsonb(NEW)->>'deleted_at') IS NULL
    AND (
      TG_TABLE_NAME NOT IN ('events', 'tournament')
      OR COALESCE(to_jsonb(NEW)->>'status', 'active') <> 'archived'
    );

  IF TG_OP = 'UPDATE' THEN
    v_old_counted := (to_jsonb(OLD)->>'deleted_at') IS NULL
      AND (
        TG_TABLE_NAME NOT IN ('events', 'tournament')
        OR COALESCE(to_jsonb(OLD)->>'status', 'active') <> 'archived'
      );
  END IF;

  IF TG_TABLE_NAME = 'teams' THEN
    v_should_check := v_new_counted AND (
      TG_OP = 'INSERT'
      OR NOT v_old_counted
      OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.event_id IS DISTINCT FROM OLD.event_id
    );
  ELSE
    v_should_check := v_new_counted AND (
      TG_OP = 'INSERT'
      OR NOT v_old_counted
      OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    );
  END IF;

  IF v_should_check AND TG_TABLE_NAME = 'accounts' AND TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':accounts', 0));
    SELECT EXISTS (
      SELECT 1 FROM public.tenants t
      WHERE t.id = NEW.tenant_id
        AND t.tenant_type = 'self_service_customer'
        AND t.deleted_at IS NULL
        AND COALESCE(t.status, 'active') = 'active'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.tenant_id = NEW.tenant_id AND a.deleted_at IS NULL
    ) INTO v_is_initial_self_service_owner;
  END IF;

  IF v_should_check AND NOT v_is_initial_self_service_owner THEN
    IF TG_TABLE_NAME = 'teams' THEN
      PERFORM public.ensure_event_team_quota_v1(NEW.event_id, NEW.tenant_id, 1);
    ELSE
      PERFORM public.ensure_tenant_quota_v1(NEW.tenant_id, v_resource, 1);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_teams_saas_quota_v1 ON public.teams;
CREATE TRIGGER trg_teams_saas_quota_v1
BEFORE INSERT OR UPDATE OF deleted_at, tenant_id, event_id ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.enforce_saas_quota_trigger_v1();

CREATE OR REPLACE FUNCTION public.create_payment_order_v3(
  p_auth_user_id uuid,
  p_order_type text,
  p_plan_code text DEFAULT NULL,
  p_extra_event_quantity integer DEFAULT 0,
  p_extra_referee_quantity integer DEFAULT 0,
  p_team_capacity_limit integer DEFAULT NULL,
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
  v_current_team_capacity integer := 48;
  v_current_team_usage integer := 0;
  v_target_team_capacity integer;
  v_team_capacity_surcharge numeric(12, 0) := 0;
  v_base_amount numeric(12, 0) := 0;
  v_addon_amount numeric(12, 0);
  v_duration_days integer;
  v_event_addon_price constant integer := 20000;
  v_referee_addon_price constant integer := 20000;
BEGIN
  IF v_claim_role IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  IF p_auth_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_USER_REQUIRED'; END IF;
  IF v_order_type NOT IN ('activation', 'renewal', 'addon') THEN RAISE EXCEPTION 'INVALID_ORDER_TYPE'; END IF;
  IF v_event_addon < 0 OR v_event_addon > 100 OR v_referee_addon < 0 OR v_referee_addon > 100 THEN
    RAISE EXCEPTION 'INVALID_ADDON_QUANTITY';
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
      'team_capacity_limit', v_existing.metadata->>'team_capacity_limit',
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
      'team_capacity_limit', v_existing.metadata->>'team_capacity_limit',
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

  IF v_has_current THEN
    SELECT COALESCE(se.base_limit + se.addon_limit, sp.max_teams_per_event, 48)
    INTO v_current_team_capacity
    FROM public.tenant_subscriptions ts
    JOIN public.subscription_plans sp ON sp.id = ts.plan_id
    LEFT JOIN public.subscription_entitlements se
      ON se.subscription_id = ts.id AND se.resource_type = 'teams_per_event'
    WHERE ts.id = v_current.id;
  END IF;

  IF v_order_type = 'addon' THEN
    SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_current.plan_id AND is_active = true;
  ELSE
    SELECT * INTO v_plan FROM public.subscription_plans
    WHERE code = upper(btrim(p_plan_code)) AND billing_model = 'duration' AND is_active = true LIMIT 1;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_NOT_AVAILABLE'; END IF;

  v_target_team_capacity := CASE
    WHEN p_team_capacity_limit IS NOT NULL THEN p_team_capacity_limit
    WHEN v_order_type = 'activation' THEN COALESCE(v_plan.max_teams_per_event, 48)
    ELSE v_current_team_capacity
  END;

  IF v_target_team_capacity NOT IN (48, 64, 96) THEN RAISE EXCEPTION 'INVALID_TEAM_CAPACITY'; END IF;
  IF v_order_type IN ('renewal', 'addon') AND v_target_team_capacity < v_current_team_capacity THEN
    RAISE EXCEPTION 'TEAM_CAPACITY_DOWNGRADE_NOT_ALLOWED';
  END IF;

  SELECT COALESCE(max(team_count), 0)::integer
  INTO v_current_team_usage
  FROM (
    SELECT count(*) AS team_count
    FROM public.teams tm
    WHERE tm.tenant_id = v_actor.tenant_id
      AND tm.deleted_at IS NULL
    GROUP BY tm.event_id
  ) usage;
  IF v_target_team_capacity < v_current_team_usage THEN
    RAISE EXCEPTION 'TEAM_CAPACITY_BELOW_CURRENT_USAGE:%/%',
      v_target_team_capacity, v_current_team_usage;
  END IF;

  v_team_capacity_surcharge := CASE
    WHEN v_order_type = 'addon' THEN
      public.commercial_team_capacity_price_v1(v_target_team_capacity)
      - public.commercial_team_capacity_price_v1(v_current_team_capacity)
    ELSE public.commercial_team_capacity_price_v1(v_target_team_capacity)
  END;

  IF v_order_type = 'addon'
     AND v_event_addon + v_referee_addon = 0
     AND v_team_capacity_surcharge <= 0 THEN
    RAISE EXCEPTION 'ADDON_QUANTITY_REQUIRED';
  END IF;

  v_base_amount := CASE WHEN v_order_type = 'addon' THEN 0 ELSE v_plan.price_vnd END;
  v_addon_amount := (v_event_addon * v_event_addon_price)
    + (v_referee_addon * v_referee_addon_price)
    + v_team_capacity_surcharge;
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
      'base_referee_limit', v_plan.max_active_referees,
      'previous_team_capacity_limit', v_current_team_capacity,
      'team_capacity_limit', v_target_team_capacity,
      'team_capacity_surcharge_vnd', v_team_capacity_surcharge,
      'event_addon_price_vnd', v_event_addon_price,
      'referee_addon_price_vnd', v_referee_addon_price
    )
  ) RETURNING * INTO v_order;

  IF v_order_type <> 'addon' THEN
    INSERT INTO public.payment_order_items(order_id, item_type, description, quantity, unit_price, amount, metadata)
    VALUES (v_order.id, 'plan', v_plan.name, 1, v_plan.price_vnd, v_plan.price_vnd,
      jsonb_build_object('plan_code', v_plan.code, 'duration_days', v_plan.duration_days));
  END IF;
  IF v_event_addon > 0 THEN
    INSERT INTO public.payment_order_items(order_id, item_type, description, quantity, unit_price, amount)
    VALUES (v_order.id, 'event_addon', 'Nội dung thi đấu mua thêm', v_event_addon,
      v_event_addon_price, v_event_addon * v_event_addon_price);
  END IF;
  IF v_referee_addon > 0 THEN
    INSERT INTO public.payment_order_items(order_id, item_type, description, quantity, unit_price, amount)
    VALUES (v_order.id, 'referee_addon', 'Tài khoản trọng tài mua thêm', v_referee_addon,
      v_referee_addon_price, v_referee_addon * v_referee_addon_price);
  END IF;
  IF v_team_capacity_surcharge > 0 THEN
    INSERT INTO public.payment_order_items(order_id, item_type, description, quantity, unit_price, amount, metadata)
    VALUES (v_order.id, 'team_capacity', 'Sức chứa đội mỗi nội dung', 1,
      v_team_capacity_surcharge, v_team_capacity_surcharge,
      jsonb_build_object('from_limit', v_current_team_capacity, 'target_limit', v_target_team_capacity));
  END IF;

  INSERT INTO public.audit_logs(
    timestamp, action, details, tenant_id, actor_account_id, actor_role,
    category, entity_type, entity_id, result, details_json
  ) VALUES (
    now()::text, 'COMMERCIAL_ORDER_CREATED',
    jsonb_build_object('order_type', v_order_type, 'plan_code', v_plan.code,
      'extra_events', v_event_addon, 'extra_referees', v_referee_addon,
      'team_capacity_limit', v_target_team_capacity,
      'total_amount', v_order.total_amount, 'currency', 'VND')::text,
    v_actor.tenant_id, v_actor.account_id, 'EVENT_ADMIN', 'billing',
    'payment_order', v_order.id::text, 'allow',
    jsonb_build_object('order_type', v_order_type, 'plan_code', v_plan.code,
      'extra_events', v_event_addon, 'extra_referees', v_referee_addon,
      'team_capacity_limit', v_target_team_capacity,
      'total_amount', v_order.total_amount, 'currency', 'VND')
  );

  RETURN jsonb_build_object('success', true, 'created', true, 'order', jsonb_build_object(
    'id', v_order.id, 'order_code', v_order.order_code, 'order_type', v_order.order_type,
    'provider_order_code', v_order.provider_order_code, 'status', v_order.status,
    'total_amount', v_order.total_amount, 'currency', v_order.currency,
    'transfer_content', v_order.transfer_content, 'checkout_url', v_order.provider_checkout_url,
    'qr_code', v_order.provider_qr_code, 'manual_review_available_at', v_order.manual_review_available_at,
    'team_capacity_limit', v_target_team_capacity,
    'expires_at', v_order.expires_at));
END;
$$;

-- Keep the canonical API transition safe while an older deployment is still live.
CREATE OR REPLACE FUNCTION public.create_payment_order_v2(
  p_auth_user_id uuid,
  p_order_type text,
  p_plan_code text DEFAULT NULL,
  p_extra_event_quantity integer DEFAULT 0,
  p_extra_referee_quantity integer DEFAULT 0,
  p_client_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT public.create_payment_order_v3(
    p_auth_user_id,
    p_order_type,
    p_plan_code,
    p_extra_event_quantity,
    p_extra_referee_quantity,
    NULL,
    p_client_request_id
  );
$$;

CREATE OR REPLACE FUNCTION public.settle_payment_order_v2(
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
  v_team_capacity_limit integer;
  v_current_team_capacity integer := 48;
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
  v_team_capacity_limit := COALESCE((v_order.metadata->>'team_capacity_limit')::integer, v_plan.max_teams_per_event, 48);
  IF v_team_capacity_limit NOT IN (48, 64, 96) THEN RAISE EXCEPTION 'INVALID_TEAM_CAPACITY'; END IF;

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
      (v_subscription.id, 'referees', v_base_referee_limit, v_referee_addon),
      (v_subscription.id, 'teams_per_event', v_team_capacity_limit, 0);

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
      (v_subscription.id, 'referees', v_base_referee_limit, v_referee_addon),
      (v_subscription.id, 'teams_per_event', v_team_capacity_limit, 0);

  ELSIF v_order.order_type = 'addon' THEN
    v_target_id := (v_order.metadata->>'target_subscription_id')::uuid;
    SELECT * INTO v_target FROM public.tenant_subscriptions
    WHERE id = v_target_id AND tenant_id = v_order.tenant_id
      AND status IN ('active', 'trial')
      AND start_date <= now() AND (end_date IS NULL OR end_date > now())
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ADDON_TARGET_NOT_ACTIVE'; END IF;

    SELECT COALESCE(se.base_limit + se.addon_limit, v_plan.max_teams_per_event, 48)
    INTO v_current_team_capacity
    FROM public.subscription_entitlements se
    WHERE se.subscription_id = v_target.id AND se.resource_type = 'teams_per_event';
    v_current_team_capacity := COALESCE(v_current_team_capacity, 48);

    IF v_event_addon + v_referee_addon = 0
       AND v_team_capacity_limit <= v_current_team_capacity THEN
      RAISE EXCEPTION 'ADDON_QUANTITY_REQUIRED';
    END IF;

    INSERT INTO public.subscription_entitlements(subscription_id, resource_type, base_limit, addon_limit)
    VALUES
      (v_target.id, 'events', v_base_event_limit, v_event_addon),
      (v_target.id, 'referees', v_base_referee_limit, v_referee_addon)
    ON CONFLICT (subscription_id, resource_type) DO UPDATE
    SET addon_limit = public.subscription_entitlements.addon_limit + EXCLUDED.addon_limit,
        updated_at = now();

    INSERT INTO public.subscription_entitlements(subscription_id, resource_type, base_limit, addon_limit)
    VALUES (v_target.id, 'teams_per_event', v_team_capacity_limit, 0)
    ON CONFLICT (subscription_id, resource_type) DO UPDATE
    SET base_limit = GREATEST(
          public.subscription_entitlements.base_limit + public.subscription_entitlements.addon_limit,
          EXCLUDED.base_limit
        ),
        addon_limit = 0,
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
      'settlement_source', p_settlement_source, 'subscription_id', v_subscription.id,
      'team_capacity_limit', v_team_capacity_limit)::text,
    v_order.tenant_id, COALESCE(p_confirmed_by, v_order.account_id),
    CASE WHEN p_settlement_source = 'manual' THEN 'SUPER_ADMIN' ELSE 'PAYMENT_PROVIDER' END,
    'billing', 'payment_order', v_order.id::text, 'allow',
    jsonb_build_object('order_id', v_order.id, 'order_type', v_order.order_type,
      'account_id', v_order.account_id, 'expected_amount', v_order.total_amount,
      'received_amount', p_paid_amount, 'currency', v_order.currency,
      'settlement_source', p_settlement_source, 'subscription_id', v_subscription.id,
      'team_capacity_limit', v_team_capacity_limit)
  );

  RETURN jsonb_build_object('success', true, 'result', 'paid', 'order_id', v_order.id,
    'order_type', v_order.order_type, 'subscription_id', v_subscription.id,
    'invoice_id', v_invoice_id, 'team_capacity_limit', v_team_capacity_limit);
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
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT public.settle_payment_order_v2(
    p_provider_order_code,
    p_provider_transaction_id,
    p_paid_amount,
    p_settlement_source,
    p_confirmed_by
  );
$$;

CREATE OR REPLACE FUNCTION public.cancel_payment_order_v1(
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
  v_actor record;
  v_order public.payment_orders%ROWTYPE;
BEGIN
  IF v_claim_role IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  IF p_auth_user_id IS NULL OR p_order_id IS NULL THEN RAISE EXCEPTION 'INVALID_CANCEL_REQUEST'; END IF;

  SELECT a.id AS account_id, a.tenant_id
  INTO v_actor
  FROM public.accounts a
  JOIN public.tenants t ON t.id = a.tenant_id
  WHERE a.user_id = p_auth_user_id
    AND a.status = 'active'
    AND a.deleted_at IS NULL
    AND t.status = 'active'
    AND t.deleted_at IS NULL
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_ACTIVE'; END IF;

  SELECT * INTO v_order
  FROM public.payment_orders
  WHERE id = p_order_id
    AND account_id = v_actor.account_id
    AND tenant_id = v_actor.tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'result', 'already_cancelled', 'order_id', v_order.id);
  END IF;
  IF v_order.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'ORDER_NOT_CANCELLABLE';
  END IF;

  UPDATE public.payment_orders
  SET status = 'cancelled',
      metadata = metadata || jsonb_build_object(
        'cancelled_at', now(),
        'cancelled_by_account_id', v_actor.account_id,
        'cancellation_reason', 'CUSTOMER_REQUEST'
      ),
      updated_at = now()
  WHERE id = v_order.id;

  INSERT INTO public.audit_logs(
    timestamp, action, details, tenant_id, actor_account_id, actor_role,
    category, entity_type, entity_id, result, details_json
  ) VALUES (
    now()::text, 'PAYMENT_ORDER_CANCELLED',
    jsonb_build_object('order_id', v_order.id, 'order_code', v_order.order_code,
      'previous_status', v_order.status, 'reason', 'CUSTOMER_REQUEST')::text,
    v_order.tenant_id, v_actor.account_id, 'EVENT_ADMIN', 'billing',
    'payment_order', v_order.id::text, 'allow',
    jsonb_build_object('order_id', v_order.id, 'order_code', v_order.order_code,
      'previous_status', v_order.status, 'reason', 'CUSTOMER_REQUEST')
  );

  RETURN jsonb_build_object(
    'success', true,
    'result', 'cancelled',
    'order_id', v_order.id,
    'provider_order_code', v_order.provider_order_code,
    'provider_order_id', v_order.provider_order_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commercial_team_capacity_price_v1(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_event_team_quota_v1(text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_saas_quota_trigger_v1()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_payment_order_v3(uuid,text,text,integer,integer,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_order_v3(uuid,text,text,integer,integer,integer,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.create_payment_order_v2(uuid,text,text,integer,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_order_v2(uuid,text,text,integer,integer,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.settle_payment_order_v2(bigint,text,numeric,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_payment_order_v2(bigint,text,numeric,text,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.settle_payment_order_v1(bigint,text,numeric,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_payment_order_v1(bigint,text,numeric,text,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.cancel_payment_order_v1(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_payment_order_v1(uuid,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.list_self_service_plans_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_self_service_plans_v1() TO authenticated;

COMMIT;
