WITH expected_triggers(trigger_name, table_name) AS (
  VALUES
    ('trg_accounts_saas_quota_v1', 'accounts'),
    ('trg_events_saas_quota_v1', 'events'),
    ('trg_teams_saas_quota_v1', 'teams')
), missing_triggers AS (
  SELECT e.*
  FROM expected_triggers e
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.triggers t
    WHERE t.event_object_schema = 'public'
      AND t.event_object_table = e.table_name
      AND t.trigger_name = e.trigger_name
  )
)
SELECT jsonb_build_object(
  'success',
    NOT EXISTS (SELECT 1 FROM missing_triggers)
    AND NOT has_function_privilege(
      'authenticated',
      'public.ensure_tenant_quota_v1(uuid,text,integer)'::regprocedure,
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.ensure_tenant_quota_v1(uuid,text,integer)'::regprocedure,
      'EXECUTE'
    ),
  'missing_triggers',
    COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM missing_triggers m), '[]'::jsonb)
) AS saas_quota_enforcement_043;
