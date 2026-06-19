CREATE TEMP TABLE __codex_reset_guard AS
SELECT count(*)::integer AS active_super_admin_count
FROM public.accounts a
JOIN public.roles r ON r.id = a.role_id
WHERE r.name = 'SUPER_ADMIN'
  AND a.status = 'active';

DO $$
DECLARE
  v_active_super_admin_count integer;
  v_table text;
BEGIN
  SELECT active_super_admin_count
  INTO v_active_super_admin_count
  FROM __codex_reset_guard;

  IF v_active_super_admin_count < 1 THEN
    RAISE EXCEPTION 'Blocked reset: active SUPER_ADMIN count is %', v_active_super_admin_count;
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'match_sets',
    'matches',
    'event_knockout_selections',
    'groups',
    'teams',
    'account_event_permissions',
    'events',
    'tournament',
    'payments',
    'invoices',
    'tenant_subscriptions',
    'audit_logs'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format('DELETE FROM public.%I', v_table);
    END IF;
  END LOOP;
END $$;
