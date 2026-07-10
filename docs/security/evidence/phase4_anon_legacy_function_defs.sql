-- archive_tournament_workspace_v6(text)
CREATE OR REPLACE FUNCTION public.archive_tournament_workspace_v6(p_tournament_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_tenant_id uuid;
    v_tournament_exists boolean;
BEGIN
    v_tenant_id := public.current_tenant_id();

    IF public.current_role_name() NOT IN ('SUPER_ADMIN', 'TENANT_ADMIN') THEN
        RETURN json_build_object('success', false, 'error', 'Access denied.');
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.tournament 
        WHERE id = p_tournament_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
    ) INTO v_tournament_exists;

    IF NOT v_tournament_exists THEN
        RETURN json_build_object('success', false, 'error', 'Tournament not found.');
    END IF;

    UPDATE public.tournament SET deleted_at = now() WHERE id = p_tournament_id;
    UPDATE public.events SET deleted_at = now() WHERE tournament_id = p_tournament_id;
    
    BEGIN
        EXECUTE 'UPDATE public.groups SET deleted_at = now() WHERE tournament_id = $1' USING p_tournament_id;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;

    UPDATE public.teams SET deleted_at = now() WHERE tournament_id = p_tournament_id;
    UPDATE public.matches SET deleted_at = now() WHERE tournament_id = p_tournament_id;

    -- Ensure we soft-delete permissions associated with archived events safely
    UPDATE public.account_event_permissions 
    SET deleted_at = now() 
    WHERE event_id IN (
        SELECT id FROM public.events WHERE tournament_id = p_tournament_id
    ) AND deleted_at IS NULL;

    INSERT INTO public.audit_logs (tenant_id, action, details, timestamp, created_at)
    VALUES (v_tenant_id, 'ARCHIVE_TOURNAMENT_WORKSPACE', json_build_object('tournament_id', p_tournament_id)::text, to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), now());

    RETURN json_build_object('success', true, 'message', 'Workspace archived successfully.');
END;
$function$


