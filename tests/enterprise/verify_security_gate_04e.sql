WITH protected_tables(table_name) AS (
  VALUES
    ('account_permissions'),
    ('invoices'),
    ('login_logs'),
    ('payments'),
    ('permissions'),
    ('plan_features'),
    ('role_permissions'),
    ('roles'),
    ('saas_metrics'),
    ('sports'),
    ('subscription_plans'),
    ('tenant_subscriptions'),
    ('tenant_usage'),
    ('tournament_admins'),
    ('tournament_owners')
), forbidden_table_grants AS (
  SELECT g.table_name, g.grantee, g.privilege_type
  FROM information_schema.role_table_grants g
  JOIN protected_tables p ON p.table_name = g.table_name
  WHERE g.table_schema = 'public'
    AND g.grantee IN ('PUBLIC', 'anon', 'authenticated')
    AND g.privilege_type IN (
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    )
), protected_functions(function_signature) AS (
  VALUES
    ('public.invalidate_account_sessions_v1(uuid)'),
    ('public.log_audit_event_v1(text,text,text,jsonb)'),
    ('public.p12_propagate_knockout_winner_v1(text)'),
    ('public.p12_reset_knockout_downstream_v1(text)')
), exposed_internal_functions AS (
  SELECT
    p.function_signature,
    has_function_privilege('anon', to_regprocedure(p.function_signature), 'EXECUTE') AS anon_execute,
    has_function_privilege('authenticated', to_regprocedure(p.function_signature), 'EXECUTE') AS authenticated_execute
  FROM protected_functions p
)
SELECT jsonb_build_object(
  'success',
    NOT EXISTS (SELECT 1 FROM forbidden_table_grants)
    AND NOT EXISTS (
      SELECT 1
      FROM exposed_internal_functions
      WHERE anon_execute OR authenticated_execute
    ),
  'forbidden_table_grants',
    COALESCE((SELECT jsonb_agg(to_jsonb(g)) FROM forbidden_table_grants g), '[]'::jsonb),
  'exposed_internal_functions',
    COALESCE((
      SELECT jsonb_agg(to_jsonb(f))
      FROM exposed_internal_functions f
      WHERE f.anon_execute OR f.authenticated_execute
    ), '[]'::jsonb),
  'public_snapshot_anon_execute',
    has_function_privilege(
      'anon',
      'public.get_public_tournament_snapshot_v1(text)'::regprocedure,
      'EXECUTE'
    ),
  'login_session_authenticated_execute',
    has_function_privilege(
      'authenticated',
      'public.record_login_session_v1()'::regprocedure,
      'EXECUTE'
    )
) AS security_gate_04e;
