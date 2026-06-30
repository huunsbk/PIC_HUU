-- Enforce live permission revocation for active sessions and score entry RPCs.

CREATE UNIQUE INDEX IF NOT EXISTS ux_active_sessions_session_token
  ON public.active_sessions(session_token);

ALTER TABLE public.active_sessions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'active_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.active_sessions;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_login_session_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_account_id uuid;
  v_session_token text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'skipped', true,
      'reason', 'authentication_required'
    );
  END IF;

  v_tenant_id := public.current_tenant_id();
  v_account_id := public.current_account_id();
  v_session_token := auth.uid()::text;

  IF v_account_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'skipped', true,
      'reason', 'account_context_missing'
    );
  END IF;

  INSERT INTO public.active_sessions(
    account_id,
    session_token,
    last_seen_at,
    expires_at,
    created_at
  )
  VALUES (
    v_account_id,
    v_session_token,
    now(),
    now() + interval '30 days',
    now()
  )
  ON CONFLICT (session_token)
  DO UPDATE SET
    account_id = EXCLUDED.account_id,
    last_seen_at = now(),
    expires_at = now() + interval '30 days';

  PERFORM public.log_audit_event_v1(
    'LOGIN_SUCCESS',
    'account',
    v_account_id::text,
    jsonb_build_object(
      'event', 'login',
      'account_id', v_account_id,
      'tenant_id', v_tenant_id,
      'recorded_at', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'skipped', false,
    'account_id', v_account_id,
    'session_recorded', true
  );
EXCEPTION
  WHEN undefined_function THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', false,
      'account_id', v_account_id,
      'session_recorded', true,
      'audit_skipped', true
    );
  WHEN others THEN
    RETURN jsonb_build_object(
      'success', false,
      'skipped', true,
      'reason', 'login_session_record_failed'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.p10_require_match_score_context_v1(
  p_match_id text,
  p_rpc_name text DEFAULT 'score_rpc'
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
      AND public.p10_has_event_permission_v1(v_match.event_id, 'enter_scores')
    )
    OR (
      v_role_name = 'REFEREE'
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

REVOKE ALL ON FUNCTION public.record_login_session_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.p10_require_match_score_context_v1(text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.record_login_session_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.p10_require_match_score_context_v1(text, text) TO authenticated;
