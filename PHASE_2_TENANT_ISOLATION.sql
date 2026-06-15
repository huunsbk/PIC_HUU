-- PHASE 2: TENANT ISOLATION
-- 1. Clean up dangerous implicit 'anon and authenticated' global policies
DROP POLICY IF EXISTS "Cho phép mọi người xem thông tin giải đấu" ON public.tournament;
DROP POLICY IF EXISTS "Cho phép mọi người xem nội dung thi đấu" ON public.events;
DROP POLICY IF EXISTS "Cho phép mọi người xem danh sách đội bóng" ON public.teams;
DROP POLICY IF EXISTS "Cho phép mọi người xem danh sách bảng đấu" ON public.groups;
DROP POLICY IF EXISTS "Cho phép mọi người xem lịch và kết quả trận" ON public.matches;
DROP POLICY IF EXISTS "Cho phép mọi người xem nhật ký hoạt động" ON public.audit_logs;
DROP POLICY IF EXISTS "Cho phép ghi tự do cho anon và authenticated" ON public.tournament;
DROP POLICY IF EXISTS "Cho phép ghi tự do cho anon và authenticated" ON public.events;
DROP POLICY IF EXISTS "Cho phép ghi tự do cho anon và authenticated" ON public.teams;
DROP POLICY IF EXISTS "Cho phép ghi tự do cho anon và authenticated" ON public.groups;
DROP POLICY IF EXISTS "Cho phép ghi tự do cho anon và authenticated" ON public.matches;
DROP POLICY IF EXISTS "Cho phép ghi tự do cho anon và authenticated" ON public.audit_logs;

-- 2. Establish Strict Tenant Isolation Policies 
CREATE POLICY "Tenant_Isolation_Events" ON public.events FOR ALL TO authenticated
USING ( 
  tenant_id::TEXT = public.current_tenant_id()::TEXT OR 
  public.current_role() = 'SUPER_ADMIN' 
)
WITH CHECK ( 
  tenant_id::TEXT = public.current_tenant_id()::TEXT OR 
  public.current_role() = 'SUPER_ADMIN' 
);

CREATE POLICY "Tenant_Isolation_Teams" ON public.teams FOR ALL TO authenticated
USING ( tenant_id::TEXT = public.current_tenant_id()::TEXT OR public.current_role() = 'SUPER_ADMIN' )
WITH CHECK ( tenant_id::TEXT = public.current_tenant_id()::TEXT OR public.current_role() = 'SUPER_ADMIN' );

CREATE POLICY "Tenant_Isolation_Groups" ON public.groups FOR ALL TO authenticated
USING ( tenant_id::TEXT = public.current_tenant_id()::TEXT OR public.current_role() = 'SUPER_ADMIN' )
WITH CHECK ( tenant_id::TEXT = public.current_tenant_id()::TEXT OR public.current_role() = 'SUPER_ADMIN' );

CREATE POLICY "Tenant_Isolation_Matches" ON public.matches FOR ALL TO authenticated
USING ( tenant_id::TEXT = public.current_tenant_id()::TEXT OR public.current_role() = 'SUPER_ADMIN' )
WITH CHECK ( tenant_id::TEXT = public.current_tenant_id()::TEXT OR public.current_role() = 'SUPER_ADMIN' );

CREATE POLICY "Tenant_Isolation_Tournament" ON public.tournament FOR ALL TO authenticated
USING ( tenant_id::TEXT = public.current_tenant_id()::TEXT OR public.current_role() = 'SUPER_ADMIN' )
WITH CHECK ( tenant_id::TEXT = public.current_tenant_id()::TEXT OR public.current_role() = 'SUPER_ADMIN' );
