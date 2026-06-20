WITH
account_health AS (
  SELECT
    a.id,
    a.user_id,
    au.email AS auth_email,
    NULL::text AS account_email,
    a.username,
    a.display_name,
    a.status,
    a.tenant_id,
    t.name AS tenant_name,
    t.slug AS tenant_slug,
    a.role_id,
    r.name AS role_name,
    a.created_at,
    a.updated_at,
    a.deleted_at,
    CASE
      WHEN a.user_id IS NULL THEN 'MISSING_AUTH_USER_ID'
      WHEN au.id IS NULL THEN 'AUTH_USER_NOT_FOUND'
      WHEN a.tenant_id IS NULL THEN 'MISSING_TENANT_ID'
      WHEN t.id IS NULL THEN 'TENANT_NOT_FOUND'
      WHEN a.role_id IS NULL THEN 'MISSING_ROLE_ID'
      WHEN r.id IS NULL THEN 'ROLE_NOT_FOUND'
      WHEN a.deleted_at IS NOT NULL THEN 'SOFT_DELETED'
      ELSE 'OK'
    END AS account_health
  FROM public.accounts a
  LEFT JOIN auth.users au ON au.id = a.user_id
  LEFT JOIN public.tenants t ON t.id = a.tenant_id
  LEFT JOIN public.roles r ON r.id = a.role_id
),
auth_account_health AS (
  SELECT
    au.id,
    au.email,
    au.email_confirmed_at,
    au.created_at,
    au.last_sign_in_at,
    a.id AS account_id,
    a.username,
    a.tenant_id,
    t.name AS tenant_name,
    r.name AS role_name,
    CASE
      WHEN a.id IS NULL THEN 'MISSING_PUBLIC_ACCOUNT'
      ELSE 'OK'
    END AS auth_account_health
  FROM auth.users au
  LEFT JOIN public.accounts a ON a.user_id = au.id
  LEFT JOIN public.tenants t ON t.id = a.tenant_id
  LEFT JOIN public.roles r ON r.id = a.role_id
),
tenant_quota_health AS (
  SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    t.slug,
    t.status AS tenant_status,
    ts.id AS subscription_id,
    ts.status AS subscription_status,
    ts.start_date,
    ts.end_date,
    sp.id AS plan_id,
    sp.name AS plan_name,
    sp.monthly_price,
    sp.max_users,
    sp.max_events,
    sp.max_teams,
    tu.users_used,
    tu.users_limit,
    tu.events_used,
    tu.events_limit,
    tu.teams_used,
    tu.teams_limit,
    CASE
      WHEN tu.tenant_id IS NULL THEN 'MISSING_TENANT_USAGE'
      WHEN ts.id IS NULL THEN 'MISSING_ACTIVE_OR_TRIAL_SUBSCRIPTION'
      WHEN tu.users_used >= tu.users_limit THEN 'BLOCKED_BY_USER_LIMIT'
      ELSE 'CAN_CREATE_USER'
    END AS user_create_status
  FROM public.tenants t
  LEFT JOIN public.tenant_subscriptions ts
    ON ts.tenant_id = t.id
   AND ts.status IN ('active', 'trial')
  LEFT JOIN public.subscription_plans sp
    ON sp.id = ts.plan_id
  LEFT JOIN public.tenant_usage tu
    ON tu.tenant_id = t.id
  WHERE t.deleted_at IS NULL
),
important_permissions AS (
  SELECT
    r.name AS role_name,
    p.name AS permission_name
  FROM public.role_permissions rp
  JOIN public.roles r ON r.id = rp.role_id
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE p.name IN ('*', 'manage_accounts', 'manage_tenants', 'manage_billing', 'manage_events', 'enter_scores', 'view_public')
),
duplicate_usernames AS (
  SELECT username, COUNT(*) AS count
  FROM public.accounts
  WHERE deleted_at IS NULL
  GROUP BY username
  HAVING COUNT(*) > 1
),
duplicate_emails AS (
  SELECT au.email, COUNT(*) AS count
  FROM auth.users au
  JOIN public.accounts a ON a.user_id = au.id
  WHERE au.email IS NOT NULL AND a.deleted_at IS NULL
  GROUP BY au.email
  HAVING COUNT(*) > 1
),
event_permission_health AS (
  SELECT
    aep.id,
    aep.account_id,
    a.username,
    a.display_name,
    a.tenant_id AS account_tenant_id,
    at.name AS account_tenant_name,
    aep.event_id,
    e.name AS event_name,
    e.tenant_id AS event_tenant_id,
    et.name AS event_tenant_name,
    aep.permission,
    aep.created_at,
    aep.deleted_at,
    CASE
      WHEN a.tenant_id IS DISTINCT FROM e.tenant_id THEN 'TENANT_MISMATCH'
      WHEN a.deleted_at IS NOT NULL THEN 'ACCOUNT_DELETED'
      WHEN e.deleted_at IS NOT NULL THEN 'EVENT_DELETED'
      ELSE 'OK'
    END AS event_permission_health
  FROM public.account_event_permissions aep
  LEFT JOIN public.accounts a ON a.id = aep.account_id
  LEFT JOIN public.tenants at ON at.id = a.tenant_id
  LEFT JOIN public.events e ON e.id = aep.event_id
  LEFT JOIN public.tenants et ON et.id = e.tenant_id
),
recent_audit AS (
  SELECT *
  FROM public.audit_logs
  WHERE
    action ILIKE '%account%'
    OR action ILIKE '%tenant%'
    OR action ILIKE '%user%'
    OR action ILIKE '%subscription%'
  ORDER BY created_at DESC
  LIMIT 200
),
table_counts AS (
  SELECT 'accounts' AS table_name, COUNT(*)::bigint AS count FROM public.accounts
  UNION ALL SELECT 'tenants', COUNT(*) FROM public.tenants
  UNION ALL SELECT 'roles', COUNT(*) FROM public.roles
  UNION ALL SELECT 'permissions', COUNT(*) FROM public.permissions
  UNION ALL SELECT 'role_permissions', COUNT(*) FROM public.role_permissions
  UNION ALL SELECT 'tenant_subscriptions', COUNT(*) FROM public.tenant_subscriptions
  UNION ALL SELECT 'subscription_plans', COUNT(*) FROM public.subscription_plans
  UNION ALL SELECT 'tenant_usage', COUNT(*) FROM public.tenant_usage
  UNION ALL SELECT 'saas_metrics', COUNT(*) FROM public.saas_metrics
  UNION ALL SELECT 'audit_logs', COUNT(*) FROM public.audit_logs
  UNION ALL SELECT 'events', COUNT(*) FROM public.events
  UNION ALL SELECT 'tournament', COUNT(*) FROM public.tournament
)
SELECT json_build_object(
  'account_health', (SELECT COALESCE(json_agg(to_jsonb(account_health) ORDER BY account_health.account_health, account_health.tenant_name, account_health.role_name, account_health.username), '[]'::json) FROM account_health),
  'auth_account_health', (SELECT COALESCE(json_agg(to_jsonb(auth_account_health) ORDER BY auth_account_health.created_at DESC), '[]'::json) FROM auth_account_health),
  'tenant_quota_health', (SELECT COALESCE(json_agg(to_jsonb(tenant_quota_health) ORDER BY tenant_quota_health.tenant_name), '[]'::json) FROM tenant_quota_health),
  'important_permissions', (SELECT COALESCE(json_agg(to_jsonb(important_permissions) ORDER BY important_permissions.role_name, important_permissions.permission_name), '[]'::json) FROM important_permissions),
  'duplicate_usernames', (SELECT COALESCE(json_agg(to_jsonb(duplicate_usernames) ORDER BY duplicate_usernames.username), '[]'::json) FROM duplicate_usernames),
  'duplicate_emails', (SELECT COALESCE(json_agg(to_jsonb(duplicate_emails) ORDER BY duplicate_emails.email), '[]'::json) FROM duplicate_emails),
  'event_permission_health', (SELECT COALESCE(json_agg(to_jsonb(event_permission_health) ORDER BY event_permission_health.created_at DESC), '[]'::json) FROM event_permission_health),
  'recent_audit', (SELECT COALESCE(json_agg(to_jsonb(recent_audit)), '[]'::json) FROM recent_audit),
  'table_counts', (SELECT COALESCE(json_agg(to_jsonb(table_counts) ORDER BY table_counts.table_name), '[]'::json) FROM table_counts)
) AS diagnosis;
