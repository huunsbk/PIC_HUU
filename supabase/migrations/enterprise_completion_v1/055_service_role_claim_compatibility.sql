-- Supabase secret keys expose the role in request.jwt.claims instead of the
-- legacy request.jwt.claim.role setting. Keep commercial RPCs compatible with both.

BEGIN;

CREATE OR REPLACE FUNCTION public.request_claim_role_v1()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_legacy_role text := NULLIF(current_setting('request.jwt.claim.role', true), '');
  v_claims_text text := NULLIF(current_setting('request.jwt.claims', true), '');
BEGIN
  IF v_legacy_role IS NOT NULL THEN
    RETURN v_legacy_role;
  END IF;
  IF v_claims_text IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_claims_text::jsonb->>'role';
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  v_function record;
  v_definition text;
  v_legacy_declaration constant text :=
    'v_claim_role text := current_setting(''request.jwt.claim.role'', true);';
BEGIN
  FOR v_function IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'bootstrap_self_service_customer_v1',
        'create_payment_order_v1',
        'attach_payment_provider_v1',
        'settle_payment_order_v1',
        'process_payos_webhook_v1',
        'record_invalid_payos_webhook_v1',
        'request_payment_manual_review_v1',
        'list_payment_manual_reviews_v1',
        'confirm_payment_order_manual_v1',
        'reject_payment_order_manual_v1'
      )
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    IF position(v_legacy_declaration IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Commercial function % does not contain the expected legacy claim declaration',
        v_function.oid::regprocedure;
    END IF;
    EXECUTE replace(
      v_definition,
      v_legacy_declaration,
      'v_claim_role text := public.request_claim_role_v1();'
    );
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.request_claim_role_v1() FROM PUBLIC, anon, authenticated;

COMMIT;
