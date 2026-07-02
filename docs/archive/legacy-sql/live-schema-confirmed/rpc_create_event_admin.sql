-- rpc_create_event_admin.sql
CREATE OR REPLACE FUNCTION public.create_event_admin(
    p_tenant_id uuid,
    p_event_name text,
    p_slug text,
    p_username text,
    p_password text,
    p_display_name text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
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
$$;
