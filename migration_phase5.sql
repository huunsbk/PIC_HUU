-- =====================================================
-- PHASE 5 MIGRATION
-- SaaS Quota Management & Automated Billing
-- =====================================================

-- 1. Create plan_features table
CREATE TABLE IF NOT EXISTS public.plan_features (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
    feature_key varchar(100) NOT NULL,
    enabled boolean DEFAULT true,
    UNIQUE(plan_id, feature_key)
);

-- 2. Create tenant_usage view
CREATE OR REPLACE VIEW public.tenant_usage AS
SELECT
    t.id AS tenant_id,
    COALESCE(u.users_used, 0) AS users_used,
    COALESCE(p.max_users, 1) AS users_limit,
    COALESCE(e.events_used, 0) AS events_used,
    COALESCE(p.max_events, 1) AS events_limit,
    COALESCE(tm.teams_used, 0) AS teams_used,
    COALESCE(p.max_teams, 50) AS teams_limit
FROM public.tenants t
LEFT JOIN (
    SELECT tenant_id, COUNT(*) as users_used FROM public.accounts GROUP BY tenant_id
) u ON u.tenant_id = t.id
LEFT JOIN (
    SELECT tenant_id, COUNT(*) as events_used FROM public.events GROUP BY tenant_id
) e ON e.tenant_id = t.id
LEFT JOIN (
    SELECT tenant_id, COUNT(*) as teams_used FROM public.teams GROUP BY tenant_id
) tm ON tm.tenant_id = t.id
LEFT JOIN (
    SELECT DISTINCT ON (tenant_id) tenant_id, plan_id, status 
    FROM public.tenant_subscriptions 
    WHERE status IN ('active', 'trial') 
    ORDER BY tenant_id, created_at DESC
) ts ON ts.tenant_id = t.id
LEFT JOIN public.subscription_plans p ON p.id = ts.plan_id;

