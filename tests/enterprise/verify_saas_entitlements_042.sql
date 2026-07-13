WITH expected_usage AS (
  SELECT
    t.id AS tenant_id,
    (SELECT count(*) FROM public.accounts a WHERE a.tenant_id = t.id AND a.deleted_at IS NULL) AS users_used,
    (SELECT count(*) FROM public.events e WHERE e.tenant_id = t.id AND e.deleted_at IS NULL) AS events_used,
    (SELECT count(*) FROM public.teams tm WHERE tm.tenant_id = t.id AND tm.deleted_at IS NULL) AS teams_used
  FROM public.tenants t
), usage_mismatches AS (
  SELECT
    u.tenant_id,
    u.users_used,
    e.users_used AS expected_users_used,
    u.events_used,
    e.events_used AS expected_events_used,
    u.teams_used,
    e.teams_used AS expected_teams_used
  FROM public.tenant_usage u
  JOIN expected_usage e ON e.tenant_id = u.tenant_id
  WHERE u.users_used IS DISTINCT FROM e.users_used
     OR u.events_used IS DISTINCT FROM e.events_used
     OR u.teams_used IS DISTINCT FROM e.teams_used
), duplicate_current_subscriptions AS (
  SELECT tenant_id, count(*) AS subscription_count
  FROM public.tenant_subscriptions
  WHERE status IN ('active', 'trial')
  GROUP BY tenant_id
  HAVING count(*) > 1
)
SELECT jsonb_build_object(
  'success',
    NOT EXISTS (SELECT 1 FROM usage_mismatches)
    AND NOT EXISTS (SELECT 1 FROM duplicate_current_subscriptions)
    AND has_function_privilege(
      'authenticated',
      'public.get_tenant_entitlements_v1(uuid)'::regprocedure,
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.get_tenant_entitlements_v1(uuid)'::regprocedure,
      'EXECUTE'
    ),
  'usage_mismatches',
    COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM usage_mismatches m), '[]'::jsonb),
  'duplicate_current_subscriptions',
    COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM duplicate_current_subscriptions d), '[]'::jsonb)
) AS saas_entitlements_042;
