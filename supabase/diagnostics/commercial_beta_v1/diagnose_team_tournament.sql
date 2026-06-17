SELECT json_build_object(
  'captured_at', now(),
  'columns', (
    SELECT json_object_agg(table_name, columns)
    FROM (
      SELECT
        table_name,
        json_agg(
          json_build_object(
            'column_name', column_name,
            'data_type', data_type,
            'is_nullable', is_nullable,
            'column_default', column_default
          )
          ORDER BY ordinal_position
        ) AS columns
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (
          'tournament',
          'events',
          'teams',
          'groups',
          'matches',
          'accounts',
          'account_event_permissions'
        )
      GROUP BY table_name
    ) column_report
  ),
  'rls_policies', (
    SELECT COALESCE(json_agg(
      json_build_object(
        'schemaname', schemaname,
        'tablename', tablename,
        'policyname', policyname,
        'permissive', permissive,
        'roles', roles,
        'cmd', cmd,
        'qual', qual,
        'with_check', with_check
      )
      ORDER BY tablename, policyname
    ), '[]'::json)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'tournament',
        'events',
        'teams',
        'groups',
        'matches',
        'accounts',
        'account_event_permissions'
      )
  ),
  'triggers', (
    SELECT COALESCE(json_agg(
      json_build_object(
        'table_name', event_object_table,
        'trigger_name', trigger_name,
        'event_manipulation', event_manipulation,
        'action_timing', action_timing,
        'action_statement', action_statement
      )
      ORDER BY event_object_table, trigger_name, event_manipulation
    ), '[]'::json)
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table IN (
        'tournament',
        'events',
        'teams',
        'groups',
        'matches'
      )
  ),
  'rpc_signatures', (
    SELECT COALESCE(json_agg(
      json_build_object(
        'schema_name', n.nspname,
        'function_name', p.proname,
        'identity_arguments', pg_get_function_identity_arguments(p.oid),
        'result_type', pg_get_function_result(p.oid),
        'security_definer', p.prosecdef,
        'volatility', CASE p.provolatile
          WHEN 'i' THEN 'IMMUTABLE'
          WHEN 's' THEN 'STABLE'
          WHEN 'v' THEN 'VOLATILE'
          ELSE p.provolatile::text
        END
      )
      ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
    ), '[]'::json)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'can_create_team',
        'has_permission',
        'current_account_id',
        'current_tenant_id',
        'get_tournament_workspace_dashboard_v6'
      )
  ),
  'row_counts', json_build_object(
    'tournament', (SELECT COUNT(*) FROM public.tournament),
    'events', (SELECT COUNT(*) FROM public.events),
    'teams', (SELECT COUNT(*) FROM public.teams),
    'groups', (SELECT COUNT(*) FROM public.groups),
    'matches', (SELECT COUNT(*) FROM public.matches)
  )
) AS commercial_beta_v1_team_tournament_diagnostics;
