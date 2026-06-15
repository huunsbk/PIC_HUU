-- =====================================================
-- PHASE 5 ROLLBACK
-- SaaS Quota Management & Automated Billing
-- =====================================================

DROP VIEW IF EXISTS public.saas_metrics CASCADE;
DROP FUNCTION IF EXISTS public.generate_monthly_invoices CASCADE;
DROP FUNCTION IF EXISTS public.expire_trial_subscriptions CASCADE;

DROP TRIGGER IF EXISTS chk_user_quota ON public.accounts CASCADE;
DROP TRIGGER IF EXISTS chk_event_quota ON public.events CASCADE;
DROP TRIGGER IF EXISTS chk_team_quota ON public.teams CASCADE;

DROP FUNCTION IF EXISTS public.trg_check_user_quota CASCADE;
DROP FUNCTION IF EXISTS public.trg_check_event_quota CASCADE;
DROP FUNCTION IF EXISTS public.trg_check_team_quota CASCADE;

DROP FUNCTION IF EXISTS public.has_feature CASCADE;
DROP FUNCTION IF EXISTS public.can_create_team CASCADE;
DROP FUNCTION IF EXISTS public.can_create_event CASCADE;
DROP FUNCTION IF EXISTS public.can_create_user CASCADE;

DROP VIEW IF EXISTS public.tenant_usage CASCADE;
DROP TABLE IF EXISTS public.plan_features CASCADE;
