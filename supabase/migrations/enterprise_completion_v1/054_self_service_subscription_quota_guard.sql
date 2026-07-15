-- Self-service commercialization PR-COM-05: subscription and quota enforcement.

BEGIN;

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
            AND ts.status IN ('active', 'trial')
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
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_REQUIRED';
  END IF;
  IF NOT public.business_access_active_v1(p_tenant_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_INACTIVE';
  END IF;
END;
$$;

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
  v_usage record;
  v_used bigint;
  v_limit bigint;
BEGIN
  IF p_delta IS NULL OR p_delta < 1 THEN
    RAISE EXCEPTION 'INVALID_QUOTA_DELTA';
  END IF;
  IF p_resource NOT IN ('accounts', 'events', 'teams', 'tournaments', 'referees') THEN
    RAISE EXCEPTION 'INVALID_QUOTA_RESOURCE';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_resource, 0));
  PERFORM public.ensure_business_access_v1(p_tenant_id);

  SELECT * INTO v_usage
  FROM public.tenant_usage
  WHERE tenant_id = p_tenant_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND';
  END IF;

  CASE p_resource
    WHEN 'accounts' THEN
      v_used := COALESCE(v_usage.users_used, 0);
      v_limit := COALESCE(v_usage.users_limit, 0);
    WHEN 'events' THEN
      v_used := COALESCE(v_usage.events_used, 0);
      v_limit := COALESCE(v_usage.events_limit, 0);
    WHEN 'teams' THEN
      v_used := COALESCE(v_usage.teams_used, 0);
      v_limit := COALESCE(v_usage.teams_limit, 0);
    WHEN 'tournaments' THEN
      v_used := COALESCE(v_usage.tournaments_used, 0);
      v_limit := COALESCE(v_usage.tournaments_limit, 0);
    WHEN 'referees' THEN
      v_used := COALESCE(v_usage.referees_used, 0);
      v_limit := COALESCE(v_usage.referees_limit, 0);
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
  IF v_resource IS NULL THEN
    RAISE EXCEPTION 'INVALID_QUOTA_RESOURCE';
  END IF;

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

  v_should_check := v_new_counted AND (
    TG_OP = 'INSERT'
    OR NOT v_old_counted
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
  );

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
    PERFORM public.ensure_tenant_quota_v1(NEW.tenant_id, v_resource, 1);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tournament_saas_quota_v1 ON public.tournament;
CREATE TRIGGER trg_tournament_saas_quota_v1
BEFORE INSERT OR UPDATE OF deleted_at, tenant_id, status ON public.tournament
FOR EACH ROW EXECUTE FUNCTION public.enforce_saas_quota_trigger_v1();

DROP TRIGGER IF EXISTS trg_events_saas_quota_v1 ON public.events;
CREATE TRIGGER trg_events_saas_quota_v1
BEFORE INSERT OR UPDATE OF deleted_at, tenant_id, status ON public.events
FOR EACH ROW EXECUTE FUNCTION public.enforce_saas_quota_trigger_v1();

DROP TRIGGER IF EXISTS trg_accounts_saas_quota_v1 ON public.accounts;
CREATE TRIGGER trg_accounts_saas_quota_v1
BEFORE INSERT OR UPDATE OF deleted_at, tenant_id ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.enforce_saas_quota_trigger_v1();

DROP TRIGGER IF EXISTS trg_teams_saas_quota_v1 ON public.teams;
CREATE TRIGGER trg_teams_saas_quota_v1
BEFORE INSERT OR UPDATE OF deleted_at, tenant_id ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.enforce_saas_quota_trigger_v1();

