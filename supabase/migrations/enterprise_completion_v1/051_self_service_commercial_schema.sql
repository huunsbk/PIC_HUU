-- Self-service commercialization PR-COM-02: plans, orders and period entitlements.

BEGIN;

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS billing_model text NOT NULL DEFAULT 'recurring',
  ADD COLUMN IF NOT EXISTS duration_days integer,
  ADD COLUMN IF NOT EXISTS price_vnd numeric(12, 0),
  ADD COLUMN IF NOT EXISTS max_active_tournaments integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_active_referees integer NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_subscription_plans_code
  ON public.subscription_plans(code)
  WHERE code IS NOT NULL;

ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_billing_model_check;
ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_billing_model_check
  CHECK (billing_model IN ('recurring', 'duration'));

ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_duration_check;
ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_duration_check
  CHECK (
    (billing_model = 'recurring')
    OR (billing_model = 'duration' AND duration_days > 0 AND price_vnd >= 0)
  );

INSERT INTO public.subscription_plans(
  name,
  description,
  code,
  billing_model,
  duration_days,
  price_vnd,
  max_users,
  max_events,
  max_teams,
  max_active_tournaments,
  max_active_referees,
  monthly_price,
  yearly_price,
  is_active
)
VALUES
  ('Self-service 3 ngày', 'Mở khóa vận hành giải trong 3 ngày', 'SELF_3D', 'duration', 3, 20000, 2, 3, 10000, 1, 1, 0, 0, true),
  ('Self-service 7 ngày', 'Mở khóa vận hành giải trong 7 ngày', 'SELF_7D', 'duration', 7, 50000, 2, 3, 10000, 1, 1, 0, 0, true),
  ('Self-service 30 ngày', 'Mở khóa vận hành giải trong 30 ngày', 'SELF_30D', 'duration', 30, 100000, 2, 3, 10000, 1, 1, 0, 0, true),
  ('Self-service 60 ngày', 'Mở khóa vận hành giải trong 60 ngày', 'SELF_60D', 'duration', 60, 200000, 2, 3, 10000, 1, 1, 0, 0, true)
