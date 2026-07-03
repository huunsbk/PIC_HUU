-- migration_v5_5.sql

DO $$
BEGIN
    -- 1. Redesign Owner Model: Add owner_account_id to tournament
    ALTER TABLE public.tournament 
    ADD COLUMN IF NOT EXISTS owner_account_id UUID REFERENCES public.accounts(id);
    
    -- Add deleted_at to account_event_permissions if it doesn't exist
    ALTER TABLE public.account_event_permissions
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

    -- 2. Optimize Index for Dashboard
    CREATE INDEX IF NOT EXISTS idx_tournament_dashboard_v5 
    ON public.tournament(tenant_id, created_at DESC) 
    WHERE deleted_at IS NULL;
EXCEPTION
    WHEN others THEN null;
END $$;

-- 3. Create Tournament Workspace (V5)
CREATE OR REPLACE FUNCTION public.create_tournament_workspace_v5(
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

    -- Check Permissions
    IF public.current_role_name() NOT IN ('SUPER_ADMIN', 'TENANT_ADMIN') THEN
        RETURN json_build_object('success', false, 'error', 'Access denied. Must be SUPER_ADMIN or TENANT_ADMIN.');
    END IF;

    -- Validate Account belongs to current Tenant
    SELECT EXISTS (
        SELECT 1 FROM public.accounts 
        WHERE id = p_account_id AND tenant_id = v_tenant_id
    ) INTO v_valid_account;

    IF NOT v_valid_account THEN
        RETURN json_build_object('success', false, 'error', 'Invalid account or cross-tenant ownership is not allowed.');
    END IF;

    v_tournament_id := 'tour_' || replace(gen_random_uuid()::text, '-', '');
    
    -- Insert directly to rely on UNIQUE INDEX to avoid TOCTOU Race Condition
    BEGIN
        INSERT INTO public.tournament (
            id, name, tenant_id, slug, settings, owner_account_id, created_at, updated_at
        ) VALUES (
            v_tournament_id, p_tournament_name, v_tenant_id, p_slug, jsonb_build_object('plan', p_plan), p_account_id, now(), now()
        );
    EXCEPTION 
        WHEN unique_violation THEN
            RETURN json_build_object('success', false, 'error', 'Slug already exists. Please choose a different URL.');
    END;

    -- Create Default Event
    v_event_id := 'evt_' || replace(gen_random_uuid()::text, '-', '');
    
    INSERT INTO public.events (
        id, tenant_id, tournament_id, name, settings, created_at
    ) VALUES (
        v_event_id, v_tenant_id, v_tournament_id, 'Default Event', '{}'::jsonb, now()
    );
    
    -- Link event as current_event_id
    UPDATE public.tournament
    SET current_event_id = v_event_id
    WHERE id = v_tournament_id;

    -- We NO LONGER assign ownership via account_event_permissions here to avoid duplicate source of truth,
    -- but if the system relies on it for EVENT permissions, we could, but ownership is strictly tournament.owner_account_id.
    -- Assuming they still need EVENT_ADMIN access to the default event to manage things inside the event.
    INSERT INTO public.account_event_permissions (
        id, account_id, event_id, created_at
    ) VALUES (
        gen_random_uuid(), p_account_id, v_event_id, now()
    );

    -- Audit Trail
    INSERT INTO public.audit_logs (tenant_id, action, details, timestamp, created_at)
    VALUES (
        v_tenant_id, 
        'CREATE_TOURNAMENT_WORKSPACE', 
        json_build_object('tournament_id', v_tournament_id, 'slug', p_slug, 'owner_account_id', p_account_id)::text, 
        to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), 
        now()
    );

    RETURN json_build_object(
        'success', true,
        'tournament_id', v_tournament_id,
        'slug', p_slug,
        'url', '/tournament/' || p_slug
    );
EXCEPTION 
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', 'Failed to create workspace: ' || SQLERRM);
END;
$func$;

-- 4. Fast Aggregate Dashboard Query (V5) - Cursor Pagination
CREATE OR REPLACE FUNCTION public.get_tournament_workspace_dashboard_v5(
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
            t.id, t.name, t.slug, t.created_at, t.settings, t.status, t.owner_account_id
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
            a.display_name as owner_name,
            b.owner_account_id
        FROM sliced b
        LEFT JOIN public.accounts a ON a.id = b.owner_account_id
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

-- 5. Transfer Owner (V5) - Only update owner_account_id
CREATE OR REPLACE FUNCTION public.transfer_tournament_owner_v5(
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
    v_valid_account boolean;
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

    -- Validate new account in same tenant
    SELECT EXISTS (
        SELECT 1 FROM public.accounts 
        WHERE id = p_new_account_id AND tenant_id = v_tenant_id
    ) INTO v_valid_account;

    IF NOT v_valid_account THEN
        RETURN json_build_object('success', false, 'error', 'Invalid account or cross-tenant transfer is not allowed.');
    END IF;

    -- Update strictly ownership metadata
    UPDATE public.tournament 
    SET owner_account_id = p_new_account_id 
    WHERE id = p_tournament_id AND tenant_id = v_tenant_id;

    -- Audit trail
    INSERT INTO public.audit_logs (tenant_id, action, details, timestamp, created_at)
    VALUES (v_tenant_id, 'TRANSFER_TOURNAMENT_OWNER', json_build_object('tournament_id', p_tournament_id, 'new_account_id', p_new_account_id)::text, to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), now());

    RETURN json_build_object('success', true, 'message', 'Ownership transferred successfully.');
END;
$func$;

-- 6. Cascade Archive Workspace (V5) - Include account_event_permissions
CREATE OR REPLACE FUNCTION public.archive_tournament_workspace_v5(
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
        RETURN json_build_object('success', false, 'error', 'Tournament not found or already archived.');
    END IF;

    -- Cascade Soft Delete Updates
    UPDATE public.tournament SET deleted_at = now() WHERE id = p_tournament_id;
    UPDATE public.events SET deleted_at = now() WHERE tournament_id = p_tournament_id;
    
    BEGIN
        EXECUTE 'UPDATE public.groups SET deleted_at = now() WHERE tournament_id = $1' USING p_tournament_id;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;

    UPDATE public.teams SET deleted_at = now() WHERE tournament_id = p_tournament_id;
    UPDATE public.matches SET deleted_at = now() WHERE tournament_id = p_tournament_id;

    -- Soft delete event permissions linked to this tournament
    UPDATE public.account_event_permissions 
    SET deleted_at = now() 
    WHERE event_id IN (
        SELECT id FROM public.events WHERE tournament_id = p_tournament_id
    );

    -- Audit Trail
    INSERT INTO public.audit_logs (tenant_id, action, details, timestamp, created_at)
    VALUES (
        v_tenant_id, 
        'ARCHIVE_TOURNAMENT_WORKSPACE', 
        json_build_object('tournament_id', p_tournament_id)::text, 
        to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), 
        now()
    );

    RETURN json_build_object('success', true, 'message', 'Workspace archived successfully.');
END;
$func$;