-- 3. Quota Functions
CREATE OR REPLACE FUNCTION public.can_create_user(t_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
    usage_rec RECORD;
BEGIN
    SELECT users_used, users_limit INTO usage_rec FROM public.tenant_usage WHERE tenant_id = t_id;
    -- Always allow the first user (Tenant creator/Admin)
    IF COALESCE(usage_rec.users_used, 0) = 0 THEN
        RETURN true;
    END IF;
    RETURN COALESCE(usage_rec.users_used, 0) < COALESCE(usage_rec.users_limit, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_create_event(t_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
    usage_rec RECORD;
BEGIN
    SELECT events_used, events_limit INTO usage_rec FROM public.tenant_usage WHERE tenant_id = t_id;
    RETURN COALESCE(usage_rec.events_used, 0) < COALESCE(usage_rec.events_limit, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_create_team(t_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
    usage_rec RECORD;
BEGIN
    SELECT teams_used, teams_limit INTO usage_rec FROM public.tenant_usage WHERE tenant_id = t_id;
    RETURN COALESCE(usage_rec.teams_used, 0) < COALESCE(usage_rec.teams_limit, 50);
END;
$$;

CREATE OR REPLACE FUNCTION public.has_feature(t_id uuid, f_name varchar) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
    is_enabled boolean;
BEGIN
    SELECT pf.enabled INTO is_enabled
    FROM public.tenant_subscriptions ts
    JOIN public.plan_features pf ON pf.plan_id = ts.plan_id
    WHERE ts.tenant_id = t_id 
      AND ts.status IN ('active', 'trial') 
      AND pf.feature_key = f_name
    ORDER BY ts.created_at DESC
    LIMIT 1;

    RETURN COALESCE(is_enabled, false);
END;
$$;

-- 4. Trigger Functions
CREATE OR REPLACE FUNCTION public.trg_check_user_quota() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT public.can_create_user(NEW.tenant_id) THEN
        RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED: Maximum user limit reached for this plan';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_check_event_quota() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT public.can_create_event(NEW.tenant_id) THEN
        RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED: Maximum event limit reached for this plan';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_check_team_quota() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT public.can_create_team(NEW.tenant_id) THEN
        RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED: Maximum team limit reached for this plan';
    END IF;
    RETURN NEW;
END;
$$;

-- Apply Triggers
DROP TRIGGER IF EXISTS chk_user_quota ON public.accounts;
CREATE TRIGGER chk_user_quota BEFORE INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.trg_check_user_quota();

DROP TRIGGER IF EXISTS chk_event_quota ON public.events;
CREATE TRIGGER chk_event_quota BEFORE INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION public.trg_check_event_quota();

DROP TRIGGER IF EXISTS chk_team_quota ON public.teams;
CREATE TRIGGER chk_team_quota BEFORE INSERT ON public.teams FOR EACH ROW EXECUTE FUNCTION public.trg_check_team_quota();

-- 5. Business Logic Functions
CREATE OR REPLACE FUNCTION public.expire_trial_subscriptions() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.tenant_subscriptions
    SET status = 'expired', updated_at = now()
    WHERE status = 'trial' 
      AND end_date < now();
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_monthly_invoices() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO public.invoices (tenant_id, subscription_id, invoice_number, billing_period, amount, status, invoice_date, due_date)
    SELECT 
        ts.tenant_id,
        ts.id,
        'INV-' || to_char(now(), 'YYYYMMDD') || '-' || substr(md5(random()::text), 1, 6),
        to_char(now(), 'YYYY-MM'),
        sp.monthly_price,
        'pending',
        now(),
        now() + interval '7 days'
    FROM public.tenant_subscriptions ts
    JOIN public.subscription_plans sp ON sp.id = ts.plan_id
    WHERE ts.status = 'active'
      AND NOT EXISTS (
          SELECT 1 FROM public.invoices i 
          WHERE i.subscription_id = ts.id 
            AND i.billing_period = to_char(now(), 'YYYY-MM')
      );
END;
$$;

-- 6. SaaS Metrics View
CREATE OR REPLACE VIEW public.saas_metrics AS
SELECT 
    COUNT(DISTINCT CASE WHEN ts.status = 'active' THEN ts.tenant_id END) AS active_tenants,
    COUNT(DISTINCT CASE WHEN ts.status = 'trial' THEN ts.tenant_id END) AS trial_tenants,
    COALESCE(SUM(CASE WHEN ts.status IN ('active', 'trial') THEN sp.monthly_price ELSE 0 END), 0) AS monthly_revenue,
    COALESCE(SUM(CASE WHEN ts.status IN ('active', 'trial') THEN sp.monthly_price * 12 ELSE 0 END), 0) AS annual_revenue,
    COUNT(CASE WHEN ts.status IN ('active', 'trial') THEN ts.id END) AS active_subscriptions
FROM public.tenant_subscriptions ts
JOIN public.subscription_plans sp ON sp.id = ts.plan_id;

-- 7. RLS configuration
ALTER TABLE public.plan_features ENABLE ROW LEVEL SECURITY;

-- Plan Features RLS
DROP POLICY IF EXISTS plan_features_select ON public.plan_features;
CREATE POLICY plan_features_select ON public.plan_features FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS plan_features_all ON public.plan_features;
CREATE POLICY plan_features_all ON public.plan_features FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a 
    JOIN public.roles r ON a.role_id = r.id 
    WHERE a.user_id = auth.uid() AND r.name = 'SUPER_ADMIN'
  )
);

-- Subscription Plans RLS
DROP POLICY IF EXISTS plans_all ON public.subscription_plans;
CREATE POLICY plans_all ON public.subscription_plans FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a 
    JOIN public.roles r ON a.role_id = r.id 
    WHERE a.user_id = auth.uid() AND r.name = 'SUPER_ADMIN'
  )
);

-- Tenant Subscriptions RLS
DROP POLICY IF EXISTS subscriptions_select ON public.tenant_subscriptions;
CREATE POLICY subscriptions_select ON public.tenant_subscriptions FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a 
    JOIN public.roles r ON a.role_id = r.id 
    WHERE a.user_id = auth.uid() AND (r.name = 'SUPER_ADMIN' OR (r.name = 'TENANT_ADMIN' AND a.tenant_id = tenant_subscriptions.tenant_id))
  )
);

DROP POLICY IF EXISTS subscriptions_all ON public.tenant_subscriptions;
CREATE POLICY subscriptions_all ON public.tenant_subscriptions FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a 
    JOIN public.roles r ON a.role_id = r.id 
    WHERE a.user_id = auth.uid() AND r.name = 'SUPER_ADMIN'
  )
);

-- Invoices RLS
DROP POLICY IF EXISTS invoices_select ON public.invoices;
CREATE POLICY invoices_select ON public.invoices FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a 
    JOIN public.roles r ON a.role_id = r.id 
    WHERE a.user_id = auth.uid() AND (r.name = 'SUPER_ADMIN' OR (r.name = 'TENANT_ADMIN' AND a.tenant_id = invoices.tenant_id))
  )
);

DROP POLICY IF EXISTS invoices_all ON public.invoices;
CREATE POLICY invoices_all ON public.invoices FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a 
    JOIN public.roles r ON a.role_id = r.id 
    WHERE a.user_id = auth.uid() AND r.name = 'SUPER_ADMIN'
  )
);

-- Payments RLS
DROP POLICY IF EXISTS payments_select ON public.payments;
CREATE POLICY payments_select ON public.payments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a 
    JOIN public.roles r ON a.role_id = r.id 
    WHERE a.user_id = auth.uid() AND (r.name = 'SUPER_ADMIN' OR (r.name = 'TENANT_ADMIN' AND a.tenant_id = payments.tenant_id))
  )
);

DROP POLICY IF EXISTS payments_all ON public.payments;
CREATE POLICY payments_all ON public.payments FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a 
    JOIN public.roles r ON a.role_id = r.id 
    WHERE a.user_id = auth.uid() AND r.name = 'SUPER_ADMIN'
  )
);
