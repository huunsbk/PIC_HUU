CREATE TEMP TABLE __self_service_quota_verification_guard(id integer) ON COMMIT DROP;

BEGIN;

DO $$
DECLARE
  v_tenant_id uuid;
  v_plan_id uuid;
  v_subscription_id uuid;
  v_quota_blocked boolean := false;
BEGIN
  INSERT INTO public.tenants(name, slug, status, tenant_type)
  VALUES ('COM05 rollback fixture', 'com05-rollback-fixture', 'active', 'self_service_customer')
  RETURNING id INTO v_tenant_id;

  IF public.business_access_active_v1(v_tenant_id) THEN
    RAISE EXCEPTION 'unpaid self-service tenant has business access';
  END IF;

  SELECT id INTO v_plan_id
  FROM public.subscription_plans
  WHERE code = 'SELF_3D' AND is_active = true;

  INSERT INTO public.tenant_subscriptions(
    tenant_id, plan_id, status, start_date, end_date, auto_renew, activated_at
  ) VALUES (
    v_tenant_id, v_plan_id, 'active', now(), now() + interval '3 days', false, now()
  ) RETURNING id INTO v_subscription_id;

  INSERT INTO public.subscription_entitlements(subscription_id, resource_type, base_limit, addon_limit)
  VALUES
    (v_subscription_id, 'tournaments', 1, 0),
    (v_subscription_id, 'events', 3, 0),
    (v_subscription_id, 'referees', 1, 0);

  IF NOT public.business_access_active_v1(v_tenant_id) THEN
    RAISE EXCEPTION 'paid self-service tenant does not have business access';
  END IF;

  INSERT INTO public.tournament(id, tenant_id, name, slug, date, status, settings)
  VALUES (
    'tournament-com05-fixture-1', v_tenant_id, 'COM05 fixture 1',
    'com05-fixture-1', '', 'active', '{}'::jsonb
  );

  BEGIN
    INSERT INTO public.tournament(id, tenant_id, name, slug, date, status, settings)
    VALUES (
      'tournament-com05-fixture-2', v_tenant_id, 'COM05 fixture 2',
      'com05-fixture-2', '', 'active', '{}'::jsonb
    );
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'QUOTA_EXCEEDED:tournaments:%' THEN
      v_quota_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_quota_blocked THEN
    RAISE EXCEPTION 'second tournament was not blocked by quota';
  END IF;

  UPDATE public.tenant_subscriptions
  SET end_date = now() - interval '1 second'
  WHERE id = v_subscription_id;

  IF public.business_access_active_v1(v_tenant_id) THEN
    RAISE EXCEPTION 'expired self-service tenant still has business access';
  END IF;
END $$;

DO $$
DECLARE
  v_missing_triggers text[];
BEGIN
  SELECT array_agg(expected.name ORDER BY expected.name)
  INTO v_missing_triggers
  FROM (VALUES
    ('trg_accounts_saas_quota_v1'),
    ('trg_events_saas_quota_v1'),
    ('trg_teams_saas_quota_v1'),
    ('trg_tournament_saas_quota_v1'),
    ('trg_self_service_owner_capabilities_v1')
  ) expected(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgname = expected.name AND NOT t.tgisinternal
  );

  IF COALESCE(array_length(v_missing_triggers, 1), 0) > 0 THEN
    RAISE EXCEPTION 'missing enforcement triggers: %', v_missing_triggers;
  END IF;

  IF has_function_privilege('authenticated', 'public.ensure_tenant_quota_v1(uuid,text,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ensure_business_access_v1(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'client can execute internal commercial guard';
  END IF;
END $$;

ROLLBACK;

SELECT 'self-service subscription and quota guard verification passed' AS result;
