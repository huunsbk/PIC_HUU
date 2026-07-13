-- Phase 5D: add a structured, backward-compatible audit contract.

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_account_id uuid,
  ADD COLUMN IF NOT EXISTS actor_role text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id text,
  ADD COLUMN IF NOT EXISTS result text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS details_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created_at
  ON public.audit_logs(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created_at
  ON public.audit_logs(actor_account_id, created_at DESC)
  WHERE actor_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sanitize_audit_payload_v1(p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_type text;
BEGIN
  IF p_value IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  v_type := jsonb_typeof(p_value);

  IF v_type = 'object' THEN
    RETURN COALESCE((
      SELECT jsonb_object_agg(entry.key, public.sanitize_audit_payload_v1(entry.value))
      FROM jsonb_each(p_value) entry
      WHERE lower(entry.key) NOT IN (
        'password',
        'newpassword',
        'new_password',
        'token',
        'access_token',
        'refresh_token',
        'secret',
        'service_role_key',
        'supabase_service_role_key',
        'authorization'
      )
    ), '{}'::jsonb);
  END IF;

  IF v_type = 'array' THEN
    RETURN COALESCE((
      SELECT jsonb_agg(public.sanitize_audit_payload_v1(item.value) ORDER BY item.ordinality)
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS item(value, ordinality)
    ), '[]'::jsonb);
  END IF;

  RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_audit_event_v1(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid := public.current_account_id();
  v_tenant_id uuid := public.current_tenant_id();
  v_actor_role text := public.current_role_name();
  v_payload jsonb;
  v_details jsonb;
  v_category text;
  v_audit_id bigint;
BEGIN
  IF auth.uid() IS NULL OR v_account_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF NULLIF(btrim(p_action), '') IS NULL THEN
    RAISE EXCEPTION 'p_action is required';
  END IF;

  v_payload := public.sanitize_audit_payload_v1(COALESCE(p_payload, '{}'::jsonb));
  v_category := CASE
    WHEN p_action ~* '(^|[._])(login|logout|session|permission|grant|revoke|access)' THEN 'security'
    WHEN p_action ~* '(^|[._])account' THEN 'identity'
    WHEN p_action ~* '(score|match|standing|bracket|knockout)' THEN 'competition'
    WHEN p_action ~* '(tenant|tournament|event|team|group|schedule)' THEN 'operations'
    ELSE 'business'
  END;

  v_details := jsonb_build_object(
    'account_id', v_account_id,
    'actor_role', v_actor_role,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'payload', v_payload
  );

  INSERT INTO public.audit_logs (
    timestamp,
    action,
    details,
    created_at,
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
    to_char(now(), 'HH24:MI:SS DD/MM/YYYY'),
    p_action,
    v_details::text,
    now(),
    v_tenant_id,
    v_account_id,
    v_actor_role,
    v_category,
    NULLIF(btrim(p_entity_type), ''),
    NULLIF(btrim(p_entity_id), ''),
    'allow',
    v_payload
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'success', true,
    'audit_id', v_audit_id,
    'action', p_action,
    'category', v_category,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'result', 'allow'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sanitize_audit_payload_v1(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_audit_event_v1(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_event_v1(text, text, text, jsonb) TO authenticated;

