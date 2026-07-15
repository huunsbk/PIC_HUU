-- Self-service commercialization PR-COM-01: atomic Google customer onboarding.
-- Existing managed tenants keep their current behavior.

BEGIN;

CREATE OR REPLACE FUNCTION public.request_claim_role_v1()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_legacy_role text := NULLIF(current_setting('request.jwt.claim.role', true), '');
  v_claims_text text := NULLIF(current_setting('request.jwt.claims', true), '');
BEGIN
  IF v_legacy_role IS NOT NULL THEN RETURN v_legacy_role; END IF;
  IF v_claims_text IS NULL THEN RETURN NULL; END IF;
  RETURN v_claims_text::jsonb->>'role';
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.request_claim_role_v1() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS tenant_type text NOT NULL DEFAULT 'managed_enterprise';

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_tenant_type_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_tenant_type_check
  CHECK (tenant_type IN ('managed_enterprise', 'self_service_customer'));

CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_user_id
  ON public.accounts(user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.self_service_customer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  onboarding_status text NOT NULL DEFAULT 'pending_subscription'
    CHECK (onboarding_status IN ('pending_subscription', 'ready', 'suspended')),
  terms_accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_self_service_profiles_onboarding_status
  ON public.self_service_customer_profiles(onboarding_status);

ALTER TABLE public.self_service_customer_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.self_service_customer_profiles FROM PUBLIC, anon, authenticated;

-- The first self-service account is the customer owner. It must exist before a
-- subscription can be purchased, but it must not open a path for a second
-- account while the tenant is still unpaid.
CREATE OR REPLACE FUNCTION public.enforce_saas_quota_trigger_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_resource text;
  v_should_check boolean;
  v_is_initial_self_service_owner boolean := false;
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

  IF v_should_check AND TG_TABLE_NAME = 'accounts' AND TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW.tenant_id::text || ':accounts', 0)
    );

    SELECT EXISTS (
      SELECT 1
      FROM public.tenants t
      WHERE t.id = NEW.tenant_id
        AND t.tenant_type = 'self_service_customer'
        AND t.deleted_at IS NULL
        AND COALESCE(t.status, 'active') = 'active'
    ) AND NOT EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.tenant_id = NEW.tenant_id
        AND a.deleted_at IS NULL
    )
    INTO v_is_initial_self_service_owner;
  END IF;

  IF v_should_check AND NOT v_is_initial_self_service_owner THEN
    PERFORM public.ensure_tenant_quota_v1(NEW.tenant_id, v_resource, 1);
  END IF;

  RETURN NEW;
END;
$$;

