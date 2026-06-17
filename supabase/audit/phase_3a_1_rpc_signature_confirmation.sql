-- Phase 3A.1 RPC signature confirmation
-- Environment: staging
-- Project ref: ykckqcykxfhpfqptckxk
--
-- Purpose:
-- Confirm RPC overloads before capturing execution-plan evidence.
--
-- Do not run from automation. Execute manually in Supabase SQL Editor only.

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'get_tournament_workspace_dashboard_v6',
    'archive_tournament_workspace_v6',
    'get_tournament_owner'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- Expected callable signatures for Phase 3A.1 evidence:
-- select * from public.get_tournament_workspace_dashboard_v6(NULL::timestamptz, 50);
-- select * from public.get_tournament_owner('__TEST_EVENT_ID__'::text);
-- select * from public.archive_tournament_workspace_v6('__TEST_TOURNAMENT_ID__'::text);
