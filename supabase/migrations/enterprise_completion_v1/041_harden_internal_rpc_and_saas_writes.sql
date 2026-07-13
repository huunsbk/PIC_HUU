-- Security Gate 4E: finish least-privilege hardening for SaaS tables and
-- SECURITY DEFINER helpers that are implementation details, not public APIs.

DO $$
DECLARE
  table_name text;
  tables_to_harden text[] := ARRAY[
    'account_permissions',
    'invoices',
    'login_logs',
    'payments',
    'permissions',
    'plan_features',
    'role_permissions',
    'roles',
    'saas_metrics',
    'sports',
    'subscription_plans',
    'tenant_subscriptions',
    'tenant_usage',
    'tournament_admins',
    'tournament_owners'
  ];
BEGIN
  FOREACH table_name IN ARRAY tables_to_harden LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        table_name
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  function_signature text;
  function_oid regprocedure;
  internal_functions text[] := ARRAY[
    'public.assert_round_set_modes_change_allowed_v1(text,jsonb,jsonb)',
    'public.audit_matches_changes_safe_v4()',
    'public.ensure_manage_event_access_v1(text)',
    'public.ensure_manage_event_for_tournament_v1(text)',
    'public.ensure_manage_tenants_v1()',
    'public.ensure_manage_tournaments_v1(uuid)',
    'public.get_match_scoring_rule_v1(text)',
    'public.get_match_set_mode_v1(text)',
    'public.invalidate_account_sessions_v1(uuid)',
    'public.log_audit_event_v1(text,text,text,jsonb)',
    'public.p06_require_event_admin_v1(text,text,text)',
    'public.p10_core_reset_match_score_v1(text)',
    'public.p10_core_update_match_score_v1(text,integer,integer)',
    'public.p10_core_update_match_set_score_v1(text,integer,integer,integer)',
    'public.p10_has_event_permission_v1(text,text)',
    'public.p10_require_event_admin_v1(text,text,text)',
    'public.p10_require_match_score_context_v1(text,text)',
    'public.p10_validate_event_context_v1(text)',
    'public.p12_propagate_knockout_winner_v1(text)',
    'public.p12_reset_knockout_downstream_v1(text)',
    'public.p22_assert_group_stage_change_allowed_v1(text)',
    'public.p22_sync_knockout_after_group_stage_change_v1(text)',
    'public.trigger_auto_assign_event()',
    'public.validate_event_config_v1(text,text,text,jsonb,jsonb)'
  ];
BEGIN
  FOREACH function_signature IN ARRAY internal_functions LOOP
    function_oid := to_regprocedure(function_signature);
    IF function_oid IS NOT NULL THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
        function_oid
      );
    END IF;
  END LOOP;
END $$;

-- The supported application surface remains explicit. Internal SECURITY
-- DEFINER helpers above are callable by their owner functions without being
-- directly executable by browser roles.
GRANT EXECUTE ON FUNCTION public.get_public_tournament_snapshot_v1(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_login_session_v1() TO authenticated;
