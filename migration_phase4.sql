-- =====================================================
-- PHASE 4 FIXED MIGRATION
-- Tournament SaaS Billing Layer
-- Compatible with current Supabase schema
-- =====================================================

-- ==========================================
-- SUBSCRIPTION PLANS
-- ==========================================

CREATE TABLE IF NOT EXISTS public.subscription_plans (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
name varchar(100) NOT NULL UNIQUE,
description text,
max_users integer NOT NULL DEFAULT 1,
max_events integer NOT NULL DEFAULT 1,
max_teams integer NOT NULL DEFAULT 50,
storage_limit_mb integer NOT NULL DEFAULT 100,
monthly_price numeric(12,2) NOT NULL DEFAULT 0,
yearly_price numeric(12,2) NOT NULL DEFAULT 0,
is_active boolean NOT NULL DEFAULT true,
created_at timestamptz DEFAULT now(),
updated_at timestamptz DEFAULT now()
);

-- ==========================================
-- TENANT SUBSCRIPTIONS
-- ==========================================

CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id uuid NOT NULL REFERENCES public.tenants(id),
plan_id uuid NOT NULL REFERENCES public.subscription_plans(id),
status varchar(30) NOT NULL DEFAULT 'trial',
start_date timestamptz NOT NULL DEFAULT now(),
end_date timestamptz,
auto_renew boolean DEFAULT true,
created_at timestamptz DEFAULT now(),
updated_at timestamptz DEFAULT now()
);

-- ==========================================
-- INVOICES
-- ==========================================

CREATE TABLE IF NOT EXISTS public.invoices (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id uuid NOT NULL REFERENCES public.tenants(id),
subscription_id uuid NOT NULL REFERENCES public.tenant_subscriptions(id),
invoice_number varchar(100) UNIQUE,
billing_period varchar(50),
amount numeric(12,2) NOT NULL,
status varchar(30) DEFAULT 'pending',
invoice_date timestamptz DEFAULT now(),
due_date timestamptz,
paid_at timestamptz,
created_at timestamptz DEFAULT now()
);

-- ==========================================
-- PAYMENTS
-- ==========================================

CREATE TABLE IF NOT EXISTS public.payments (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
invoice_id uuid NOT NULL REFERENCES public.invoices(id),
tenant_id uuid NOT NULL REFERENCES public.tenants(id),
provider varchar(50),
provider_transaction_id text,
amount numeric(12,2) NOT NULL,
status varchar(30) DEFAULT 'pending',
created_at timestamptz DEFAULT now()
);

-- ==========================================
-- CHECK CONSTRAINTS
-- ==========================================

DO $$
BEGIN

IF NOT EXISTS (
SELECT 1
FROM pg_constraint
WHERE conname='chk_subscription_status'
)
THEN
ALTER TABLE public.tenant_subscriptions
ADD CONSTRAINT chk_subscription_status
CHECK (
status IN (
'trial',
'active',
'expired',
'cancelled',
'suspended'
)
);
END IF;

IF NOT EXISTS (
SELECT 1
FROM pg_constraint
WHERE conname='chk_invoice_status'
)
THEN
ALTER TABLE public.invoices
ADD CONSTRAINT chk_invoice_status
CHECK (
status IN (
'pending',
'paid',
'cancelled',
'failed'
)
);
END IF;

IF NOT EXISTS (
SELECT 1
FROM pg_constraint
WHERE conname='chk_payment_status'
)
THEN
ALTER TABLE public.payments
ADD CONSTRAINT chk_payment_status
CHECK (
status IN (
'success',
'pending',
'failed'
)
);
END IF;

END $$;

-- ==========================================
-- INDEXES
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_subscription_tenant
ON public.tenant_subscriptions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status
ON public.tenant_subscriptions(status);

CREATE INDEX IF NOT EXISTS idx_subscriptions_end_date
ON public.tenant_subscriptions(end_date);

CREATE INDEX IF NOT EXISTS idx_invoice_tenant
ON public.invoices(tenant_id);

CREATE INDEX IF NOT EXISTS idx_invoice_status
ON public.invoices(status);

CREATE INDEX IF NOT EXISTS idx_invoice_date
ON public.invoices(invoice_date);

CREATE INDEX IF NOT EXISTS idx_payment_status
ON public.payments(status);

-- ==========================================
-- UNIQUE BILLING GUARD
-- ==========================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_period
ON public.invoices(
tenant_id,
subscription_id,
billing_period
);

-- ==========================================
-- UPDATED_AT TRIGGER
-- ==========================================

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
NEW.updated_at = now();
RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscription_updated_at
ON public.tenant_subscriptions;

CREATE TRIGGER trg_subscription_updated_at
BEFORE UPDATE
ON public.tenant_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- ==========================================
-- RLS
-- ==========================================

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- PLANS

DROP POLICY IF EXISTS plans_select ON public.subscription_plans;

CREATE POLICY plans_select
ON public.subscription_plans
FOR SELECT
TO authenticated
USING (true);

-- SUBSCRIPTIONS

DROP POLICY IF EXISTS subscriptions_select
ON public.tenant_subscriptions;

CREATE POLICY subscriptions_select
ON public.tenant_subscriptions
FOR SELECT
TO authenticated
USING (
EXISTS (
SELECT 1
FROM public.accounts a
JOIN public.roles r ON r.id=a.role_id
WHERE a.user_id=auth.uid()
AND (
r.name='SUPER_ADMIN'
OR a.tenant_id=tenant_subscriptions.tenant_id
)
)
);

-- INVOICES

DROP POLICY IF EXISTS invoices_select
ON public.invoices;

CREATE POLICY invoices_select
ON public.invoices
FOR SELECT
TO authenticated
USING (
EXISTS (
SELECT 1
FROM public.accounts a
JOIN public.roles r ON r.id=a.role_id
WHERE a.user_id=auth.uid()
AND (
r.name='SUPER_ADMIN'
OR a.tenant_id=invoices.tenant_id
)
)
);

-- PAYMENTS

DROP POLICY IF EXISTS payments_select
ON public.payments;

CREATE POLICY payments_select
ON public.payments
FOR SELECT
TO authenticated
USING (
EXISTS (
SELECT 1
FROM public.accounts a
JOIN public.roles r ON r.id=a.role_id
WHERE a.user_id=auth.uid()
AND (
r.name='SUPER_ADMIN'
OR a.tenant_id=payments.tenant_id
)
)
);

-- ==========================================
-- DEFAULT PLANS
-- ==========================================

INSERT INTO public.subscription_plans
(name,max_users,max_events,max_teams,monthly_price)
VALUES
('Starter',2,3,50,0),
('Pro',10,20,300,19),
('Business',50,100,1000,99),
('Enterprise',999999,999999,999999,299)
ON CONFLICT (name)
DO NOTHING;