-- Role permissions are profile metadata only for an unpaid self-service
-- customer. Backend permission checks return false until a current subscription
-- exists. Managed enterprise tenants are unaffected.
CREATE OR REPLACE FUNCTION public.has_permission(perm_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.accounts a
    JOIN public.tenants t ON t.id = a.tenant_id
    WHERE a.user_id = auth.uid()
      AND a.deleted_at IS NULL
      AND a.status = 'active'
      AND t.deleted_at IS NULL
      AND COALESCE(t.status, 'active') = 'active'
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
      AND (
        EXISTS (
          SELECT 1
          FROM public.account_permissions ap
          JOIN public.permissions p ON p.id = ap.permission_id
          WHERE ap.account_id = a.id
            AND p.name = perm_name
        )
        OR EXISTS (
          SELECT 1
          FROM public.role_permissions rp
          JOIN public.permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = a.role_id
            AND p.name = perm_name
        )
        OR EXISTS (
          SELECT 1
          FROM public.role_permissions rp
          JOIN public.permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = a.role_id
            AND p.name = '*'
        )
      )
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_self_service_customer_v1(
  p_auth_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, auth, pg_temp
AS $$
DECLARE
  v_claim_role text := public.request_claim_role_v1();
  v_auth_user record;
  v_existing_account record;
  v_role_id uuid;
  v_tenant_id uuid;
  v_account_id uuid;
  v_tenant_slug text;
  v_username text;
  v_display_name text;
BEGIN
  IF v_claim_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_USER_REQUIRED';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text, 0));

  SELECT a.id, a.tenant_id, a.status, a.deleted_at, t.tenant_type
  INTO v_existing_account
  FROM public.accounts a
  JOIN public.tenants t ON t.id = a.tenant_id
  WHERE a.user_id = p_auth_user_id
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_account.deleted_at IS NOT NULL
       OR v_existing_account.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'ACCOUNT_INACTIVE';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'created', false,
      'account_id', v_existing_account.id,
      'tenant_id', v_existing_account.tenant_id,
      'tenant_type', v_existing_account.tenant_type
    );
  END IF;

  SELECT
    u.id,
    lower(u.email) AS email,
    u.raw_user_meta_data,
    EXISTS (
      SELECT 1
      FROM auth.identities i
      WHERE i.user_id = u.id
        AND i.provider = 'google'
    ) AS has_google_identity
  INTO v_auth_user
  FROM auth.users u
  WHERE u.id = p_auth_user_id
  LIMIT 1;

  IF NOT FOUND OR NOT COALESCE(v_auth_user.has_google_identity, false) THEN
    RAISE EXCEPTION 'GOOGLE_IDENTITY_REQUIRED';
  END IF;

  SELECT id
  INTO v_role_id
  FROM public.roles
  WHERE name = 'EVENT_ADMIN'
  LIMIT 1;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'EVENT_ADMIN_ROLE_MISSING';
  END IF;

  v_display_name := left(COALESCE(
    NULLIF(btrim(v_auth_user.raw_user_meta_data->>'full_name'), ''),
    NULLIF(btrim(v_auth_user.raw_user_meta_data->>'name'), ''),
    NULLIF(split_part(v_auth_user.email, '@', 1), ''),
    'Khách hàng'
  ), 120);
  v_tenant_slug := 'kh-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_username := 'google_' || substr(replace(p_auth_user_id::text, '-', ''), 1, 20);

  INSERT INTO public.tenants(name, slug, status, tenant_type)
  VALUES (left('Đơn vị ' || v_display_name, 150), v_tenant_slug, 'active', 'self_service_customer')
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.accounts(
    user_id,
    tenant_id,
    role_id,
    username,
    display_name,
    status
  )
  VALUES (
    p_auth_user_id,
    v_tenant_id,
    v_role_id,
    v_username,
    v_display_name,
    'active'
  )
  RETURNING id INTO v_account_id;

  INSERT INTO public.self_service_customer_profiles(
    account_id,
    tenant_id,
    onboarding_status
  )
  VALUES (v_account_id, v_tenant_id, 'pending_subscription');

  INSERT INTO public.audit_logs(
    timestamp,
    action,
    details,
    tenant_id,
    actor_account_id,
    actor_role,
    category,
    entity_type,
    entity_id,
    result,
    details_json
  )
  VALUES (
    now()::text,
    'GOOGLE_CUSTOMER_BOOTSTRAPPED',
    jsonb_build_object('provider', 'google', 'onboarding_status', 'pending_subscription')::text,
    v_tenant_id,
    v_account_id,
    'EVENT_ADMIN',
    'identity',
    'account',
    v_account_id::text,
    'allow',
    jsonb_build_object('provider', 'google', 'onboarding_status', 'pending_subscription')
  );

  RETURN jsonb_build_object(
    'success', true,
    'created', true,
    'account_id', v_account_id,
    'tenant_id', v_tenant_id,
    'tenant_type', 'self_service_customer',
    'onboarding_status', 'pending_subscription'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_current_profile()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  WITH current_context AS (
    SELECT
      a.id AS account_id,
      a.user_id,
      a.username,
      a.display_name,
      a.tenant_id,
      a.role_id,
      r.name AS role,
      t.tenant_type,
      sscp.onboarding_status,
      (
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
      ) AS business_access_active
    FROM public.accounts a
    JOIN public.roles r ON r.id = a.role_id
    JOIN public.tenants t ON t.id = a.tenant_id
    LEFT JOIN public.self_service_customer_profiles sscp ON sscp.account_id = a.id
    WHERE a.user_id = auth.uid()
      AND a.deleted_at IS NULL
      AND a.status = 'active'
      AND t.deleted_at IS NULL
      AND COALESCE(t.status, 'active') = 'active'
    LIMIT 1
  )
  SELECT row_to_json(profile)
  FROM (
    SELECT
      cc.account_id,
      cc.user_id,
      cc.username,
      cc.display_name,
      cc.tenant_id,
      cc.role,
      cc.tenant_type,
      cc.onboarding_status,
      cc.business_access_active,
      CASE WHEN cc.business_access_active THEN COALESCE((
        SELECT json_agg(p.name ORDER BY p.name)
        FROM public.role_permissions rp
        JOIN public.permissions p ON rp.permission_id = p.id
        WHERE rp.role_id = cc.role_id
      ), '[]'::json) ELSE '[]'::json END AS role_permissions,
      CASE WHEN cc.business_access_active THEN COALESCE((
        SELECT json_agg(p.name ORDER BY p.name)
        FROM public.account_permissions ap
        JOIN public.permissions p ON ap.permission_id = p.id
        WHERE ap.account_id = cc.account_id
      ), '[]'::json) ELSE '[]'::json END AS account_permissions,
      CASE WHEN cc.business_access_active THEN COALESCE((
        SELECT json_agg(event_id ORDER BY event_id)
        FROM (
          SELECT DISTINCT aep.event_id
          FROM public.account_event_permissions aep
          JOIN public.events e ON e.id = aep.event_id
          WHERE aep.account_id = cc.account_id
            AND aep.deleted_at IS NULL
            AND e.deleted_at IS NULL
        ) scoped_events
      ), '[]'::json) ELSE '[]'::json END AS event_ids,
      CASE WHEN cc.business_access_active THEN COALESCE((
        SELECT json_agg(
          json_build_object(
            'event_id', event_id,
            'permissions', permissions
          )
          ORDER BY event_id
        )
        FROM (
          SELECT
            aep.event_id,
            json_agg(DISTINCT COALESCE(aep.permission, 'enter_scores') ORDER BY COALESCE(aep.permission, 'enter_scores')) AS permissions
          FROM public.account_event_permissions aep
          JOIN public.events e ON e.id = aep.event_id
          WHERE aep.account_id = cc.account_id
            AND aep.deleted_at IS NULL
            AND e.deleted_at IS NULL
          GROUP BY aep.event_id
        ) event_permission_rows
      ), '[]'::json) ELSE '[]'::json END AS event_permissions
    FROM current_context cc
  ) profile;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_self_service_customer_v1(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_self_service_customer_v1(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.enforce_saas_quota_trigger_v1()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_current_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_profile() TO authenticated;

COMMIT;
