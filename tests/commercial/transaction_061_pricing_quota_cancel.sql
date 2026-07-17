BEGIN;

SELECT set_config('request.jwt.claim.role', 'service_role', true);

-- Marks this file as an intentional write test for the guarded SQL runner.
-- The predicate is always false and the surrounding transaction is rolled back.
UPDATE public.payment_orders SET updated_at = updated_at WHERE false;

DO $$
DECLARE
  v_auth_user_id uuid;
  v_account_id uuid;
  v_result jsonb;
  v_order_id uuid;
  v_capacity integer;
  v_expected_amount numeric;
  v_actual_amount numeric;
  v_event_id text;
  v_tenant_id uuid;
  v_quota_blocked boolean;
  v_active_auth_user_id uuid;
  v_active_account_id uuid;
  v_active_subscription_id uuid;
  v_downgrade_blocked boolean;
BEGIN
  SELECT a.user_id, a.id
  INTO v_auth_user_id, v_account_id
  FROM public.accounts a
  JOIN public.tenants t ON t.id = a.tenant_id
  WHERE t.tenant_type = 'self_service_customer'
    AND a.user_id IS NOT NULL
    AND a.status = 'active' AND a.deleted_at IS NULL
    AND t.status = 'active' AND t.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.tenant_subscriptions ts
      WHERE ts.tenant_id = a.tenant_id
        AND ts.status IN ('active', 'trial', 'scheduled')
    )
  ORDER BY a.created_at
  LIMIT 1;

  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FIXTURE_MISSING:inactive_self_service_account';
  END IF;

  UPDATE public.payment_orders
  SET status = 'cancelled', updated_at = now()
  WHERE account_id = v_account_id
    AND status IN ('awaiting_payment', 'manual_review', 'payment_mismatch', 'webhook_invalid');

  FOREACH v_capacity IN ARRAY ARRAY[48, 64, 96]
  LOOP
    v_expected_amount := CASE v_capacity
      WHEN 48 THEN 50000
      WHEN 64 THEN 100000
      WHEN 96 THEN 150000
    END;

    v_result := public.create_payment_order_v3(
      v_auth_user_id,
      'activation',
      'SELF_7D',
      0,
      0,
      v_capacity,
      'test-061-tier-' || v_capacity::text || '-' || replace(gen_random_uuid()::text, '-', '')
    );
    v_actual_amount := (v_result->'order'->>'total_amount')::numeric;
    v_order_id := (v_result->'order'->>'id')::uuid;

    IF v_actual_amount <> v_expected_amount THEN
      RAISE EXCEPTION 'TEAM_TIER_PRICE_MISMATCH:%:%/%', v_capacity, v_actual_amount, v_expected_amount;
    END IF;

    v_result := public.cancel_payment_order_v1(v_auth_user_id, v_order_id);
    IF v_result->>'result' <> 'cancelled' THEN
      RAISE EXCEPTION 'ORDER_CANCEL_FAILED:%', v_capacity;
    END IF;
  END LOOP;

  v_result := public.create_payment_order_v3(
    v_auth_user_id,
    'activation',
    'SELF_7D',
    1,
    1,
    48,
    'test-061-addons-' || replace(gen_random_uuid()::text, '-', '')
  );
  v_actual_amount := (v_result->'order'->>'total_amount')::numeric;
  v_order_id := (v_result->'order'->>'id')::uuid;
  IF v_actual_amount <> 90000 THEN
    RAISE EXCEPTION 'ADDON_PRICE_MISMATCH:%/90000', v_actual_amount;
  END IF;
  PERFORM public.cancel_payment_order_v1(v_auth_user_id, v_order_id);

  SELECT e.id, e.tenant_id
  INTO v_event_id, v_tenant_id
  FROM public.events e
  JOIN public.tenants t ON t.id = e.tenant_id
  WHERE t.tenant_type = 'self_service_customer'
    AND e.deleted_at IS NULL
    AND COALESCE(e.status, 'active') <> 'archived'
    AND EXISTS (
      SELECT 1 FROM public.tenant_subscriptions ts
      WHERE ts.tenant_id = e.tenant_id
        AND ts.status IN ('active', 'trial')
        AND ts.start_date <= now()
        AND (ts.end_date IS NULL OR ts.end_date > now())
    )
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FIXTURE_MISSING:active_self_service_event';
  END IF;

  v_quota_blocked := false;
  BEGIN
    PERFORM public.ensure_event_team_quota_v1(v_event_id, v_tenant_id, 97);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEAM_EVENT_QUOTA_EXCEEDED:%' THEN
      v_quota_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_quota_blocked THEN
    RAISE EXCEPTION 'SELF_SERVICE_TEAM_QUOTA_NOT_ENFORCED';
  END IF;

  SELECT e.id, e.tenant_id
  INTO v_event_id, v_tenant_id
  FROM public.events e
  JOIN public.tenants t ON t.id = e.tenant_id
  WHERE t.tenant_type <> 'self_service_customer'
    AND e.deleted_at IS NULL
    AND COALESCE(e.status, 'active') <> 'archived'
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FIXTURE_MISSING:managed_event';
  END IF;

  v_quota_blocked := false;
  BEGIN
    PERFORM public.ensure_event_team_quota_v1(v_event_id, v_tenant_id, 97);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEAM_EVENT_QUOTA_EXCEEDED:%' THEN
      v_quota_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_quota_blocked THEN
    RAISE EXCEPTION 'MANAGED_TEAM_HARD_CAP_NOT_ENFORCED';
  END IF;

  SELECT a.user_id, a.id, ts.id
  INTO v_active_auth_user_id, v_active_account_id, v_active_subscription_id
  FROM public.accounts a
  JOIN public.tenants t ON t.id = a.tenant_id
  JOIN public.tenant_subscriptions ts ON ts.tenant_id = a.tenant_id
  WHERE t.tenant_type = 'self_service_customer'
    AND a.user_id IS NOT NULL
    AND a.status = 'active' AND a.deleted_at IS NULL
    AND t.status = 'active' AND t.deleted_at IS NULL
    AND ts.status IN ('active', 'trial')
    AND ts.start_date <= now()
    AND (ts.end_date IS NULL OR ts.end_date > now())
  ORDER BY ts.created_at DESC
  LIMIT 1;

  IF v_active_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FIXTURE_MISSING:active_self_service_subscription';
  END IF;

  UPDATE public.payment_orders
  SET status = 'cancelled', updated_at = now()
  WHERE account_id = v_active_account_id
    AND status IN ('awaiting_payment', 'manual_review', 'payment_mismatch', 'webhook_invalid');

  INSERT INTO public.subscription_entitlements(subscription_id, resource_type, base_limit, addon_limit)
  VALUES (v_active_subscription_id, 'teams_per_event', 64, 0)
  ON CONFLICT (subscription_id, resource_type) DO UPDATE
  SET base_limit = 64, addon_limit = 0, updated_at = now();

  v_downgrade_blocked := false;
  BEGIN
    PERFORM public.create_payment_order_v3(
      v_active_auth_user_id,
      'addon',
      NULL,
      1,
      0,
      48,
      'test-061-downgrade-' || replace(gen_random_uuid()::text, '-', '')
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEAM_CAPACITY_DOWNGRADE_NOT_ALLOWED' THEN
      v_downgrade_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_downgrade_blocked THEN
    RAISE EXCEPTION 'TEAM_CAPACITY_DOWNGRADE_NOT_BLOCKED';
  END IF;
END;
$$;

ROLLBACK;
