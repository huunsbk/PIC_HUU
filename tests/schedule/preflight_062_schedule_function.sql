SELECT
  p.oid::regprocedure::text AS signature,
  p.prosecdef AS security_definer,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS result_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('generate_schedule_v1', 'build_round_robin_pairs_v1')
ORDER BY p.proname, p.oid::regprocedure::text;
