-- migration_v5_4.sql

DO $$
BEGIN
    -- 1. Create Index for Dashboard performance
    CREATE INDEX IF NOT EXISTS idx_tournament_tenant_deleted_created 
    ON public.tournament(tenant_id, deleted_at, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_events_tournament_id_deleted 
    ON public.events(tournament_id) WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_teams_tournament_id_deleted 
    ON public.teams(tournament_id) WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_matches_tournament_id_deleted 
    ON public.matches(tournament_id) WHERE deleted_at IS NULL;
EXCEPTION
    WHEN others THEN null;
END $$;

-- 2. Create Tournament Workspace (V4) - Fixed TOCTOU Race Condition
CREATE OR REPLACE FUNCTION public.create_tournament_workspace_v4(
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
            id, name, tenant_id, slug, settings, created_at, updated_at
        ) VALUES (
            v_tournament_id, p_tournament_name, v_tenant_id, p_slug, jsonb_build_object('plan', p_plan), now(), now()
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

    -- Assign EVENT_ADMIN ownership via account_event_permissions
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

-- 3. Fast Aggregate Dashboard Query (V4) - Fixed Cartesian Product & Added Pagination
CREATE OR REPLACE FUNCTION public.get_tournament_workspace_dashboard_v4(
    p_page integer DEFAULT 1,
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
    v_offset integer;
BEGIN
    v_role := public.current_role_name();
    v_tenant_id := public.current_tenant_id();
    v_offset := (p_page - 1) * p_limit;

    IF v_role NOT IN ('SUPER_ADMIN', 'TENANT_ADMIN') THEN
        RETURN json_build_object('data', '[]'::json, 'total', 0, 'page', p_page, 'limit', p_limit);
    END IF;

    WITH base_query AS (
        SELECT 
            t.id, t.name, t.slug, t.created_at, t.settings, t.status, t.current_event_id
        FROM public.tournament t
        WHERE (t.tenant_id = v_tenant_id OR v_tenant_id IS NULL)
          AND t.deleted_at IS NULL
    ),
    counted AS (
        SELECT COUNT(1) AS total_count FROM base_query
    ),
    paged AS (
        SELECT b.id AS tournament_id, b.name, b.slug, b.created_at, b.settings, COALESCE(b.status, 'draft') as status,
            (SELECT COUNT(1) FROM public.events e WHERE e.tournament_id = b.id AND e.deleted_at IS NULL) as events_count,
            (SELECT COUNT(1) FROM public.teams tm WHERE tm.tournament_id = b.id AND tm.deleted_at IS NULL) as teams_count,
            (SELECT COUNT(1) FROM public.matches m WHERE m.tournament_id = b.id AND m.deleted_at IS NULL) as matches_count,
            (SELECT a.display_name 
             FROM public.account_event_permissions aep 
             JOIN public.accounts a ON a.id = aep.account_id 
             JOIN public.roles r ON a.role_id = r.id
             WHERE aep.event_id = b.current_event_id AND r.name IN ('TENANT_ADMIN', 'EVENT_ADMIN')
             ORDER BY aep.created_at ASC LIMIT 1) as owner_name
        FROM base_query b
        ORDER BY b.created_at DESC
        LIMIT p_limit OFFSET v_offset
    )
    SELECT json_build_object(
        'data', COALESCE(json_agg(row_to_json(paged)), '[]'::json),
        'total', COALESCE((SELECT total_count FROM counted), 0),
        'page', p_page,
        'limit', p_limit
    ) INTO v_result
    FROM paged;

    RETURN v_result;
END;
$func$;

-- 4. Transfer Owner (V4) - Fixed unsafe DELETE
CREATE OR REPLACE FUNCTION public.transfer_tournament_owner_v4(
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

    -- Find the event ID for the tournament
    SELECT current_event_id INTO v_event_id FROM public.tournament WHERE id = p_tournament_id AND tenant_id = v_tenant_id AND deleted_at IS NULL LIMIT 1;

    IF v_event_id IS NULL THEN
        SELECT id INTO v_event_id FROM public.events WHERE tournament_id = p_tournament_id AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1;
        IF v_event_id IS NULL THEN
           RETURN json_build_object('success', false, 'error', 'No active event found. Cannot assign owner.');
        END IF;
    END IF;

    -- Only remove existing TENANT_ADMIN or EVENT_ADMIN to preserve REFEREE, SCORE_ADMIN etc.
    DELETE FROM public.account_event_permissions aep
    USING public.accounts a, public.roles r
    WHERE aep.account_id = a.id
      AND a.role_id = r.id
      AND r.name IN ('TENANT_ADMIN', 'EVENT_ADMIN')
      AND aep.event_id = v_event_id;
    
    -- Assign new owner
    INSERT INTO public.account_event_permissions (id, account_id, event_id, created_at)
    VALUES (gen_random_uuid(), p_new_account_id, v_event_id, now())
    ON CONFLICT (account_id, event_id) DO NOTHING;

    -- Audit trail
    INSERT INTO public.audit_logs (tenant_id, action, details, timestamp, created_at)
    VALUES (v_tenant_id, 'TRANSFER_TOURNAMENT_OWNER', json_build_object('tournament_id', p_tournament_id, 'new_account_id', p_new_account_id, 'event_id', v_event_id)::text, to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), now());

    RETURN json_build_object('success', true, 'message', 'Ownership transferred successfully.');
END;
$func$;

-- 5. Cascade Archive Workspace (V4)
CREATE OR REPLACE FUNCTION public.archive_tournament_workspace_v4(
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