-- assign_team_to_group_v1(text,text,text)
CREATE OR REPLACE FUNCTION public.assign_team_to_group_v1(p_event_id text, p_team_id text, p_group_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_tenant_id uuid;
  v_event_tenant_id uuid;
  v_role_name text;
  v_source_group_id text;
  v_matches_deleted integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'p_event_id is required';
  END IF;

  IF p_team_id IS NULL OR btrim(p_team_id) = '' THEN
    RAISE EXCEPTION 'p_team_id is required';
  END IF;

  v_current_tenant_id := public.current_tenant_id();
  v_role_name := public.current_role_name();

  IF v_current_tenant_id IS NULL AND v_role_name <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Tenant context is required';
  END IF;

  SELECT e.tenant_id
    INTO v_event_tenant_id
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for current tenant';
  END IF;

  IF v_role_name <> 'SUPER_ADMIN' AND v_event_tenant_id <> v_current_tenant_id THEN
    RAISE EXCEPTION 'Event not found for current tenant';
  END IF;

  IF NOT (
    v_role_name = 'SUPER_ADMIN'
    OR v_role_name = 'TENANT_ADMIN'
    OR (
      public.has_permission('manage_groups')
      AND public.has_event_access(p_event_id)
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied for assign_team_to_group_v1';
  END IF;

  SELECT t.group_id
    INTO v_source_group_id
  FROM public.teams t
  WHERE t.id = p_team_id
    AND t.event_id = p_event_id
    AND t.tenant_id = v_event_tenant_id
    AND t.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found for current event';
  END IF;

  IF p_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.groups g
    WHERE g.id = p_group_id
      AND g.event_id = p_event_id
      AND g.tenant_id = v_event_tenant_id
  ) THEN
    RAISE EXCEPTION 'Group not found for current event';
  END IF;

  UPDATE public.teams
  SET group_id = p_group_id
  WHERE id = p_team_id
    AND event_id = p_event_id
    AND tenant_id = v_event_tenant_id
    AND deleted_at IS NULL;

  DELETE FROM public.matches
  WHERE event_id = p_event_id
    AND tenant_id = v_event_tenant_id
    AND COALESCE(group_id, '') <> 'knockout'
    AND (
      group_id = v_source_group_id
      OR group_id = p_group_id
    );
  GET DIAGNOSTICS v_matches_deleted = ROW_COUNT;

  UPDATE public.groups g
  SET team_ids = COALESCE((
    SELECT jsonb_agg(t.id ORDER BY lower(t.name), t.id)
    FROM public.teams t
    WHERE t.event_id = p_event_id
      AND t.tenant_id = v_event_tenant_id
      AND t.deleted_at IS NULL
      AND t.group_id = g.id
  ), '[]'::jsonb)
  WHERE g.event_id = p_event_id
    AND g.tenant_id = v_event_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'tenant_id', v_event_tenant_id,
    'team_id', p_team_id,
    'from_group_id', v_source_group_id,
    'to_group_id', p_group_id,
    'matches_deleted', v_matches_deleted
  );
END;
$function$


-- create_event_admin(uuid,text,text,text,text,text)
CREATE OR REPLACE FUNCTION public.create_event_admin(p_tenant_id uuid, p_event_name text, p_slug text, p_username text, p_password text, p_display_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_user_id uuid;
    v_account_id uuid;
    v_event_id text;
    v_event_admin_role_id uuid;
    v_public_url text;
    v_dashboard_url text;
BEGIN
    -- 0. Check Permissions (Must be SUPER_ADMIN or TENANT_ADMIN)
    IF public.current_role_name() NOT IN ('SUPER_ADMIN', 'TENANT_ADMIN') THEN
        RAISE EXCEPTION 'Access denied. Must be SUPER_ADMIN or TENANT_ADMIN.';
    END IF;

    -- Get Role ID for EVENT_ADMIN
    SELECT id INTO v_event_admin_role_id FROM public.roles WHERE name = 'EVENT_ADMIN' LIMIT 1;
    IF v_event_admin_role_id IS NULL THEN
        RAISE EXCEPTION 'Role EVENT_ADMIN not found';
    END IF;

    -- 1. Create auth.users
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, 
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', 
        p_username || '@pic.com', crypt(p_password, gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    );

    -- 2. Create Account
    v_account_id := gen_random_uuid();
    INSERT INTO public.accounts (
        id, user_id, tenant_id, role_id, username, display_name, status, created_at, updated_at
    ) VALUES (
        v_account_id, v_user_id, p_tenant_id, v_event_admin_role_id, p_username, p_display_name, 'active', now(), now()
    );

    -- 3. Create Event
    v_event_id := 'evt_' || replace(gen_random_uuid()::text, '-', '');
    
    INSERT INTO public.events (
        id, tenant_id, name, slug, status, settings, created_at
    ) VALUES (
        v_event_id, p_tenant_id, p_event_name, p_slug, 'draft', '{}'::jsonb, now()
    );

    -- 4. Insert account_event_permissions
    INSERT INTO public.account_event_permissions (
        id, account_id, event_id, created_at
    ) VALUES (
        gen_random_uuid(), v_account_id, v_event_id, now()
    );

    -- 5. Create Audit
    INSERT INTO public.audit_logs (
        tenant_id, action, details, timestamp, created_at
    ) VALUES (
        p_tenant_id, 'CREATE_EVENT_ADMIN', '{"account_id":"' || v_account_id || '", "event_id":"' || v_event_id || '"}', to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), now()
    );

    v_public_url := '/e/' || p_slug;
    v_dashboard_url := '/dashboard/event/' || v_event_id;

    RETURN json_build_object(
        'account_id', v_account_id,
        'event_id', v_event_id,
        'slug', p_slug,
        'public_url', v_public_url,
        'dashboard_url', v_dashboard_url
    );
EXCEPTION 
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to create event admin: %', SQLERRM;
END;
$function$


-- create_tournament_workspace_v6(text,text,text,uuid)
CREATE OR REPLACE FUNCTION public.create_tournament_workspace_v6(p_tournament_name text, p_slug text, p_plan text, p_account_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_tenant_id uuid;
    v_tournament_id text;
    v_event_id text;
    v_valid_account boolean;
BEGIN
    v_tenant_id := public.current_tenant_id();

    IF public.current_role_name() NOT IN ('SUPER_ADMIN', 'TENANT_ADMIN') THEN
        RETURN json_build_object('success', false, 'error', 'Access denied.');
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.accounts 
        WHERE id = p_account_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
    ) INTO v_valid_account;

    IF NOT v_valid_account THEN
        RETURN json_build_object('success', false, 'error', 'Invalid account.');
    END IF;

    v_tournament_id := 'tour_' || replace(gen_random_uuid()::text, '-', '');
    
    BEGIN
        INSERT INTO public.tournament (
            id, name, tenant_id, slug, settings, created_at, updated_at
        ) VALUES (
            v_tournament_id, p_tournament_name, v_tenant_id, p_slug, jsonb_build_object('plan', p_plan), now(), now()
        );
    EXCEPTION 
        WHEN unique_violation THEN
            RETURN json_build_object('success', false, 'error', 'Slug already exists. Please choose a different URL.');
    END;

    v_event_id := 'evt_' || replace(gen_random_uuid()::text, '-', '');
    
    INSERT INTO public.events (id, tenant_id, tournament_id, name, settings, created_at) 
    VALUES (v_event_id, v_tenant_id, v_tournament_id, 'Default Event', '{}'::jsonb, now());
    
    UPDATE public.tournament SET current_event_id = v_event_id WHERE id = v_tournament_id;

    -- Single Source of Truth for Ownership Assignment
    INSERT INTO public.account_event_permissions (id, account_id, event_id, created_at) 
    VALUES (gen_random_uuid(), p_account_id, v_event_id, now());

    INSERT INTO public.audit_logs (tenant_id, action, details, timestamp, created_at)
    VALUES (v_tenant_id, 'CREATE_TOURNAMENT_WORKSPACE', json_build_object('tournament_id', v_tournament_id, 'slug', p_slug, 'owner_account_id', p_account_id)::text, to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), now());

    RETURN json_build_object('success', true, 'tournament_id', v_tournament_id, 'slug', p_slug, 'url', '/tournament/' || p_slug);
