BEGIN;

CREATE TEMP TABLE __commercial_auth_workspace_guard(id integer) ON COMMIT DROP;

DO $$
DECLARE
  v_locked record;
  v_subscription_id uuid;
  v_profile jsonb;
  v_access jsonb;
  v_destination jsonb;
  v_plan_count integer;
BEGIN
  SELECT a.id, a.user_id, a.tenant_id
  INTO v_locked
  FROM public.accounts a
  JOIN public.tenants ten ON ten.id = a.tenant_id
  WHERE ten.tenant_type = 'self_service_customer'
    AND a.status = 'active'
    AND a.deleted_at IS NULL
    AND ten.status = 'active'
    AND ten.deleted_at IS NULL
    AND NOT public.business_access_active_v1(ten.id)
    AND EXISTS (
      SELECT 1
      FROM public.tenant_subscriptions ts
      WHERE ts.tenant_id = ten.id
    )
  ORDER BY a.created_at DESC
  LIMIT 1;

  IF v_locked.user_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FIXTURE_MISSING:locked_self_service_account';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_locked.user_id::text, true);
  v_profile := public.get_current_profile();
  v_destination := public.resolve_post_login_destination_v2();

  IF COALESCE((v_profile ->> 'business_access_active')::boolean, true) THEN
    RAISE EXCEPTION 'locked self-service profile is marked active';
  END IF;
  IF v_destination ->> 'kind' <> 'COMMERCIAL_REQUIRED' THEN
    RAISE EXCEPTION 'locked self-service account does not route to commercial gate';
  END IF;

  SELECT ts.id
  INTO v_subscription_id
  FROM public.tenant_subscriptions ts
  WHERE ts.tenant_id = v_locked.tenant_id
  ORDER BY ts.created_at DESC
  LIMIT 1;

  IF v_subscription_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FIXTURE_MISSING:self_service_subscription_history';
  END IF;

  UPDATE public.tenant_subscriptions
  SET status = 'active',
      start_date = now() - interval '1 hour',
      end_date = now() + interval '1 day'
  WHERE id = v_subscription_id;

  UPDATE public.self_service_customer_profiles
  SET onboarding_status = 'ready'
  WHERE account_id = v_locked.id;

  PERFORM set_config('request.jwt.claim.sub', v_locked.user_id::text, true);
  v_profile := public.get_current_profile();
  v_access := public.get_commercial_access_state_v1();
  v_destination := public.resolve_post_login_destination_v2();

  IF COALESCE((v_profile ->> 'business_access_active')::boolean, false) IS NOT TRUE
     OR COALESCE((v_access ->> 'business_access_active')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'active self-service account lost commercial access';
  END IF;
  IF v_profile ->> 'role' <> 'EVENT_ADMIN' THEN
    RAISE EXCEPTION 'self-service owner role is not EVENT_ADMIN';
  END IF;
  IF v_destination ->> 'kind' = 'COMMERCIAL_REQUIRED' THEN
    RAISE EXCEPTION 'active self-service account incorrectly routes to commercial gate';
  END IF;
  IF v_destination ->> 'kind' NOT IN ('AUTO_ENTER', 'DIRECTORY', 'EMPTY') THEN
    RAISE EXCEPTION 'active self-service destination is invalid';
  END IF;

  SELECT count(*)
  INTO v_plan_count
  FROM jsonb_array_elements(public.list_self_service_plans_v1()) plan
  WHERE plan ->> 'code' IN ('SELF_3D', 'SELF_7D', 'SELF_30D', 'SELF_60D')
    AND (plan ->> 'event_addon_price_vnd')::integer = 20000
    AND (plan ->> 'referee_addon_price_vnd')::integer = 20000
    AND (plan ->> 'max_teams_per_event')::integer = 48;

  IF v_plan_count <> 4 THEN
    RAISE EXCEPTION 'commercial plan catalog is incomplete';
  END IF;
END $$;

SELECT 'commercial auth and workspace routing verification passed' AS result;

ROLLBACK;
