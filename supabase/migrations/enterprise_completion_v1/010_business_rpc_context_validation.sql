-- Prompt 07-I: harden business RPC context validation.
--
-- Safety:
-- - Does not reset data.
-- - Does not touch auth.users.
-- - Does not drop business tables.
-- - Preserves existing business RPC signatures.

BEGIN;

CREATE OR REPLACE FUNCTION public.p10_has_event_permission_v1(
  p_event_id text,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.account_event_permissions aep
    WHERE aep.account_id = public.current_account_id()
      AND aep.event_id = p_event_id
      AND COALESCE(aep.permission, 'enter_scores') = p_permission
      AND aep.deleted_at IS NULL
      AND (
        aep.tenant_id IS NULL
        OR aep.tenant_id = (
          SELECT e.tenant_id
          FROM public.events e
          WHERE e.id = p_event_id
            AND e.deleted_at IS NULL
          LIMIT 1
        )
      )
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.has_event_access(check_event_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  WITH current_context AS (
    SELECT
      a.id AS account_id,
      a.tenant_id,
      r.name AS role_name
    FROM public.accounts a
    JOIN public.roles r ON r.id = a.role_id
    WHERE a.user_id = auth.uid()
      AND a.deleted_at IS NULL
      AND a.status = 'active'
    LIMIT 1
  ),
  target_event AS (
    SELECT e.id, e.tenant_id
    FROM public.events e
    WHERE e.id = check_event_id
      AND e.deleted_at IS NULL
    LIMIT 1
  )
  SELECT COALESCE((
    SELECT
      CASE
        WHEN cc.account_id IS NULL THEN false
        WHEN te.id IS NULL THEN false
        WHEN cc.role_name = 'SUPER_ADMIN' THEN true
        WHEN cc.role_name = 'TENANT_ADMIN' AND te.tenant_id = cc.tenant_id THEN true
        WHEN cc.role_name IN ('EVENT_ADMIN', 'REFEREE')
          AND te.tenant_id = cc.tenant_id
          AND EXISTS (
            SELECT 1
            FROM public.account_event_permissions aep
            WHERE aep.account_id = cc.account_id
              AND aep.event_id = te.id
              AND COALESCE(aep.tenant_id, te.tenant_id) = te.tenant_id
              AND aep.deleted_at IS NULL
          )
          THEN true
        ELSE false
      END
    FROM current_context cc
    CROSS JOIN target_event te
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.p10_validate_event_context_v1(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
  v_current_tenant_id uuid;
  v_role_name text;
  v_event record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  v_account_id := public.current_account_id();
  v_current_tenant_id := public.current_tenant_id();
  v_role_name := public.current_role_name();

  IF v_account_id IS NULL OR v_role_name IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RAISE EXCEPTION 'INVALID_EVENT_ID';
  END IF;

  IF EXISTS (SELECT 1 FROM public.tenants WHERE id::text = p_event_id) THEN
    RAISE EXCEPTION 'INVALID_CONTEXT';
  END IF;

  IF EXISTS (SELECT 1 FROM public.tournament WHERE id = p_event_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'INVALID_CONTEXT';
  END IF;

  IF p_event_id !~ '^evt_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'INVALID_EVENT_ID';
  END IF;

  SELECT e.*
    INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND';
  END IF;

  IF v_role_name <> 'SUPER_ADMIN' AND v_event.tenant_id <> v_current_tenant_id THEN
    RAISE EXCEPTION 'INVALID_CONTEXT';
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'tenant_id', v_event.tenant_id,
    'tournament_id', v_event.tournament_id,
    'sport_id', v_event.sport_id,
    'format_type', COALESCE(v_event.format_type, 'group_then_knockout'),
    'ranking_config', COALESCE(v_event.ranking_config, '{}'::jsonb),
    'scoring_config', COALESCE(v_event.scoring_config, '{}'::jsonb),
    'role_name', v_role_name,
    'account_id', v_account_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.p10_require_event_admin_v1(
  p_event_id text,
  p_permission text,
  p_rpc_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_ctx jsonb;
  v_role_name text;
BEGIN
  v_ctx := public.p10_validate_event_context_v1(p_event_id);
  v_role_name := v_ctx->>'role_name';

  IF v_role_name IN ('REFEREE', 'VIEWER') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  IF NOT (
    v_role_name = 'SUPER_ADMIN'
    OR (v_role_name = 'TENANT_ADMIN' AND (v_ctx->>'tenant_id')::uuid = public.current_tenant_id())
    OR (
      v_role_name = 'EVENT_ADMIN'
      AND public.has_event_access(p_event_id)
      AND public.has_permission(p_permission)
    )
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  RETURN v_ctx || jsonb_build_object('rpc_name', p_rpc_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.p06_require_event_admin_v1(
  p_event_id text,
  p_permission text,
  p_rpc_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  RETURN public.p10_require_event_admin_v1(p_event_id, p_permission, p_rpc_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.p10_require_match_score_context_v1(
  p_match_id text,
  p_rpc_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_match record;
  v_ctx jsonb;
  v_role_name text;
BEGIN
  IF auth.uid() IS NULL OR public.current_account_id() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF p_match_id IS NULL OR btrim(p_match_id) = '' THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND';
  END IF;

  SELECT m.*
    INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND';
  END IF;

  v_ctx := public.p10_validate_event_context_v1(v_match.event_id);
  v_role_name := v_ctx->>'role_name';

  IF v_role_name = 'VIEWER' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  IF NOT (
    v_role_name = 'SUPER_ADMIN'
    OR (v_role_name = 'TENANT_ADMIN' AND v_match.tenant_id = public.current_tenant_id())
    OR (
      v_role_name = 'EVENT_ADMIN'
      AND public.has_event_access(v_match.event_id)
      AND (public.has_permission('enter_scores') OR public.has_permission('manage_matches'))
    )
    OR (
      v_role_name = 'REFEREE'
      AND public.has_permission('enter_scores')
      AND public.p10_has_event_permission_v1(v_match.event_id, 'enter_scores')
    )
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  RETURN v_ctx || jsonb_build_object(
    'match_id', v_match.id,
    'team_a_id', v_match.team_a_id,
    'team_b_id', v_match.team_b_id,
    'rpc_name', p_rpc_name
  );
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.p10_core_update_match_score_v1(text,integer,integer)') IS NULL THEN
    ALTER FUNCTION public.update_match_score_v1(text, integer, integer)
      RENAME TO p10_core_update_match_score_v1;
  END IF;

  IF to_regprocedure('public.p10_core_update_match_set_score_v1(text,integer,integer,integer)') IS NULL THEN
    ALTER FUNCTION public.update_match_set_score_v1(text, integer, integer, integer)
      RENAME TO p10_core_update_match_set_score_v1;
  END IF;

  IF to_regprocedure('public.p10_core_reset_match_score_v1(text)') IS NULL THEN
    ALTER FUNCTION public.reset_match_score_v1(text)
      RENAME TO p10_core_reset_match_score_v1;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_match_score_v1(
  p_match_id text,
  p_score_a integer,
  p_score_b integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  PERFORM public.p10_require_match_score_context_v1(p_match_id, 'update_match_score_v1');
  RETURN public.p10_core_update_match_score_v1(p_match_id, p_score_a, p_score_b);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_match_set_score_v1(
  p_match_id text,
  p_set_number integer,
  p_score_a integer,
  p_score_b integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  PERFORM public.p10_require_match_score_context_v1(p_match_id, 'update_match_set_score_v1');
  RETURN public.p10_core_update_match_set_score_v1(p_match_id, p_set_number, p_score_a, p_score_b);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_match_score_v1(p_match_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  PERFORM public.p10_require_match_score_context_v1(p_match_id, 'reset_match_score_v1');
  RETURN public.p10_core_reset_match_score_v1(p_match_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.p10_has_event_permission_v1(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p10_validate_event_context_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p10_require_event_admin_v1(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p06_require_event_admin_v1(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p10_require_match_score_context_v1(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p10_core_update_match_score_v1(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p10_core_update_match_set_score_v1(text, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p10_core_reset_match_score_v1(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.p10_has_event_permission_v1(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.p10_validate_event_context_v1(text) FROM anon;
REVOKE ALL ON FUNCTION public.p10_require_event_admin_v1(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.p06_require_event_admin_v1(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.p10_require_match_score_context_v1(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.p10_core_update_match_score_v1(text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.p10_core_update_match_set_score_v1(text, integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.p10_core_reset_match_score_v1(text) FROM anon;

REVOKE ALL ON FUNCTION public.p10_has_event_permission_v1(text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.p10_validate_event_context_v1(text) FROM authenticated;
REVOKE ALL ON FUNCTION public.p10_require_event_admin_v1(text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.p06_require_event_admin_v1(text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.p10_require_match_score_context_v1(text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.p10_core_update_match_score_v1(text, integer, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.p10_core_update_match_set_score_v1(text, integer, integer, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.p10_core_reset_match_score_v1(text) FROM authenticated;

REVOKE ALL ON FUNCTION public.update_match_score_v1(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_match_set_score_v1(text, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_match_score_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_match_score_v1(text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.update_match_set_score_v1(text, integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.reset_match_score_v1(text) FROM anon;

GRANT EXECUTE ON FUNCTION public.update_match_score_v1(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_match_set_score_v1(text, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_match_score_v1(text) TO authenticated;

COMMIT;
