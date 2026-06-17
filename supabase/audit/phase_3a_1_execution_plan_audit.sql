-- Phase 3A.1 execution-plan audit templates
-- Environment: staging
-- Project ref: ykckqcykxfhpfqptckxk
--
-- Capture raw JSON output from Supabase Staging with:
-- EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
--
-- Do not run from automation. Execute manually in Supabase SQL Editor only.

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
select *
from public.get_tournament_workspace_dashboard_v6(NULL::timestamptz, 50);

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
select *
from public.get_tournament_owner('__TEST_EVENT_ID__'::text);

BEGIN;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
select *
from public.archive_tournament_workspace_v6('__TEST_TOURNAMENT_ID__'::text);

ROLLBACK;
