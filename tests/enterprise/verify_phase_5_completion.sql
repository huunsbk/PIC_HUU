WITH expected_usage AS (
  SELECT
    t.id AS tenant_id,
    (SELECT count(*) FROM public.accounts a WHERE a.tenant_id = t.id AND a.deleted_at IS NULL) AS users_used,
    (
      SELECT count(*)
      FROM public.events e
      WHERE e.tenant_id = t.id
        AND e.deleted_at IS NULL
        AND COALESCE(e.status, 'active') <> 'archived'
    ) AS events_used,
    (SELECT count(*) FROM public.teams tm WHERE tm.tenant_id = t.id AND tm.deleted_at IS NULL) AS teams_used
  FROM public.tenants t
), usage_mismatches AS (
  SELECT u.tenant_id
  FROM public.tenant_usage u
  JOIN expected_usage e ON e.tenant_id = u.tenant_id
  WHERE u.users_used IS DISTINCT FROM e.users_used
     OR u.events_used IS DISTINCT FROM e.events_used
     OR u.teams_used IS DISTINCT FROM e.teams_used
), duplicate_current_subscriptions AS (
  SELECT tenant_id
  FROM public.tenant_subscriptions
  WHERE status IN ('active', 'trial')
  GROUP BY tenant_id
  HAVING count(*) > 1
), required_triggers AS (
  SELECT unnest(ARRAY[
    'trg_accounts_saas_quota_v1',
    'trg_events_saas_quota_v1',
    'trg_teams_saas_quota_v1'
  ]) AS trigger_name
), missing_triggers AS (
  SELECT required_triggers.trigger_name
  FROM required_triggers
  LEFT JOIN pg_trigger triggers
    ON triggers.tgname = required_triggers.trigger_name
   AND NOT triggers.tgisinternal
  WHERE triggers.oid IS NULL
)
SELECT jsonb_build_object(
  'success',
    NOT EXISTS (SELECT 1 FROM usage_mismatches)
    AND NOT EXISTS (SELECT 1 FROM duplicate_current_subscriptions)
    AND NOT EXISTS (SELECT 1 FROM missing_triggers)
    AND has_function_privilege('authenticated', 'public.get_tenant_entitlements_v1(uuid)'::regprocedure, 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.list_my_effective_access_grants_v1()'::regprocedure, 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.can_access_workspace_v1(text)'::regprocedure, 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.log_audit_event_v1(text,text,text,jsonb)'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.get_tenant_entitlements_v1(uuid)'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.list_my_effective_access_grants_v1()'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.can_access_workspace_v1(text)'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.ensure_tenant_quota_v1(uuid,text,integer)'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.record_security_audit_v1(text,text,text,text,text,jsonb)'::regprocedure, 'EXECUTE'),
  'usage_mismatches', COALESCE((SELECT jsonb_agg(tenant_id) FROM usage_mismatches), '[]'::jsonb),
  'duplicate_current_subscriptions', COALESCE((SELECT jsonb_agg(tenant_id) FROM duplicate_current_subscriptions), '[]'::jsonb),
  'missing_quota_triggers', COALESCE((SELECT jsonb_agg(trigger_name) FROM missing_triggers), '[]'::jsonb)
) AS phase_5_completion;

