-- Archived tenant administration.

CREATE OR REPLACE FUNCTION public.list_archived_tenants_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.current_role_name() <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Permission denied: SUPER_ADMIN required';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'archived_at' DESC, row_data->>'created_at' DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id', ten.id,
        'tenant_id', ten.id,
        'name', ten.name,
        'slug', ten.slug,
        'status', COALESCE(ten.status, 'active'),
        'created_at', ten.created_at,
        'updated_at', ten.updated_at,
        'archived_at', ten.updated_at,
        'tournaments_count', (SELECT count(*) FROM public.tournament t WHERE t.tenant_id = ten.id),
        'events_count', (SELECT count(*) FROM public.events e WHERE e.tenant_id = ten.id),
        'accounts_count', (SELECT count(*) FROM public.accounts a WHERE a.tenant_id = ten.id),
        'teams_count', (SELECT count(*) FROM public.teams tm WHERE tm.tenant_id = ten.id),
        'matches_count', (SELECT count(*) FROM public.matches m WHERE m.tenant_id = ten.id)
      ) AS row_data
      FROM public.tenants ten
      WHERE COALESCE(ten.status, 'active') = 'archived'
    ) rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hard_delete_tenant_v1(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
  v_event_ids text[];
  v_tournament_ids text[];
  v_account_ids uuid[];
  v_deleted jsonb;
  v_match_sets integer := 0;
  v_knockout_slots integer := 0;
  v_knockout_selections integer := 0;
  v_matches integer := 0;
  v_groups integer := 0;
  v_teams integer := 0;
  v_permissions integer := 0;
  v_sessions integer := 0;
  v_events integer := 0;
  v_tournaments integer := 0;
  v_subscriptions integer := 0;
  v_metrics integer := 0;
  v_accounts integer := 0;
  v_audit_logs integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.current_role_name() <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Permission denied: SUPER_ADMIN required';
  END IF;

  SELECT * INTO v_tenant
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF v_tenant.id IS NULL THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  IF COALESCE(v_tenant.status, 'active') <> 'archived' THEN
    RAISE EXCEPTION 'Only archived tenants can be hard deleted';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::text[])
  INTO v_event_ids
  FROM public.events
  WHERE tenant_id = p_tenant_id;

  SELECT COALESCE(array_agg(id), ARRAY[]::text[])
  INTO v_tournament_ids
  FROM public.tournament
  WHERE tenant_id = p_tenant_id;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO v_account_ids
  FROM public.accounts
  WHERE tenant_id = p_tenant_id;

  DELETE FROM public.match_sets WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_match_sets = ROW_COUNT;

  IF to_regclass('public.knockout_slots') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.knockout_slots WHERE tenant_id = $1' USING p_tenant_id;
    GET DIAGNOSTICS v_knockout_slots = ROW_COUNT;
  END IF;

  IF to_regclass('public.event_knockout_selections') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.event_knockout_selections WHERE event_id = ANY($1)' USING v_event_ids;
    GET DIAGNOSTICS v_knockout_selections = ROW_COUNT;
  END IF;

  DELETE FROM public.matches WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_matches = ROW_COUNT;

  DELETE FROM public.groups WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_groups = ROW_COUNT;

  DELETE FROM public.teams WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_teams = ROW_COUNT;

  DELETE FROM public.account_event_permissions
  WHERE tenant_id = p_tenant_id
     OR event_id = ANY(v_event_ids)
     OR account_id = ANY(v_account_ids);
  GET DIAGNOSTICS v_permissions = ROW_COUNT;

  IF to_regclass('public.active_sessions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.active_sessions WHERE account_id = ANY($1)' USING v_account_ids;
    GET DIAGNOSTICS v_sessions = ROW_COUNT;
  END IF;

  UPDATE public.tournament
  SET current_event_id = NULL
  WHERE tenant_id = p_tenant_id;

  DELETE FROM public.events WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  DELETE FROM public.tournament WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_tournaments = ROW_COUNT;

  IF to_regclass('public.tenant_subscriptions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.tenant_subscriptions WHERE tenant_id = $1' USING p_tenant_id;
    GET DIAGNOSTICS v_subscriptions = ROW_COUNT;
  END IF;

  IF to_regclass('public.tenant_metrics') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.tenant_metrics WHERE tenant_id = $1' USING p_tenant_id;
    GET DIAGNOSTICS v_metrics = ROW_COUNT;
  END IF;

  DELETE FROM public.accounts WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_accounts = ROW_COUNT;

  DELETE FROM public.audit_logs WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_audit_logs = ROW_COUNT;

  DELETE FROM public.tenants WHERE id = p_tenant_id;

  v_deleted := jsonb_build_object(
    'match_sets', v_match_sets,
    'knockout_slots', v_knockout_slots,
    'knockout_selections', v_knockout_selections,
    'matches', v_matches,
    'groups', v_groups,
    'teams', v_teams,
    'account_event_permissions', v_permissions,
    'active_sessions', v_sessions,
    'events', v_events,
    'tournaments', v_tournaments,
    'tenant_subscriptions', v_subscriptions,
    'tenant_metrics', v_metrics,
    'accounts', v_accounts,
    'audit_logs', v_audit_logs
  );

  RETURN jsonb_build_object('success', true, 'tenant_id', p_tenant_id, 'deleted', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.list_archived_tenants_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hard_delete_tenant_v1(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.list_archived_tenants_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_tenant_v1(uuid) TO authenticated;