END;
$function$


-- dissolve_groups_v2(text)
CREATE OR REPLACE FUNCTION public.dissolve_groups_v2(p_event_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_tenant_id uuid;
  v_event_tenant_id uuid;
  v_role_name text;
  v_groups_affected integer := 0;
  v_teams_affected integer := 0;
  v_matches_affected integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'p_event_id is required';
  END IF;

  v_current_tenant_id := public.current_tenant_id();
  v_role_name := public.current_role_name();

  IF v_current_tenant_id IS NULL AND v_role_name <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Tenant context is required';
  END IF;

  SELECT e.tenant_id
    INTO v_event_tenant_id
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for current tenant';
  END IF;

  IF v_role_name <> 'SUPER_ADMIN' AND v_event_tenant_id <> v_current_tenant_id THEN
    RAISE EXCEPTION 'Event not found for current tenant';
  END IF;

  IF NOT (
    v_role_name = 'SUPER_ADMIN'
    OR v_role_name = 'TENANT_ADMIN'
    OR (
      public.has_permission('manage_groups')
      AND public.has_event_access(p_event_id)
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied for dissolve_groups_v2';
  END IF;

  UPDATE public.teams
  SET group_id = NULL
  WHERE event_id = p_event_id
    AND tenant_id = v_event_tenant_id;
  GET DIAGNOSTICS v_teams_affected = ROW_COUNT;

  UPDATE public.groups
  SET deleted_at = now()
  WHERE event_id = p_event_id
    AND tenant_id = v_event_tenant_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_groups_affected = ROW_COUNT;

  UPDATE public.matches
  SET deleted_at = now()
  WHERE event_id = p_event_id
    AND tenant_id = v_event_tenant_id
    AND deleted_at IS NULL
    AND COALESCE(group_id, '') <> 'knockout';
  GET DIAGNOSTICS v_matches_affected = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'tenant_id', v_event_tenant_id,
    'teams_cleared', v_teams_affected,
    'groups_dissolved', v_groups_affected,
    'matches_soft_deleted', v_matches_affected
  );
END;
$function$


-- setup_groups_v2(text,integer)
CREATE OR REPLACE FUNCTION public.setup_groups_v2(p_event_id text, p_num_groups integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_tenant_id uuid;
  v_event_tenant_id uuid;
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

  v_current_tenant_id := public.current_tenant_id();
  v_role_name := public.current_role_name();

  IF v_current_tenant_id IS NULL AND v_role_name <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Tenant context is required';
  END IF;

  SELECT e.tenant_id, e.tournament_id
    INTO v_event_tenant_id, v_event_tournament_id
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for current tenant';
  END IF;

  IF v_role_name <> 'SUPER_ADMIN' AND v_event_tenant_id <> v_current_tenant_id THEN
    RAISE EXCEPTION 'Event not found for current tenant';
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

  DELETE FROM public.matches
  WHERE event_id = p_event_id
    AND tenant_id = v_event_tenant_id
    AND COALESCE(group_id, '') <> 'knockout';

  UPDATE public.teams
  SET group_id = NULL
  WHERE event_id = p_event_id
    AND tenant_id = v_event_tenant_id;

  DELETE FROM public.groups
  WHERE event_id = p_event_id
    AND tenant_id = v_event_tenant_id;

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
      v_event_tenant_id,
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
$function$


-- setup_groups_v3(text,integer,text)
CREATE OR REPLACE FUNCTION public.setup_groups_v3(p_event_id text, p_num_groups integer, p_mode text DEFAULT 'empty'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_tenant_id uuid;
  v_event_tenant_id uuid;
  v_role_name text;
  v_event_tournament_id text;
  v_group_ids text[] := ARRAY[]::text[];
  v_group_id text;
  v_group_name text;
  v_index integer;
  v_letter_index integer;
  v_letter_name text;
  v_mode text;
  v_seed text;
  v_team record;
  v_team_index integer := 0;
  v_assigned_count integer := 0;
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

  v_mode := lower(btrim(coalesce(p_mode, 'empty')));
  IF v_mode NOT IN ('empty', 'seed', 'random') THEN
    RAISE EXCEPTION 'p_mode must be empty, seed, or random';
  END IF;

  v_current_tenant_id := public.current_tenant_id();
  v_role_name := public.current_role_name();

  IF v_current_tenant_id IS NULL AND v_role_name <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Tenant context is required';
  END IF;

  SELECT e.tenant_id, e.tournament_id
    INTO v_event_tenant_id, v_event_tournament_id
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for current tenant';
  END IF;

  IF v_role_name <> 'SUPER_ADMIN' AND v_event_tenant_id <> v_current_tenant_id THEN
    RAISE EXCEPTION 'Event not found for current tenant';
  END IF;

  IF NOT (
    v_role_name = 'SUPER_ADMIN'
    OR v_role_name = 'TENANT_ADMIN'
    OR (
      public.has_permission('manage_groups')
      AND public.has_event_access(p_event_id)
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied for setup_groups_v3';
  END IF;

  DELETE FROM public.matches
  WHERE event_id = p_event_id
    AND tenant_id = v_event_tenant_id
    AND COALESCE(group_id, '') <> 'knockout';

  UPDATE public.teams
  SET group_id = NULL
  WHERE event_id = p_event_id
    AND tenant_id = v_event_tenant_id
    AND deleted_at IS NULL;

  DELETE FROM public.groups
  WHERE event_id = p_event_id
    AND tenant_id = v_event_tenant_id;

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
      v_event_tenant_id,
      v_event_tournament_id
    );

    v_group_ids := array_append(v_group_ids, v_group_id);
  END LOOP;

  IF v_mode = 'random' THEN
    v_team_index := 0;

    FOR v_team IN
      SELECT id
      FROM public.teams
      WHERE event_id = p_event_id
        AND tenant_id = v_event_tenant_id
        AND deleted_at IS NULL
      ORDER BY random()
    LOOP
      UPDATE public.teams
      SET group_id = v_group_ids[(v_team_index % p_num_groups) + 1]
      WHERE id = v_team.id
        AND event_id = p_event_id
        AND tenant_id = v_event_tenant_id
        AND deleted_at IS NULL;

      v_team_index := v_team_index + 1;
      v_assigned_count := v_assigned_count + 1;
    END LOOP;
  ELSIF v_mode = 'seed' THEN
    FOREACH v_seed IN ARRAY ARRAY['1', '2', '3', '4', 'none'] LOOP
      v_team_index := 0;

      FOR v_team IN
        SELECT id
        FROM public.teams
        WHERE event_id = p_event_id
          AND tenant_id = v_event_tenant_id
          AND deleted_at IS NULL
          AND COALESCE(NULLIF(seed, ''), 'none') = v_seed
        ORDER BY lower(name), id
      LOOP
        UPDATE public.teams
        SET group_id = v_group_ids[(v_team_index % p_num_groups) + 1]
        WHERE id = v_team.id
          AND event_id = p_event_id
          AND tenant_id = v_event_tenant_id
          AND deleted_at IS NULL;

        v_team_index := v_team_index + 1;
        v_assigned_count := v_assigned_count + 1;
      END LOOP;
    END LOOP;
  END IF;

  UPDATE public.groups g
  SET team_ids = COALESCE((
    SELECT jsonb_agg(t.id ORDER BY lower(t.name), t.id)
    FROM public.teams t
    WHERE t.event_id = p_event_id
      AND t.tenant_id = v_event_tenant_id
      AND t.deleted_at IS NULL
      AND t.group_id = g.id
  ), '[]'::jsonb)
  WHERE g.event_id = p_event_id
    AND g.tenant_id = v_event_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'tenant_id', v_event_tenant_id,
    'num_groups', p_num_groups,
    'mode', v_mode,
    'group_ids', to_jsonb(v_group_ids),
    'assigned_teams', v_assigned_count
  );
END;
$function$


-- transfer_tournament_owner_v6(text,uuid)
CREATE OR REPLACE FUNCTION public.transfer_tournament_owner_v6(p_tournament_id text, p_new_account_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_tenant_id uuid;
    v_event_id text;
    v_valid_account boolean;
    v_current_owner_json json;
    v_current_owner_id uuid;
BEGIN
    v_tenant_id := public.current_tenant_id();

    IF public.current_role_name() NOT IN ('SUPER_ADMIN', 'TENANT_ADMIN') THEN
        RETURN json_build_object('success', false, 'error', 'Access denied.');
    END IF;

    -- Find the event ID for the tournament
    SELECT current_event_id INTO v_event_id FROM public.tournament WHERE id = p_tournament_id AND tenant_id = v_tenant_id AND deleted_at IS NULL LIMIT 1;

    IF v_event_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'No active tournament or event found. Cannot transfer ownership.');
    END IF;

    -- Validate new account in same tenant
    SELECT EXISTS (
        SELECT 1 FROM public.accounts 
        WHERE id = p_new_account_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
    ) INTO v_valid_account;

    IF NOT v_valid_account THEN
        RETURN json_build_object('success', false, 'error', 'Invalid account or cross-tenant transfer is not allowed.');
    END IF;

    -- Resolve Current Owner using the Owner Resolution Layer
    v_current_owner_json := public.get_tournament_owner(v_event_id);
    v_current_owner_id := (v_current_owner_json->>'account_id')::uuid;

    IF v_current_owner_id = p_new_account_id THEN
        RETURN json_build_object('success', true, 'message', 'User is already the owner.');
    END IF;

    IF v_current_owner_id IS NOT NULL THEN
        -- Only transfer the EVENT_ADMIN/TENANT_ADMIN ownership record.
        -- REFEREE, SCOREKEEPER, and other assignments for other people remain untouched.
        BEGIN
            UPDATE public.account_event_permissions
            SET account_id = p_new_account_id
            WHERE account_id = v_current_owner_id 
              AND event_id = v_event_id 
              AND deleted_at IS NULL;
        EXCEPTION WHEN unique_violation THEN
            -- In case the new owner already has a permission for this event but maybe a different role
            -- Just hard-delete the old owner's admin perm if there's a conflict, the new guy is already admin.
            UPDATE public.account_event_permissions SET deleted_at = now() WHERE account_id = v_current_owner_id AND event_id = v_event_id;
        END;
    ELSE
        -- If no current owner found but we need to assign one:
        INSERT INTO public.account_event_permissions (id, account_id, event_id, created_at)
        VALUES (gen_random_uuid(), p_new_account_id, v_event_id, now())
        ON CONFLICT (account_id, event_id) DO NOTHING;
    END IF;

    -- Audit trail
    INSERT INTO public.audit_logs (tenant_id, action, details, timestamp, created_at)
    VALUES (v_tenant_id, 'TRANSFER_TOURNAMENT_OWNER', json_build_object('tournament_id', p_tournament_id, 'new_account_id', p_new_account_id, 'old_account_id', v_current_owner_id)::text, to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), now());

    RETURN json_build_object('success', true, 'message', 'Ownership transferred successfully.');
END;
$function$
