-- PHASE 3: PRODUCTION VERIFICATION SUITE

-- 1. Check RLS is force enabled on all business tables
SELECT 
    tablename, 
    rowsecurity as has_rls,
    forcerowsecurity as force_rls
FROM pg_tables 
WHERE schemaname = 'public'
AND tablename IN ('events', 'teams', 'groups', 'matches', 'accounts', 'audit_logs', 'tenants');

-- 2. Check for missing policies (Tables with RLS but no policies)
SELECT t.tablename
FROM pg_tables t
LEFT JOIN pg_policies p ON t.tablename = p.tablename AND p.schemaname = 'public'
WHERE t.schemaname = 'public' AND t.rowsecurity = true AND p.policyname IS NULL;

-- 3. Check for orphaned accounts (Accounts mapped to dead users)
SELECT a.id, a.user_id 
FROM public.accounts a 
LEFT JOIN auth.users u ON a.user_id = u.id 
WHERE u.id IS NULL AND a.user_id IS NOT NULL;

-- 4. Check for orphaned tenants (Tenants with no admin)
SELECT t.id, t.name 
FROM public.tenants t
LEFT JOIN public.accounts a ON t.id = a.tenant_id
WHERE a.id IS NULL AND t.deleted_at IS NULL;

-- 5. Duplicate User Check
SELECT user_id, COUNT(*) 
FROM public.accounts 
GROUP BY user_id 
HAVING COUNT(*) > 1;

-- Provide summary OK state if all passes
