-- migration_v5_2.sql

DO $$ 
BEGIN
  -- 1. Fix Relational Integrity
  -- Add FK for account_id.
  ALTER TABLE public.tournament_admins 
  ADD CONSTRAINT fk_tournament_admins_account 
  FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- TODO: Add FK for tournament_admins.tournament_id -> tournament.id once tournament.id type migration is completed.

-- 2. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_tournament_slug ON public.tournament(slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tournament_tenant_id ON public.tournament(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tournament_admins_account_id ON public.tournament_admins(account_id);
CREATE INDEX IF NOT EXISTS idx_tournament_admins_tournament_id ON public.tournament_admins(tournament_id);
CREATE INDEX IF NOT EXISTS idx_events_tournament_id ON public.events(tournament_id);
CREATE INDEX IF NOT EXISTS idx_teams_tournament_id ON public.teams(tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_tournament_id ON public.matches(tournament_id);

-- 3. RLS correction for tournament_admins
ALTER TABLE public.tournament_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all" ON public.tournament_admins;
DROP POLICY IF EXISTS "Tournament admins read policy" ON public.tournament_admins;
DROP POLICY IF EXISTS "SUPER_ADMIN full access to tournament_admins" ON public.tournament_admins;
DROP POLICY IF EXISTS "Owner access to own tournament_admins" ON public.tournament_admins;

CREATE POLICY "SUPER_ADMIN full access to tournament_admins" 
ON public.tournament_admins 
FOR ALL 
USING ( public.current_role_name() = 'SUPER_ADMIN' );

CREATE POLICY "Owner access to own tournament_admins"
ON public.tournament_admins
FOR SELECT
USING ( account_id = public.current_account_id() );

-- 4. Audit Triggers for tournament
CREATE OR REPLACE FUNCTION public.audit_tournament_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'CREATE_TOURNAMENT';
    INSERT INTO public.audit_logs (tenant_id, action, details, timestamp, created_at)
    VALUES (NEW.tenant_id, v_action, json_build_object('tournament_id', NEW.id, 'name', NEW.name)::text, to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), now());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      v_action := 'ARCHIVE_TOURNAMENT';
    ELSE
      v_action := 'UPDATE_TOURNAMENT';
    END IF;
    INSERT INTO public.audit_logs (tenant_id, action, details, timestamp, created_at)
    VALUES (NEW.tenant_id, v_action, json_build_object('tournament_id', NEW.id, 'name', NEW.name, 'slug', NEW.slug)::text, to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), now());
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_tournament ON public.tournament;
CREATE TRIGGER trg_audit_tournament
AFTER INSERT OR UPDATE ON public.tournament
FOR EACH ROW EXECUTE FUNCTION public.audit_tournament_changes();

-- 5. RPC create_tournament_workspace (improved)
CREATE OR REPLACE FUNCTION public.create_tournament_workspace(
    p_tenant_id uuid,
    p_tournament_name text,
    p_slug text,
    p_plan text,
    p_account_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_tournament_id text;
    v_slug_exists boolean;
    v_valid_account boolean;
BEGIN
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

    -- 2. Tenant Ownership Validation
    SELECT EXISTS (
        SELECT 1 FROM public.accounts 
        WHERE id = p_account_id AND tenant_id = p_tenant_id
    ) INTO v_valid_account;

    IF NOT v_valid_account THEN
        RETURN json_build_object('success', false, 'error', 'Invalid account or cross-tenant ownership is not allowed.');
    END IF;

    -- 3. Create Tournament
    v_tournament_id := 'tour_' || replace(gen_random_uuid()::text, '-', '');
    
    INSERT INTO public.tournament (
        id, name, tenant_id, slug, settings, created_at, updated_at
    ) VALUES (
        v_tournament_id, p_tournament_name, p_tenant_id, p_slug, jsonb_build_object('plan', p_plan), now(), now()
    );

    -- 4. Create tournament_admins record
    INSERT INTO public.tournament_admins (
        tournament_id, account_id, created_at
    ) VALUES (
        v_tournament_id, p_account_id, now()
    );

    -- Note: Audit is handled by trigger now.
    
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
$$;


-- 6. archive_tournament_workspace
CREATE OR REPLACE FUNCTION public.archive_tournament_workspace(
    p_tournament_id text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_tournament_record record;
BEGIN
    IF public.current_role_name() NOT IN ('SUPER_ADMIN', 'TENANT_ADMIN') THEN
        RETURN json_build_object('success', false, 'error', 'Access denied.');
    END IF;

    SELECT * INTO v_tournament_record FROM public.tournament WHERE id = p_tournament_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Tournament not found or already archived.');
    END IF;

    UPDATE public.tournament 
    SET deleted_at = now() 
    WHERE id = p_tournament_id;

    RETURN json_build_object('success', true, 'message', 'Workspace archived successfully.');
END;
$$;


-- 7. transfer_tournament_admin
CREATE OR REPLACE FUNCTION public.transfer_tournament_admin(
    p_tournament_id text,
    p_new_account_id uuid,
    p_tenant_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_valid_account boolean;
    v_exists boolean;
BEGIN
    IF public.current_role_name() NOT IN ('SUPER_ADMIN', 'TENANT_ADMIN') THEN
        RETURN json_build_object('success', false, 'error', 'Access denied.');
    END IF;

    -- Validate new account in same tenant
    SELECT EXISTS (
        SELECT 1 FROM public.accounts 
        WHERE id = p_new_account_id AND tenant_id = p_tenant_id
    ) INTO v_valid_account;

    IF NOT v_valid_account THEN
        RETURN json_build_object('success', false, 'error', 'Invalid account or cross-tenant transfer is not allowed.');
    END IF;

    -- Replace tournament admins (Assuming only 1 owner for now)
    DELETE FROM public.tournament_admins WHERE tournament_id = p_tournament_id;
    
    INSERT INTO public.tournament_admins (tournament_id, account_id, created_at)
    VALUES (p_tournament_id, p_new_account_id, now());

    -- Audit trail
    INSERT INTO public.audit_logs (tenant_id, action, details, timestamp, created_at)
    VALUES (p_tenant_id, 'TRANSFER_TOURNAMENT_ADMIN', json_build_object('tournament_id', p_tournament_id, 'new_account_id', p_new_account_id)::text, to_char(now(), 'HH24:MI:SS DD/MM/YYYY'), now());

    RETURN json_build_object('success', true, 'message', 'Ownership transferred successfully.');
END;
$$;

-- 8. get_tournament_workspace_dashboard
CREATE OR REPLACE FUNCTION public.get_tournament_workspace_dashboard(p_tenant_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_result json;
    v_role text;
    v_account_id uuid;
BEGIN
    v_role := public.current_role_name();
    v_account_id := public.current_account_id();

    IF v_role NOT IN ('SUPER_ADMIN', 'TENANT_ADMIN') THEN
        RETURN '[]'::json;
    END IF;

    -- Limit tenant scope
    WITH stats AS (
        SELECT 
            t.id AS tournament_id,
            t.name,
            t.slug,
            t.created_at,
            t.settings,
            (SELECT a.display_name 
             FROM public.tournament_admins ta 
             JOIN public.accounts a ON ta.account_id = a.id 
             WHERE ta.tournament_id = t.id LIMIT 1) AS owner_name,
            (SELECT count(id) FROM public.events ev WHERE ev.tournament_id = t.id AND ev.deleted_at IS NULL)::int AS events_count,
            (SELECT count(tm.id) FROM public.teams tm WHERE tm.tournament_id = t.id AND tm.deleted_at IS NULL)::int AS teams_count,
            (SELECT count(m.id) FROM public.matches m WHERE m.tournament_id = t.id AND m.deleted_at IS NULL)::int AS matches_count
        FROM public.tournament t
        WHERE (t.tenant_id = p_tenant_id OR p_tenant_id IS NULL)
          AND t.deleted_at IS NULL
        ORDER BY t.created_at DESC
    )
    SELECT coalesce(json_agg(row_to_json(stats)), '[]'::json) INTO v_result FROM stats;

    RETURN v_result;
END;
$$;
