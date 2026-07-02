-- migration_v5_6.sql

DO $$
BEGIN
    -- CRITICAL RULE #1: Remove Duplicate Source of Truth
    ALTER TABLE public.tournament DROP COLUMN IF EXISTS owner_account_id;
EXCEPTION
    WHEN others THEN null;
END $$;

-- CRITICAL RULE #3: Create Owner Resolution Layer
CREATE OR REPLACE FUNCTION public.get_tournament_owner(p_event_id text)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
    -- Resolve ownership via EVENT_ADMIN / TENANT_ADMIN role linked to the current event.
    -- Safely filters out deleted permissions or accounts.
    SELECT json_build_object(
        'account_id', a.id,
        'display_name', a.display_name
    )
    FROM public.account_event_permissions aep
    JOIN public.accounts a ON a.id = aep.account_id AND a.deleted_at IS NULL
    JOIN public.roles r ON a.role_id = r.id
    WHERE aep.event_id = p_event_id
      AND aep.deleted_at IS NULL
      AND r.name IN ('EVENT_ADMIN', 'TENANT_ADMIN')
    ORDER BY aep.created_at ASC
    LIMIT 1;
$func$;

-- CRITICAL RULE #4: Rewrite transfer_tournament_owner
CREATE OR REPLACE FUNCTION public.transfer_tournament_owner_v6(
    p_tournament_id text,
    p_new_account_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
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
$func$;

-- CRITICAL RULE #5: Dashboard Must Use Owner Resolver
CREATE OR REPLACE FUNCTION public.get_tournament_workspace_dashboard_v6(
    p_cursor timestamptz DEFAULT NULL,
    p_limit integer DEFAULT 50
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE
    v_result json;
    v_role text;
    v_tenant_id uuid;
    v_has_more boolean := false;
    v_next_cursor timestamptz;
BEGIN
    v_role := public.current_role_name();
    v_tenant_id := public.current_tenant_id();

    IF v_role NOT IN ('SUPER_ADMIN', 'TENANT_ADMIN') THEN
        RETURN json_build_object('data', '[]'::json, 'next_cursor', NULL, 'has_more', false);
    END IF;

    WITH base_query AS (
        SELECT 
            t.id, t.name, t.slug, t.created_at, t.settings, t.status, t.current_event_id
        FROM public.tournament t
        WHERE (t.tenant_id = v_tenant_id OR v_tenant_id IS NULL)
          AND t.deleted_at IS NULL
          AND (p_cursor IS NULL OR t.created_at < p_cursor)
        ORDER BY t.created_at DESC
        LIMIT p_limit + 1
    ),
    sliced AS (
        SELECT * FROM base_query LIMIT p_limit
    ),
    enriched AS (
        SELECT b.id AS tournament_id, b.name, b.slug, b.created_at, b.settings, COALESCE(b.status, 'draft') as status,
            (SELECT COUNT(1) FROM public.events e WHERE e.tournament_id = b.id AND e.deleted_at IS NULL) as events_count,
            (SELECT COUNT(1) FROM public.teams tm WHERE tm.tournament_id = b.id AND tm.deleted_at IS NULL) as teams_count,
            (SELECT COUNT(1) FROM public.matches m WHERE m.tournament_id = b.id AND m.deleted_at IS NULL) as matches_count,
            (public.get_tournament_owner(b.current_event_id)->>'display_name') as owner_name,
            (public.get_tournament_owner(b.current_event_id)->>'account_id') as owner_account_id
        FROM sliced b
        ORDER BY b.created_at DESC
    )
    SELECT 
        (SELECT COUNT(1) > p_limit FROM base_query),
        (SELECT created_at FROM sliced ORDER BY created_at ASC LIMIT 1)
    INTO v_has_more, v_next_cursor;

    SELECT json_build_object(
        'data', COALESCE(json_agg(row_to_json(enriched)), '[]'::json),
        'next_cursor', CASE WHEN v_has_more THEN v_next_cursor ELSE NULL END,
        'has_more', v_has_more
    ) INTO v_result
    FROM enriched;

    RETURN v_result;
END;
$func$;

-- Create Tournament Workspace (V6) relies purely on Single Source of Truth
CREATE OR REPLACE FUNCTION public.create_tournament_workspace_v6(
    p_tournament_name text,
    p_slug text,
    p_plan text,
    p_account_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
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
$func$;

-- CRITICAL RULE #6: Verify RLS Compatibility & Archive behavior
CREATE OR REPLACE FUNCTION public.archive_tournament_workspace_v6(
    p_tournament_id text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
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
$func$;
