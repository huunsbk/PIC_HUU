-- =====================================================
-- PHASE 5 VERIFICATION 
-- SaaS Quota Management & Automated Billing
-- =====================================================

SELECT 'Table plan_features exists' AS test_name, 
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'plan_features') AS passed;

SELECT 'View tenant_usage exists' AS test_name, 
       EXISTS(SELECT 1 FROM information_schema.views WHERE table_name = 'tenant_usage') AS passed;

SELECT 'Function can_create_user exists' AS test_name, 
       EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'can_create_user') AS passed;

SELECT 'Function can_create_event exists' AS test_name, 
       EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'can_create_event') AS passed;

SELECT 'Function can_create_team exists' AS test_name, 
       EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'can_create_team') AS passed;

SELECT 'Function has_feature exists' AS test_name, 
       EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'has_feature') AS passed;

SELECT 'Trigger on accounts exists' AS test_name, 
       EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'chk_user_quota') AS passed;

SELECT 'Trigger on events exists' AS test_name, 
       EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'chk_event_quota') AS passed;

SELECT 'Trigger on teams exists' AS test_name, 
       EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'chk_team_quota') AS passed;

SELECT 'Function expire_trial_subscriptions exists' AS test_name, 
       EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'expire_trial_subscriptions') AS passed;

SELECT 'Function generate_monthly_invoices exists' AS test_name, 
       EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'generate_monthly_invoices') AS passed;

SELECT 'View saas_metrics exists' AS test_name, 
       EXISTS(SELECT 1 FROM information_schema.views WHERE table_name = 'saas_metrics') AS passed;
