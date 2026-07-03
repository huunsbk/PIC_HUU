-- migration_v5_3.sql

DO $$
BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_slug_unique_v3
    ON public.tournament(slug)
    WHERE deleted_at IS NULL;
EXCEPTION
    WHEN others THEN null;
END $$;

-- 1. Create Tournament Workspace (V3)
CREATE OR REPLACE FUNCTION public.create_tournament_workspace_v3(
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
    v_slug_exists boolean;
    v_valid_account boolean;
BEGIN
    v_tenant_id := public.current_tenant_id();

    -- 0. Check Permissions
    IF public.current_role_name() NOT IN ('SUPER_ADMIN', 'TENANT_ADMIN') THEN
        RETURN json_build_object('success', false, 'error', 'Access denied. Must be SUPER_ADMIN or TENANT_ADMIN.');
    END IF;

    -- 1. Slug Validation
    SELECT EXISTS (
        SELECT 1 FROM public.tournament 
        WHERE slug = p_slug AND deleted_at IS NULL
    ) INTO v_slug_exists;
    
    IF v_slug_exists THEN
        RETURN json_build_object('success', false, 'error', 'Slug already exists. Please choose a different URL.');
    END IF;

    -- 2. Validate Account belongs to current Tenant
    SELECT EXISTS (
        SELECT 1 FROM public.accounts 
        WHERE id = p_account_id AND tenant_id = v_tenant_id
    ) INTO v_valid_account;

    IF NOT v_valid_account THEN
        RETURN json_build_object('success', false, 'error', 'Invalid account or cross-tenant ownership is not allowed.');
    END IF;

    -- 3. Create Tournament
    v_tournament_id := 'tour_' || replace(gen_random_uuid()::text, '-', '');
    
    INSERT INTO public.tournament (
        id, name, tenant_id, slug, settings, created_at, updated_at
    ) VALUES (
        v_tournament_id, p_tournament_name, v_tenant_id, p_slug, jsonb_build_object('plan', p_plan), now(), now()
    );

    -- 4. Create Default Event
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

    -- 5. Assign EVENT_ADMIN ownership via account_event_permissions
    INSERT INTO public.account_event_permissions (
        id, account_id, event_id, created_at
    ) VALUES (
        gen_random_uuid(), p_account_id, v_event_id, now()
    );

    -- 6. Audit Trail
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

-- 2. Cascade Archive Workspace (V3)
CREATE OR REPLACE FUNCTION public.archive_tournament_workspace_v3(
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

    -- Validate tournament belongs to tenant and is not already deleted
    SELECT EXISTS (
        SELECT 1 FROM public.tournament 
        WHERE id = p_tournament_id AND tenant_id = v_tenant_id AND deleted_at IS NULL
    ) INTO v_tournament_exists;

    IF NOT v_tournament_exists THEN
        RETURN json_build_object('success', false, 'error', 'Tournament not found or already archived.');
    END IF;

    -- Update Tournament
    UPDATE public.tournament SET deleted_at = now() WHERE id = p_tournament_id;
    
    -- Cascading updates
    UPDATE public.events SET deleted_at = now() WHERE tournament_id = p_tournament_id;
    
    -- Ensure "groups" table exists or just skip it if it throws (Wait, the specs mention updating groups)
    BEGIN
        EXECUTE 'UPDATE public.groups SET deleted_at = now() WHERE tournament_id = $1' USING p_tournament_id;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;

    UPDATE public.teams SET deleted_at = now() WHERE tournament_id = p_tournament_id;
    UPDATE public.matches SET deleted_at = now() WHERE tournament_id = p_tournament_id;

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


-- 3. Transfer Owner (V3) using account_event_permissions
CREATE OR REPLACE FUNCTION public.transfer_tournament_owner_v3(
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
    v_event_id text;
BEGIN
    v_tenant_id := public.current_tenant_id();

    IF public.current_role_name() NOT IN ('SUPER_ADMIN', 'TENANT_ADMIN') THEN
        RETURN json_build_object('success', false, 'error', 'Access denied.');
    END IF;

    -- Validate new account in same tenant
    SELECT EXISTS (
        SELECT 1 FROM public.accounts 
        WHERE id = p_new_account_id AND tenant_id = v_tenant_id
    ) INTO v_valid_account;

    IF NOT v_valid_account THEN
        RETURN json_build_object('success', false, 'error', 'Invalid account or cross-tenant transfer is not allowed.');
    END IF;

    -- Find the default event ID for the tournament
    SELECT current_event_id INTO v_event_id FROM public.tournament WHERE id = p_tournament_id AND tenant_id = v_tenant_id AND deleted_at IS NULL LIMIT 1;

    IF v_event_id IS NULL THEN
        -- Fallback: select the first active event
        SELECT id INTO v_event_id FROM public.events WHERE tournament_id = p_tournament_id AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1;
        IF v_event_id IS NULL THEN
           RETURN json_build_object('success', false, 'error', 'No active event found. Cannot assign owner.');
        END IF;
    END IF;

    -- Clear existing owners for this Default Event
    DELETE FROM public.account_event_permissions WHERE event_id = v_event_id;
    
    -- Assign new owner
    INSERT INTO public.account_event_permissions (id, account_id, event_id, created_at)
    VALUES (gen_random_uuid(), p_new_account_id, v_event_id, now());

    -- Audit trail
    INSERT INTO public.audit_logs (tenant_id, action, details, timestamp, created_at)
    VALUES (v_tenant_id, 'TRANSFER_TOURNAMENT_OWNER', json_build_object('tournament_id', p_tournament_id, 'new_account_id', p_new_account_id, 'event_id', v_event_id)::text, to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), now());

    RETURN json_build_object('success', true, 'message', 'Ownership transferred successfully.');
END;
$func$;


-- 4. Fast Aggregate Dashboard Query (V3)
CREATE OR REPLACE FUNCTION public.get_tournament_workspace_dashboard_v3()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE
    v_result json;
    v_role text;
    v_tenant_id uuid;
BEGIN
    v_role := public.current_role_name();
    v_tenant_id := public.current_tenant_id();

    IF v_role NOT IN ('SUPER_ADMIN', 'TENANT_ADMIN') THEN
        RETURN '[]'::json;
    END IF;

    -- Single huge query using Left Joins to compute aggregations and extract owner.
    -- Assuming owner is assigned to the current_event_id or first event.
    WITH stats AS (
        SELECT 
            t.id AS tournament_id,
            t.name,
            t.slug,
            t.created_at,
            t.settings,
            COALESCE(t.status, 'draft') as status,
            MAX(a.display_name) AS owner_name,  -- Derived from account_event_permissions of current_event_id
            COUNT(DISTINCT ev.id) AS events_count,
            COUNT(DISTINCT tm.id) AS teams_count,
            COUNT(DISTINCT m.id) AS matches_count
        FROM public.tournament t
        LEFT JOIN public.events ev ON ev.tournament_id = t.id AND ev.deleted_at IS NULL
        LEFT JOIN public.teams tm ON tm.tournament_id = t.id AND tm.deleted_at IS NULL
        LEFT JOIN public.matches m ON m.tournament_id = t.id AND m.deleted_at IS NULL
        -- To get owner, link to event permissions via the tournament's current event
        LEFT JOIN public.account_event_permissions aep ON aep.event_id = t.current_event_id
        LEFT JOIN public.accounts a ON a.id = aep.account_id
        WHERE (t.tenant_id = v_tenant_id OR v_tenant_id IS NULL)
          AND t.deleted_at IS NULL
        GROUP BY t.id, t.name, t.slug, t.created_at, t.settings, t.status
        ORDER BY t.created_at DESC
    )
    SELECT coalesce(json_agg(row_to_json(stats)), '[]'::json) INTO v_result FROM stats;

    RETURN v_result;
END;
$func$;
