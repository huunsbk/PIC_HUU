-- Provision exactly one tournament for an activated self-service customer.
-- Self-service EVENT_ADMIN accounts can enter and edit basic metadata for that
-- tournament, but cannot create, archive or restore tournaments themselves.

BEGIN;

DROP TRIGGER IF EXISTS trg_self_service_owner_capabilities_v1
  ON public.self_service_customer_profiles;
DROP FUNCTION IF EXISTS public.grant_self_service_owner_capabilities_v1();

DELETE FROM public.account_permissions ap
USING public.self_service_customer_profiles sscp, public.permissions p
WHERE ap.account_id = sscp.account_id
  AND ap.permission_id = p.id
  AND p.name = 'manage_tournaments';

CREATE OR REPLACE FUNCTION public.provision_self_service_workspace_v1(
  p_tenant_id uuid,
  p_account_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_owner record;
  v_workspace public.tournament%ROWTYPE;
  v_created boolean := false;
  v_slug text;
BEGIN
  IF p_tenant_id IS NULL OR p_account_id IS NULL THEN
    RAISE EXCEPTION 'SELF_SERVICE_CONTEXT_REQUIRED';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':self-service-workspace', 0)
  );

  SELECT
    a.id AS account_id,
    a.display_name,
    a.status AS account_status,
    r.name AS role_name,
    t.id AS tenant_id,
    t.name AS tenant_name,
    t.slug AS tenant_slug,
    t.status AS tenant_status,
    t.tenant_type,
    sscp.onboarding_status
  INTO v_owner
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  JOIN public.tenants t ON t.id = a.tenant_id
  JOIN public.self_service_customer_profiles sscp
    ON sscp.account_id = a.id
   AND sscp.tenant_id = t.id
  WHERE a.id = p_account_id
    AND a.tenant_id = p_tenant_id
    AND a.deleted_at IS NULL
    AND t.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND
     OR v_owner.account_status <> 'active'
     OR COALESCE(v_owner.tenant_status, 'active') <> 'active'
     OR v_owner.tenant_type <> 'self_service_customer'
     OR v_owner.role_name <> 'EVENT_ADMIN'
     OR v_owner.onboarding_status <> 'ready'
  THEN
    RAISE EXCEPTION 'SELF_SERVICE_OWNER_NOT_READY';
  END IF;

  PERFORM public.ensure_business_access_v1(p_tenant_id);

  SELECT *
  INTO v_workspace
  FROM public.tournament t
  WHERE t.tenant_id = p_tenant_id
    AND t.deleted_at IS NULL
    AND COALESCE(t.status, 'active') <> 'archived'
  ORDER BY t.created_at, t.id
  LIMIT 1;

  IF v_workspace.id IS NULL THEN
    v_slug := 'giai-' || replace(p_tenant_id::text, '-', '');

    INSERT INTO public.tournament(
      id,
      tenant_id,
      name,
      slug,
      location,
      start_date,
      date,
      status,
      settings
    )
    VALUES (
      'tournament-' || gen_random_uuid()::text,
      p_tenant_id,
      left('Giải đấu của ' || COALESCE(NULLIF(btrim(v_owner.display_name), ''), v_owner.tenant_name), 150),
      v_slug,
      NULL,
      NULL,
      '',
      'active',
      '{}'::jsonb
    )
    RETURNING * INTO v_workspace;

    v_created := true;

    INSERT INTO public.audit_logs(
      timestamp,
      action,
      details,
      tenant_id,
      actor_account_id,
      actor_role,
      category,
      entity_type,
      entity_id,
      result,
      details_json
    )
    VALUES (
      now()::text,
      'SELF_SERVICE_WORKSPACE_PROVISIONED',
      jsonb_build_object(
        'tournament_id', v_workspace.id,
        'slug', v_workspace.slug,
        'source', 'subscription_activation'
      )::text,
      p_tenant_id,
      p_account_id,
      'EVENT_ADMIN',
      'commercial',
      'tournament',
      v_workspace.id,
      'allow',
      jsonb_build_object(
        'tournament_id', v_workspace.id,
        'slug', v_workspace.slug,
        'source', 'subscription_activation'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'created', v_created,
    'workspace', jsonb_build_object(
      'tournament_id', v_workspace.id,
      'tenant_id', v_workspace.tenant_id,
      'tenant_name', v_owner.tenant_name,
      'name', v_workspace.name,
      'slug', v_workspace.slug,
      'status', COALESCE(v_workspace.status, 'active')
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_provision_self_service_workspace_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF NEW.onboarding_status = 'ready' THEN
    PERFORM public.provision_self_service_workspace_v1(NEW.tenant_id, NEW.account_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_provision_self_service_workspace_v1
  ON public.self_service_customer_profiles;
CREATE TRIGGER trg_provision_self_service_workspace_v1
AFTER INSERT OR UPDATE OF onboarding_status
ON public.self_service_customer_profiles
FOR EACH ROW
WHEN (NEW.onboarding_status = 'ready')
EXECUTE FUNCTION public.trigger_provision_self_service_workspace_v1();

CREATE OR REPLACE FUNCTION public.ensure_my_self_service_workspace_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT a.id AS account_id, a.tenant_id
  INTO v_account
  FROM public.accounts a
  JOIN public.tenants t ON t.id = a.tenant_id
  JOIN public.self_service_customer_profiles sscp
    ON sscp.account_id = a.id
   AND sscp.tenant_id = a.tenant_id
  WHERE a.user_id = auth.uid()
    AND a.status = 'active'
    AND a.deleted_at IS NULL
    AND t.tenant_type = 'self_service_customer'
    AND COALESCE(t.status, 'active') = 'active'
    AND t.deleted_at IS NULL
    AND sscp.onboarding_status = 'ready'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SELF_SERVICE_OWNER_NOT_READY';
  END IF;

  RETURN public.provision_self_service_workspace_v1(
    v_account.tenant_id,
    v_account.account_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_accessible_workspaces_v1(
  p_tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
  v_role_name text;
  v_tenant_id uuid;
  v_is_self_service_owner boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_account_id := public.current_account_id();
  v_role_name := public.current_role_name();
  v_tenant_id := public.current_tenant_id();

  IF v_account_id IS NULL OR v_role_name IS NULL THEN
    RAISE EXCEPTION 'Account context not found';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.self_service_customer_profiles sscp
    JOIN public.tenants ten ON ten.id = sscp.tenant_id
    WHERE sscp.account_id = v_account_id
      AND sscp.tenant_id = v_tenant_id
      AND sscp.onboarding_status = 'ready'
      AND ten.tenant_type = 'self_service_customer'
      AND ten.deleted_at IS NULL
      AND COALESCE(ten.status, 'active') = 'active'
      AND public.business_access_active_v1(ten.id)
  ) INTO v_is_self_service_owner;

  IF v_role_name = 'SUPER_ADMIN' THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'tenant_name', row_data->>'created_at' DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'tournament_id', t.id,
          'id', t.id,
          'tenant_id', t.tenant_id,
          'tenant_name', ten.name,
          'name', t.name,
          'slug', t.slug,
          'location', t.location,
          'start_date', COALESCE(t.start_date::text, t.date),
          'status', COALESCE(t.status, 'active'),
          'created_at', t.created_at,
          'updated_at', t.updated_at,
          'events_count', (
            SELECT count(*) FROM public.events e
            WHERE e.tournament_id = t.id
              AND e.deleted_at IS NULL
              AND COALESCE(e.status, 'active') <> 'archived'
          ),
          'teams_count', (SELECT count(*) FROM public.teams tm WHERE tm.tournament_id = t.id AND tm.deleted_at IS NULL),
          'matches_count', (SELECT count(*) FROM public.matches m WHERE m.tournament_id = t.id AND m.deleted_at IS NULL),
          'access_scope', 'system'
        ) AS row_data
        FROM public.tournament t
        JOIN public.tenants ten ON ten.id = t.tenant_id
        WHERE t.deleted_at IS NULL
          AND COALESCE(t.status, 'active') <> 'archived'
          AND ten.deleted_at IS NULL
          AND COALESCE(ten.status, 'active') <> 'archived'
          AND (p_tenant_id IS NULL OR t.tenant_id = p_tenant_id)
      ) rows
    );
  END IF;

  IF v_role_name = 'TENANT_ADMIN'
     OR public.has_permission('manage_tournaments')
     OR v_is_self_service_owner
  THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'created_at' DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'tournament_id', t.id,
          'id', t.id,
          'tenant_id', t.tenant_id,
          'tenant_name', ten.name,
          'name', t.name,
          'slug', t.slug,
          'location', t.location,
          'start_date', COALESCE(t.start_date::text, t.date),
          'status', COALESCE(t.status, 'active'),
          'created_at', t.created_at,
          'updated_at', t.updated_at,
          'events_count', (
            SELECT count(*) FROM public.events e
            WHERE e.tournament_id = t.id
              AND e.deleted_at IS NULL
              AND COALESCE(e.status, 'active') <> 'archived'
          ),
          'teams_count', (SELECT count(*) FROM public.teams tm WHERE tm.tournament_id = t.id AND tm.deleted_at IS NULL),
          'matches_count', (SELECT count(*) FROM public.matches m WHERE m.tournament_id = t.id AND m.deleted_at IS NULL),
          'access_scope', CASE WHEN v_is_self_service_owner THEN 'self_service_owner' ELSE 'tenant' END
        ) AS row_data
        FROM public.tournament t
        JOIN public.tenants ten ON ten.id = t.tenant_id
        WHERE t.deleted_at IS NULL
          AND COALESCE(t.status, 'active') <> 'archived'
          AND ten.deleted_at IS NULL
          AND COALESCE(ten.status, 'active') <> 'archived'
          AND t.tenant_id = v_tenant_id
      ) rows
    );
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'tenant_name', row_data->>'created_at' DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'tournament_id', t.id,
        'id', t.id,
        'tenant_id', t.tenant_id,
        'tenant_name', ten.name,
        'name', t.name,
        'slug', t.slug,
        'location', t.location,
        'start_date', COALESCE(t.start_date::text, t.date),
        'status', COALESCE(t.status, 'active'),
        'created_at', t.created_at,
        'updated_at', t.updated_at,
        'events_count', count(DISTINCT e.id),
        'teams_count', (SELECT count(*) FROM public.teams tm WHERE tm.tournament_id = t.id AND tm.deleted_at IS NULL),
        'matches_count', (SELECT count(*) FROM public.matches m WHERE m.tournament_id = t.id AND m.deleted_at IS NULL),
        'access_scope', 'event'
      ) AS row_data
      FROM public.account_event_permissions aep
      JOIN public.events e ON e.id = aep.event_id
      JOIN public.tournament t ON t.id = e.tournament_id
      JOIN public.tenants ten ON ten.id = t.tenant_id
      WHERE aep.account_id = v_account_id
        AND aep.deleted_at IS NULL
        AND e.deleted_at IS NULL
        AND COALESCE(e.status, 'active') <> 'archived'
        AND t.deleted_at IS NULL
        AND COALESCE(t.status, 'active') <> 'archived'
        AND ten.deleted_at IS NULL
        AND COALESCE(ten.status, 'active') <> 'archived'
        AND aep.tenant_id = t.tenant_id
      GROUP BY t.id, t.tenant_id, ten.name, t.name, t.slug, t.location,
        t.start_date, t.date, t.status, t.created_at, t.updated_at
    ) rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_workspace_v1(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid := public.current_account_id();
  v_account_tenant_id uuid := public.current_tenant_id();
  v_role text := public.current_role_name();
  v_workspace record;
  v_allowed boolean := false;
  v_scope text;
BEGIN
  IF auth.uid() IS NULL OR v_account_id IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF NULLIF(btrim(p_slug), '') IS NULL THEN
    PERFORM public.record_security_audit_v1(
      'WORKSPACE_ACCESS_DENIED', 'workspace', NULL, 'deny',
      'invalid_workspace_slug', '{}'::jsonb
    );
    RETURN jsonb_build_object('allowed', false, 'reason', 'WORKSPACE_NOT_AVAILABLE');
  END IF;

  SELECT
    t.id AS tournament_id,
    t.tenant_id,
    t.name AS tournament_name,
    t.slug AS tournament_slug,
    ten.name AS tenant_name,
    ten.tenant_type
  INTO v_workspace
  FROM public.tournament t
  JOIN public.tenants ten ON ten.id = t.tenant_id
  WHERE t.deleted_at IS NULL
    AND COALESCE(t.status, 'active') <> 'archived'
    AND ten.deleted_at IS NULL
    AND COALESCE(ten.status, 'active') <> 'archived'
    AND (t.slug = p_slug OR t.id = p_slug OR ten.slug = p_slug OR ten.id::text = p_slug)
  ORDER BY
    CASE WHEN t.slug = p_slug OR t.id = p_slug THEN 0 ELSE 1 END,
    CASE WHEN COALESCE(t.status, 'active') = 'active' THEN 0 ELSE 1 END,
    t.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_workspace.tournament_id IS NULL THEN
    PERFORM public.record_security_audit_v1(
      'WORKSPACE_ACCESS_DENIED', 'workspace', p_slug, 'deny',
      'workspace_not_available', '{}'::jsonb
    );
    RETURN jsonb_build_object('allowed', false, 'reason', 'WORKSPACE_NOT_AVAILABLE');
  END IF;

  IF v_role = 'SUPER_ADMIN' THEN
    v_allowed := true;
    v_scope := 'system';
  ELSIF v_role = 'TENANT_ADMIN' AND v_account_tenant_id = v_workspace.tenant_id THEN
    v_allowed := true;
    v_scope := 'tenant';
  ELSIF v_role = 'EVENT_ADMIN'
    AND v_workspace.tenant_type = 'self_service_customer'
    AND v_account_tenant_id = v_workspace.tenant_id
    AND public.business_access_active_v1(v_workspace.tenant_id)
    AND EXISTS (
      SELECT 1 FROM public.self_service_customer_profiles sscp
      WHERE sscp.account_id = v_account_id
        AND sscp.tenant_id = v_workspace.tenant_id
        AND sscp.onboarding_status = 'ready'
    )
  THEN
    v_allowed := true;
    v_scope := 'self_service_owner';
  ELSIF EXISTS (
    SELECT 1
    FROM public.account_event_permissions aep
    JOIN public.events e ON e.id = aep.event_id
    WHERE aep.account_id = v_account_id
      AND aep.deleted_at IS NULL
      AND e.tournament_id = v_workspace.tournament_id
      AND e.deleted_at IS NULL
      AND COALESCE(e.status, 'active') <> 'archived'
      AND COALESCE(aep.tenant_id, v_workspace.tenant_id) = v_workspace.tenant_id
  ) THEN
    v_allowed := true;
    v_scope := 'event';
  END IF;

  IF NOT v_allowed THEN
    PERFORM public.record_security_audit_v1(
      'WORKSPACE_ACCESS_DENIED', 'workspace', p_slug, 'deny',
      'permission_denied',
      jsonb_build_object('requested_tournament_id', v_workspace.tournament_id)
    );
    RETURN jsonb_build_object('allowed', false, 'reason', 'WORKSPACE_NOT_AVAILABLE');
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reason', 'ACCESS_GRANTED',
    'access_scope', v_scope,
    'workspace', jsonb_build_object(
      'tenant_id', v_workspace.tenant_id,
      'tenant_name', v_workspace.tenant_name,
      'tournament_id', v_workspace.tournament_id,
      'tournament_name', v_workspace.tournament_name,
      'slug', v_workspace.tournament_slug
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_tournament_v1(
  p_tournament_id text,
  p_name text DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_existing public.tournament%ROWTYPE;
  v_tournament public.tournament%ROWTYPE;
  v_is_self_service_owner boolean := false;
BEGIN
  SELECT * INTO v_existing
  FROM public.tournament
  WHERE id = p_tournament_id
    AND deleted_at IS NULL;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'Tournament not found';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.accounts a
    JOIN public.roles r ON r.id = a.role_id
    JOIN public.tenants t ON t.id = a.tenant_id
    JOIN public.self_service_customer_profiles sscp
      ON sscp.account_id = a.id
     AND sscp.tenant_id = a.tenant_id
    WHERE a.user_id = auth.uid()
      AND a.tenant_id = v_existing.tenant_id
      AND a.status = 'active'
      AND a.deleted_at IS NULL
      AND r.name = 'EVENT_ADMIN'
      AND t.tenant_type = 'self_service_customer'
      AND t.deleted_at IS NULL
      AND sscp.onboarding_status = 'ready'
      AND public.business_access_active_v1(t.id)
  ) INTO v_is_self_service_owner;

  IF v_is_self_service_owner THEN
    IF p_status IS NOT NULL AND p_status IS DISTINCT FROM v_existing.status THEN
      RAISE EXCEPTION 'SELF_SERVICE_TOURNAMENT_STATUS_MANAGED_BY_SYSTEM';
    END IF;
    IF NULLIF(btrim(p_slug), '') IS NOT NULL
       AND lower(btrim(p_slug)) IS DISTINCT FROM v_existing.slug
    THEN
      RAISE EXCEPTION 'SELF_SERVICE_TOURNAMENT_SLUG_IMMUTABLE';
    END IF;
  ELSE
    PERFORM public.ensure_manage_tournaments_v1(v_existing.tenant_id);
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'archived', 'completed', 'draft') THEN
    RAISE EXCEPTION 'Invalid tournament status';
  END IF;

  UPDATE public.tournament
  SET
    name = COALESCE(NULLIF(btrim(p_name), ''), name),
    slug = CASE
      WHEN v_is_self_service_owner THEN slug
      ELSE COALESCE(NULLIF(lower(btrim(p_slug)), ''), slug)
    END,
    location = COALESCE(p_location, location),
    start_date = COALESCE(p_start_date, start_date),
    date = COALESCE(p_start_date::text, date),
    status = CASE WHEN v_is_self_service_owner THEN status ELSE COALESCE(p_status, status) END,
    updated_at = now()
  WHERE id = p_tournament_id
  RETURNING * INTO v_tournament;

  RETURN to_jsonb(v_tournament);
END;
$$;

DO $$
DECLARE
  v_profile record;
BEGIN
  FOR v_profile IN
    SELECT sscp.tenant_id, sscp.account_id
    FROM public.self_service_customer_profiles sscp
    WHERE sscp.onboarding_status = 'ready'
      AND public.business_access_active_v1(sscp.tenant_id)
  LOOP
    PERFORM public.provision_self_service_workspace_v1(
      v_profile.tenant_id,
      v_profile.account_id
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_self_service_workspace_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trigger_provision_self_service_workspace_v1()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_my_self_service_workspace_v1()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_self_service_workspace_v1()
  TO authenticated;

REVOKE ALL ON FUNCTION public.list_accessible_workspaces_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_accessible_workspaces_v1(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.can_access_workspace_v1(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_workspace_v1(text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.update_tournament_v1(text, text, text, text, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tournament_v1(text, text, text, text, date, text)
  TO authenticated;

COMMIT;
