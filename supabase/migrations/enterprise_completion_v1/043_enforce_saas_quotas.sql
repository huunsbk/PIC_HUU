-- Phase 5B: enforce subscription and quota limits at the database boundary.

CREATE OR REPLACE FUNCTION public.ensure_tenant_quota_v1(
  p_tenant_id uuid,
  p_resource text,
  p_delta integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_tenant_status text;
  v_subscription public.tenant_subscriptions%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_usage record;
  v_used bigint;
  v_limit integer;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_REQUIRED';
  END IF;

  IF p_delta IS NULL OR p_delta < 1 THEN
    RAISE EXCEPTION 'INVALID_QUOTA_DELTA';
  END IF;

  IF p_resource NOT IN ('accounts', 'events', 'teams') THEN
    RAISE EXCEPTION 'INVALID_QUOTA_RESOURCE';
  END IF;

  -- Serialize quota-consuming mutations for the same tenant/resource.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || p_resource, 0)
  );

  SELECT status
  INTO v_tenant_status
  FROM public.tenants
  WHERE id = p_tenant_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND OR v_tenant_status <> 'active' THEN
    RAISE EXCEPTION 'TENANT_INACTIVE';
  END IF;

  SELECT ts.*
  INTO v_subscription
  FROM public.tenant_subscriptions ts
  WHERE ts.tenant_id = p_tenant_id
    AND ts.status IN ('active', 'trial')
    AND (ts.end_date IS NULL OR ts.end_date >= now())
  ORDER BY ts.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_INACTIVE';
  END IF;

  SELECT *
  INTO v_plan
  FROM public.subscription_plans
  WHERE id = v_subscription.plan_id
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_PLAN_INACTIVE';
  END IF;

  SELECT *
  INTO v_usage
  FROM public.tenant_usage
  WHERE tenant_id = p_tenant_id
  LIMIT 1;

  CASE p_resource
    WHEN 'accounts' THEN
      v_used := COALESCE(v_usage.users_used, 0);
      v_limit := v_plan.max_users;
    WHEN 'events' THEN
      v_used := COALESCE(v_usage.events_used, 0);
      v_limit := v_plan.max_events;
    WHEN 'teams' THEN
      v_used := COALESCE(v_usage.teams_used, 0);
      v_limit := v_plan.max_teams;
  END CASE;

  IF v_used + p_delta > v_limit THEN
    RAISE EXCEPTION 'QUOTA_EXCEEDED:%:%/%', p_resource, v_used, v_limit;
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
  v_should_check boolean;
BEGIN
  v_resource := CASE TG_TABLE_NAME
    WHEN 'accounts' THEN 'accounts'
    WHEN 'events' THEN 'events'
    WHEN 'teams' THEN 'teams'
    ELSE NULL
  END;

  IF v_resource IS NULL THEN
    RAISE EXCEPTION 'INVALID_QUOTA_RESOURCE';
  END IF;

  v_should_check := NEW.deleted_at IS NULL AND (
    TG_OP = 'INSERT'
    OR OLD.deleted_at IS NOT NULL
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
  );

  IF v_should_check THEN
    PERFORM public.ensure_tenant_quota_v1(NEW.tenant_id, v_resource, 1);
  END IF;

  RETURN NEW;
END;
$$;

-- Replace quota triggers that exist in the live legacy schema but were not
-- represented in the enterprise_completion_v1 migration history.
DROP TRIGGER IF EXISTS chk_event_quota ON public.events;
DROP TRIGGER IF EXISTS chk_team_quota ON public.teams;
DROP FUNCTION IF EXISTS public.trg_check_event_quota();
DROP FUNCTION IF EXISTS public.trg_check_team_quota();

DROP TRIGGER IF EXISTS trg_accounts_saas_quota_v1 ON public.accounts;
CREATE TRIGGER trg_accounts_saas_quota_v1
BEFORE INSERT OR UPDATE OF deleted_at, tenant_id ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.enforce_saas_quota_trigger_v1();

DROP TRIGGER IF EXISTS trg_events_saas_quota_v1 ON public.events;
CREATE TRIGGER trg_events_saas_quota_v1
BEFORE INSERT OR UPDATE OF deleted_at, tenant_id ON public.events
FOR EACH ROW EXECUTE FUNCTION public.enforce_saas_quota_trigger_v1();

DROP TRIGGER IF EXISTS trg_teams_saas_quota_v1 ON public.teams;
CREATE TRIGGER trg_teams_saas_quota_v1
BEFORE INSERT OR UPDATE OF deleted_at, tenant_id ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.enforce_saas_quota_trigger_v1();

REVOKE ALL ON FUNCTION public.ensure_tenant_quota_v1(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_saas_quota_trigger_v1()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_create_user(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_create_event(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_create_team(uuid)
  FROM PUBLIC, anon, authenticated;
