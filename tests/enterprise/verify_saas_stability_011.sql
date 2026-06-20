WITH checks AS (
  SELECT
    (SELECT count(*) FROM public.accounts a WHERE a.deleted_at IS NULL AND (a.user_id IS NULL OR a.tenant_id IS NULL OR a.role_id IS NULL)) AS broken_accounts,
    (SELECT count(*) FROM auth.users au LEFT JOIN public.accounts a ON a.user_id = au.id WHERE a.id IS NULL) AS auth_users_without_accounts,
    (
      SELECT count(*)
      FROM public.tenants t
      LEFT JOIN public.tenant_subscriptions ts
        ON ts.tenant_id = t.id
       AND ts.status IN ('active', 'trial')
      WHERE t.deleted_at IS NULL
        AND t.status = 'active'
        AND ts.id IS NULL
    ) AS active_tenants_missing_subscription,
    (
      SELECT count(*)
      FROM public.tenants t
      LEFT JOIN public.tenant_usage tu ON tu.tenant_id = t.id
      WHERE t.deleted_at IS NULL
        AND t.status = 'active'
        AND (
          tu.tenant_id IS NULL
          OR tu.users_used >= tu.users_limit
        )
    ) AS active_tenants_blocked_by_usage,
    (
      SELECT count(*)
      FROM public.account_event_permissions aep
      JOIN public.accounts a ON a.id = aep.account_id
      JOIN public.events e ON e.id = aep.event_id
      WHERE aep.deleted_at IS NULL
        AND a.tenant_id IS DISTINCT FROM e.tenant_id
    ) AS active_cross_tenant_event_permissions,
    (
      SELECT count(*)
      FROM public.roles
      WHERE name = 'EVENT_' || 'MANAGER'
    ) AS legacy_event_manager_roles
)
SELECT
  *,
  CASE
    WHEN broken_accounts = 0
     AND active_tenants_missing_subscription = 0
     AND active_tenants_blocked_by_usage = 0
     AND active_cross_tenant_event_permissions = 0
     AND legacy_event_manager_roles = 0
    THEN 'PASS'
    ELSE 'CHECK'
  END AS stability_status
FROM checks;
