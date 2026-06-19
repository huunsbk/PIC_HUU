WITH target_tables(schema_name, table_name, category) AS (
  VALUES
    ('auth', 'users', 'protected'),
    ('public', 'accounts', 'protected'),
    ('public', 'roles', 'protected'),
    ('public', 'permissions', 'protected'),
    ('public', 'role_permissions', 'protected'),
    ('public', 'sports', 'protected'),
    ('public', 'tenants', 'protected'),
    ('public', 'match_sets', 'business'),
    ('public', 'matches', 'business'),
    ('public', 'event_knockout_selections', 'business'),
    ('public', 'groups', 'business'),
    ('public', 'teams', 'business'),
    ('public', 'account_event_permissions', 'business'),
    ('public', 'events', 'business'),
    ('public', 'tournament', 'business'),
    ('public', 'tenant_subscriptions', 'business'),
    ('public', 'invoices', 'business'),
    ('public', 'payments', 'business'),
    ('public', 'audit_logs', 'business')
),
table_counts AS (
  SELECT
    schema_name,
    table_name,
    category,
    to_regclass(format('%I.%I', schema_name, table_name)) IS NOT NULL AS exists,
    CASE
      WHEN to_regclass(format('%I.%I', schema_name, table_name)) IS NULL THEN NULL::bigint
      ELSE (
        xpath(
          '//row_count/text()',
          query_to_xml(
            format('SELECT count(*) AS row_count FROM %I.%I', schema_name, table_name),
            false,
            true,
            ''
          )
        )
      )[1]::text::bigint
    END AS row_count
  FROM target_tables
),
super_admin AS (
  SELECT count(*)::bigint AS active_super_admin_count
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  WHERE r.name = 'SUPER_ADMIN'
    AND a.status = 'active'
)
SELECT
  tc.schema_name,
  tc.table_name,
  tc.category,
  tc.exists,
  tc.row_count,
  sa.active_super_admin_count
FROM table_counts tc
CROSS JOIN super_admin sa
ORDER BY
  CASE tc.category WHEN 'protected' THEN 0 ELSE 1 END,
  tc.schema_name,
  tc.table_name;