CREATE OR REPLACE FUNCTION public.grant_self_service_owner_capabilities_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  INSERT INTO public.account_permissions(account_id, permission_id)
  SELECT NEW.account_id, p.id
  FROM public.permissions p
  WHERE p.name = 'manage_tournaments'
    AND NOT EXISTS (
      SELECT 1 FROM public.account_permissions ap
      WHERE ap.account_id = NEW.account_id AND ap.permission_id = p.id
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_self_service_owner_capabilities_v1
  ON public.self_service_customer_profiles;
CREATE TRIGGER trg_self_service_owner_capabilities_v1
AFTER INSERT ON public.self_service_customer_profiles
FOR EACH ROW EXECUTE FUNCTION public.grant_self_service_owner_capabilities_v1();

INSERT INTO public.account_permissions(account_id, permission_id)
SELECT sscp.account_id, p.id
FROM public.self_service_customer_profiles sscp
CROSS JOIN public.permissions p
WHERE p.name = 'manage_tournaments'
  AND NOT EXISTS (
    SELECT 1 FROM public.account_permissions ap
    WHERE ap.account_id = sscp.account_id AND ap.permission_id = p.id
  );

CREATE OR REPLACE FUNCTION public.p10_validate_event_context_v1(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
  v_current_tenant_id uuid;
  v_role_name text;
  v_event record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  v_account_id := public.current_account_id();
  v_current_tenant_id := public.current_tenant_id();
  v_role_name := public.current_role_name();
  IF v_account_id IS NULL OR v_role_name IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN RAISE EXCEPTION 'INVALID_EVENT_ID'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id::text = p_event_id) THEN RAISE EXCEPTION 'INVALID_CONTEXT'; END IF;
  IF EXISTS (SELECT 1 FROM public.tournament WHERE id = p_event_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID_CONTEXT';
  END IF;
  IF p_event_id !~ '^evt_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'INVALID_EVENT_ID'; END IF;

  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id AND e.deleted_at IS NULL
    AND COALESCE(e.status, 'active') <> 'archived'
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_FOUND'; END IF;
  IF v_role_name <> 'SUPER_ADMIN' AND v_event.tenant_id <> v_current_tenant_id THEN
    RAISE EXCEPTION 'INVALID_CONTEXT';
  END IF;
  IF v_role_name <> 'SUPER_ADMIN' THEN
    PERFORM public.ensure_business_access_v1(v_event.tenant_id);
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event.id, 'tenant_id', v_event.tenant_id,
    'tournament_id', v_event.tournament_id, 'sport_id', v_event.sport_id,
    'format_type', COALESCE(v_event.format_type, 'group_then_knockout'),
    'ranking_config', COALESCE(v_event.ranking_config, '{}'::jsonb),
    'scoring_config', COALESCE(v_event.scoring_config, '{}'::jsonb),
    'role_name', v_role_name, 'account_id', v_account_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_manage_event_for_tournament_v1(p_tournament_id text)
RETURNS public.tournament
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_tournament public.tournament%ROWTYPE;
  v_role text;
  v_account_id uuid;
  v_tenant_type text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_tournament FROM public.tournament
  WHERE id = p_tournament_id AND deleted_at IS NULL
    AND COALESCE(status, 'active') <> 'archived';
  IF v_tournament.id IS NULL THEN RAISE EXCEPTION 'Tournament not found or archived'; END IF;

  v_role := public.current_role_name();
  v_account_id := public.current_account_id();
  IF v_role = 'SUPER_ADMIN' THEN RETURN v_tournament; END IF;
  PERFORM public.ensure_business_access_v1(v_tournament.tenant_id);

  IF v_role = 'TENANT_ADMIN' AND v_tournament.tenant_id = public.current_tenant_id()
     AND public.has_permission('manage_events') THEN
    RETURN v_tournament;
  END IF;

  SELECT tenant_type INTO v_tenant_type FROM public.tenants WHERE id = v_tournament.tenant_id;
  IF v_role = 'EVENT_ADMIN' AND v_tournament.tenant_id = public.current_tenant_id()
     AND (
       (v_tenant_type = 'self_service_customer' AND public.has_permission('create_events'))
       OR EXISTS (
         SELECT 1 FROM public.account_event_permissions aep
         JOIN public.events e ON e.id = aep.event_id
         WHERE aep.account_id = v_account_id AND aep.deleted_at IS NULL
           AND COALESCE(aep.permission, 'enter_scores') = 'create_events'
           AND e.tournament_id = p_tournament_id AND e.deleted_at IS NULL
           AND COALESCE(e.status, 'active') <> 'archived'
       )
     ) THEN
    RETURN v_tournament;
  END IF;
  RAISE EXCEPTION 'Permission denied: create_events required';
END;
$$;

REVOKE ALL ON FUNCTION public.business_access_active_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_business_access_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_tenant_quota_v1(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_saas_quota_trigger_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_self_service_owner_capabilities_v1() FROM PUBLIC, anon, authenticated;

COMMIT;
