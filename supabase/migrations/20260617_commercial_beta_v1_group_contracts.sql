-- Commercial Beta V1 CTO database contracts.
--
-- These RPCs replace missing runtime contracts:
-- - setup_groups_v1 -> setup_groups_v2
-- - record_login_session -> record_login_session_v1
--
-- Apply only to the controlled Commercial Beta database after read-only
-- preflight confirms the required functions, tables, and columns exist.

CREATE OR REPLACE FUNCTION public.setup_groups_v2(
  p_event_id text,
  p_num_groups integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id uuid;
  v_role_name text;
  v_event_tournament_id text;
  v_group_ids text[] := ARRAY[]::text[];
  v_group_id text;
  v_group_name text;
  v_index integer;
  v_letter_index integer;
  v_letter_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'p_event_id is required';
  END IF;

  IF p_num_groups IS NULL OR p_num_groups < 1 OR p_num_groups > 32 THEN
    RAISE EXCEPTION 'p_num_groups must be between 1 and 32';
  END IF;

  v_tenant_id := public.current_tenant_id();
  v_role_name := public.current_role_name();

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant context is required';
  END IF;

  IF NOT (
    v_role_name = 'SUPER_ADMIN'
    OR v_role_name = 'TENANT_ADMIN'
    OR (
      public.has_permission('manage_groups')
      AND public.has_event_access(p_event_id)
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied for setup_groups_v2';
  END IF;

  SELECT e.tournament_id
    INTO v_event_tournament_id
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.tenant_id = v_tenant_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for current tenant';
  END IF;

  DELETE FROM public.matches
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id
    AND COALESCE(group_id, '') <> 'knockout';

  UPDATE public.teams
  SET group_id = NULL
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id;

  DELETE FROM public.groups
  WHERE event_id = p_event_id
    AND tenant_id = v_tenant_id;

  FOR v_index IN 0..(p_num_groups - 1) LOOP
    v_letter_index := v_index;
    v_letter_name := '';

    LOOP
      v_letter_name := chr(65 + (v_letter_index % 26)) || v_letter_name;
      v_letter_index := floor(v_letter_index / 26.0)::integer - 1;
      EXIT WHEN v_letter_index < 0;
    END LOOP;

    v_group_id := 'group-' || gen_random_uuid()::text;
    v_group_name := 'Bảng ' || v_letter_name;

    INSERT INTO public.groups (
      id,
      name,
      team_ids,
      event_id,
      tenant_id,
      tournament_id
    )
    VALUES (
      v_group_id,
      v_group_name,
      '[]'::jsonb,
      p_event_id,
      v_tenant_id,
      v_event_tournament_id
    );

    v_group_ids := array_append(v_group_ids, v_group_id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'num_groups', p_num_groups,
    'group_ids', to_jsonb(v_group_ids)
  );
END;
$function$;

COMMENT ON FUNCTION public.setup_groups_v2(text, integer) IS
  'Commercial Beta V1: permission-checked group setup scoped to current_tenant_id() and one event.';

CREATE OR REPLACE FUNCTION public.record_login_session_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id uuid;
  v_account_id uuid;
  v_has_action boolean;
  v_has_details boolean;
  v_has_timestamp boolean;
  v_has_tenant_id boolean;
  v_details_type text;
  v_timestamp_type text;
  v_columns text[] := ARRAY['action'];
  v_values text[] := ARRAY['$1'];
  v_details jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'skipped', true,
      'reason', 'authentication_required'
    );
  END IF;

  IF to_regclass('public.audit_logs') IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'skipped', true,
      'reason', 'audit_logs_table_missing'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_logs'
      AND column_name = 'action'
  )
  INTO v_has_action;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_logs'
      AND column_name = 'details'
  )
  INTO v_has_details;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_logs'
      AND column_name = 'timestamp'
  )
  INTO v_has_timestamp;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_logs'
      AND column_name = 'tenant_id'
  )
  INTO v_has_tenant_id;

  IF NOT (v_has_action AND v_has_details) THEN
    RETURN jsonb_build_object(
      'success', false,
      'skipped', true,
      'reason', 'audit_logs_incompatible_columns'
    );
  END IF;

  SELECT data_type
    INTO v_details_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'audit_logs'
    AND column_name = 'details'
  LIMIT 1;

  IF v_has_timestamp THEN
    SELECT data_type
      INTO v_timestamp_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_logs'
      AND column_name = 'timestamp'
    LIMIT 1;
  END IF;

  v_tenant_id := public.current_tenant_id();

  SELECT a.id
    INTO v_account_id
  FROM public.accounts a
  WHERE a.user_id = auth.uid()
  LIMIT 1;

  v_details := jsonb_build_object(
    'event', 'login',
    'account_id', v_account_id,
    'tenant_id', v_tenant_id,
    'recorded_at', now()
  );

  IF v_details_type = 'jsonb' THEN
    v_columns := array_append(v_columns, 'details');
    v_values := array_append(v_values, '$2::jsonb');
  ELSIF v_details_type = 'json' THEN
    v_columns := array_append(v_columns, 'details');
    v_values := array_append(v_values, '$2::json');
  ELSE
    v_columns := array_append(v_columns, 'details');
    v_values := array_append(v_values, '$2::text');
  END IF;

  IF v_has_timestamp THEN
    v_columns := array_append(v_columns, 'timestamp');
    IF v_timestamp_type IN ('bigint', 'integer', 'numeric') THEN
      v_values := array_append(v_values, '$3::bigint');
    ELSIF v_timestamp_type IN ('timestamp with time zone', 'timestamp without time zone') THEN
      v_values := array_append(v_values, 'now()');
    ELSE
      v_values := array_append(v_values, '$3::text');
    END IF;
  END IF;

  IF v_has_tenant_id THEN
    v_columns := array_append(v_columns, 'tenant_id');
    v_values := array_append(v_values, '$4');
  END IF;

  EXECUTE format(
    'INSERT INTO public.audit_logs (%s) VALUES (%s)',
    array_to_string(v_columns, ', '),
    array_to_string(v_values, ', ')
  )
  USING 'LOGIN_SUCCESS', v_details, (extract(epoch FROM now()) * 1000)::bigint::text, v_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'skipped', false
  );
EXCEPTION
  WHEN undefined_function THEN
    RETURN jsonb_build_object(
      'success', false,
      'skipped', true,
      'reason', 'required_context_function_missing'
    );
  WHEN undefined_column THEN
    RETURN jsonb_build_object(
      'success', false,
      'skipped', true,
      'reason', 'audit_logs_incompatible_columns'
    );
  WHEN datatype_mismatch THEN
    RETURN jsonb_build_object(
      'success', false,
      'skipped', true,
      'reason', 'audit_logs_incompatible_types'
    );
  WHEN others THEN
    RETURN jsonb_build_object(
      'success', false,
      'skipped', true,
      'reason', 'audit_logs_insert_failed'
    );
END;
$function$;

COMMENT ON FUNCTION public.record_login_session_v1() IS
  'Commercial Beta V1: optional safe login audit; never stores access_token, refresh_token, or full session objects.';

REVOKE ALL ON FUNCTION public.setup_groups_v2(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_login_session_v1() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.setup_groups_v2(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_login_session_v1() TO authenticated;