ON CONFLICT (code) WHERE code IS NOT NULL DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  billing_model = EXCLUDED.billing_model,
  duration_days = EXCLUDED.duration_days,
  price_vnd = EXCLUDED.price_vnd,
  max_users = EXCLUDED.max_users,
  max_events = EXCLUDED.max_events,
  max_teams = EXCLUDED.max_teams,
  max_active_tournaments = EXCLUDED.max_active_tournaments,
  max_active_referees = EXCLUDED.max_active_referees,
  is_active = EXCLUDED.is_active,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code text NOT NULL UNIQUE,
  client_request_id text,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  order_type text NOT NULL CHECK (order_type IN ('activation', 'renewal', 'addon')),
  plan_id uuid REFERENCES public.subscription_plans(id),
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN (
    'awaiting_payment',
    'paid',
    'manual_review',
    'payment_mismatch',
    'webhook_invalid',
    'rejected',
    'expired',
    'cancelled'
  )),
  currency text NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  base_amount numeric(12, 0) NOT NULL CHECK (base_amount >= 0),
  addon_amount numeric(12, 0) NOT NULL DEFAULT 0 CHECK (addon_amount >= 0),
  total_amount numeric(12, 0) NOT NULL CHECK (total_amount > 0),
  duration_days_snapshot integer CHECK (duration_days_snapshot IS NULL OR duration_days_snapshot > 0),
  transfer_content text NOT NULL UNIQUE,
  payment_provider text NOT NULL DEFAULT 'payos',
  provider_order_code bigint UNIQUE,
  provider_order_id text,
  provider_transaction_id text UNIQUE,
  provider_checkout_url text,
  provider_qr_code text,
  paid_amount numeric(12, 0),
  paid_at timestamptz,
  settlement_source text CHECK (settlement_source IS NULL OR settlement_source IN ('webhook', 'manual')),
  webhook_received_at timestamptz,
  manual_review_available_at timestamptz,
  manual_review_requested_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES public.accounts(id),
  rejection_reason text,
  expires_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_orders_amount_total_check
    CHECK (total_amount = base_amount + addon_amount),
  CONSTRAINT payment_orders_paid_fields_check
    CHECK (
      status <> 'paid'
      OR (
        paid_at IS NOT NULL
        AND paid_amount = total_amount
        AND settlement_source IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_orders_client_request
  ON public.payment_orders(account_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_orders_account_created
  ON public.payment_orders(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_tenant_status
  ON public.payment_orders(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_manual_review
  ON public.payment_orders(status, manual_review_requested_at)
  WHERE status IN ('manual_review', 'payment_mismatch', 'webhook_invalid');

CREATE TABLE IF NOT EXISTS public.payment_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.payment_orders(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('plan', 'event_addon', 'referee_addon')),
  description text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12, 0) NOT NULL CHECK (unit_price >= 0),
  amount numeric(12, 0) NOT NULL CHECK (amount = quantity * unit_price),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_order_items_order
  ON public.payment_order_items(order_id);

CREATE TABLE IF NOT EXISTS public.subscription_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.tenant_subscriptions(id) ON DELETE CASCADE,
  resource_type text NOT NULL CHECK (resource_type IN ('tournaments', 'events', 'referees')),
  base_limit integer NOT NULL CHECK (base_limit >= 0),
  addon_limit integer NOT NULL DEFAULT 0 CHECK (addon_limit >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id, resource_type)
);

ALTER TABLE public.tenant_subscriptions
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS activation_order_id uuid,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS period_number integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_subscriptions_activation_order_fk'
      AND conrelid = 'public.tenant_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.tenant_subscriptions
      ADD CONSTRAINT tenant_subscriptions_activation_order_fk
      FOREIGN KEY (activation_order_id) REFERENCES public.payment_orders(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_subscriptions_activation_order
  ON public.tenant_subscriptions(activation_order_id)
  WHERE activation_order_id IS NOT NULL;

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_entitlements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payment_orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.payment_order_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.subscription_entitlements FROM PUBLIC, anon, authenticated;

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
  WHERE ts.status IN ('active', 'trial')
    AND ts.start_date <= now()
    AND (ts.end_date IS NULL OR ts.end_date > now())
  ORDER BY ts.tenant_id, ts.created_at DESC
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
  WHERE deleted_at IS NULL
    AND COALESCE(status, 'active') <> 'archived'
  GROUP BY tenant_id
), team_usage AS (
  SELECT tenant_id, count(*) AS teams_used
  FROM public.teams
  WHERE deleted_at IS NULL
  GROUP BY tenant_id
), tournament_usage AS (
  SELECT tenant_id, count(*) AS tournaments_used
  FROM public.tournament
  WHERE deleted_at IS NULL
    AND COALESCE(status, 'active') <> 'archived'
  GROUP BY tenant_id
)
SELECT
  t.id AS tenant_id,
  COALESCE(au.users_used, 0::bigint) AS users_used,
  COALESCE(
    CASE WHEN t.tenant_type = 'self_service_customer' THEN el.referees_limit + 1 END,
    p.max_users,
    1
  ) AS users_limit,
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
    'max_active_referees', sp.max_active_referees
  ) ORDER BY sp.duration_days), '[]'::jsonb)
  FROM public.subscription_plans sp
  WHERE sp.billing_model = 'duration'
    AND sp.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_commercial_access_state_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account record;
  v_subscription record;
  v_usage record;
  v_entitlements jsonb := '[]'::jsonb;
  v_state text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT
    a.id AS account_id,
    a.tenant_id,
    a.status AS account_status,
    t.name AS tenant_name,
    t.slug AS tenant_slug,
    t.status AS tenant_status,
    t.tenant_type,
    sscp.onboarding_status
  INTO v_account
  FROM public.accounts a
  JOIN public.tenants t ON t.id = a.tenant_id
  LEFT JOIN public.self_service_customer_profiles sscp ON sscp.account_id = a.id
  WHERE a.user_id = auth.uid()
    AND a.deleted_at IS NULL
    AND t.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND';
  END IF;

  IF v_account.tenant_type <> 'self_service_customer' THEN
    RETURN jsonb_build_object(
      'success', true,
      'commercial_state', 'not_applicable',
      'tenant_type', v_account.tenant_type,
      'business_access_active', true
    );
  END IF;

  SELECT
    ts.id,
    ts.status,
    ts.start_date,
    ts.end_date,
    ts.plan_id,
    sp.code AS plan_code,
    sp.name AS plan_name,
    sp.duration_days
  INTO v_subscription
  FROM public.tenant_subscriptions ts
  JOIN public.subscription_plans sp ON sp.id = ts.plan_id
  WHERE ts.tenant_id = v_account.tenant_id
    AND ts.status IN ('active', 'trial')
    AND ts.start_date <= now()
    AND (ts.end_date IS NULL OR ts.end_date > now())
    AND sp.is_active = true
  ORDER BY ts.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    v_state := 'active';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'resource_type', se.resource_type,
      'base_limit', se.base_limit,
      'addon_limit', se.addon_limit,
      'effective_limit', se.base_limit + se.addon_limit
    ) ORDER BY se.resource_type), '[]'::jsonb)
    INTO v_entitlements
    FROM public.subscription_entitlements se
    WHERE se.subscription_id = v_subscription.id;

    SELECT * INTO v_usage
    FROM public.tenant_usage tu
    WHERE tu.tenant_id = v_account.tenant_id;
  ELSE
    v_state := CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.tenant_subscriptions ts
        WHERE ts.tenant_id = v_account.tenant_id
      ) THEN 'expired'
      ELSE 'locked'
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'commercial_state', v_state,
    'business_access_active', v_state = 'active',
    'tenant', jsonb_build_object(
      'id', v_account.tenant_id,
      'name', v_account.tenant_name,
      'slug', v_account.tenant_slug,
      'type', v_account.tenant_type,
      'status', v_account.tenant_status
    ),
    'account', jsonb_build_object(
      'id', v_account.account_id,
      'status', v_account.account_status,
      'onboarding_status', v_account.onboarding_status
    ),
    'subscription', CASE WHEN v_subscription.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_subscription.id,
      'status', v_subscription.status,
      'start_date', v_subscription.start_date,
      'end_date', v_subscription.end_date,
      'plan_id', v_subscription.plan_id,
      'plan_code', v_subscription.plan_code,
      'plan_name', v_subscription.plan_name,
      'duration_days', v_subscription.duration_days
    ) END,
    'entitlements', v_entitlements,
    'usage', CASE WHEN v_usage.tenant_id IS NULL THEN NULL ELSE to_jsonb(v_usage) END,
    'server_time', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_self_service_plans_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_self_service_plans_v1() TO authenticated;
REVOKE ALL ON FUNCTION public.get_commercial_access_state_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commercial_access_state_v1() TO authenticated;

COMMIT;
