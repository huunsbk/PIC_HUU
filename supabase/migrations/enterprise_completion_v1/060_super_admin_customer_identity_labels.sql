-- Expose the self-service registration email only through the SUPER_ADMIN
-- tenant summary. Frontend roles never receive direct access to auth.users.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_tenant_tournament_summary_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_account_id() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF public.current_role_name() <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Permission denied: SUPER_ADMIN required';
  END IF;

  RETURN (
    SELECT COALESCE(
      jsonb_agg(summary.row_data ORDER BY summary.tenant_name),
      '[]'::jsonb
    )
    FROM (
      SELECT
        ten.name AS tenant_name,
        jsonb_build_object(
          'tenant_id', ten.id,
          'tenant_name', ten.name,
          'tenant_slug', ten.slug,
          'tenant_status', COALESCE(ten.status, 'active'),
          'tenant_type', ten.tenant_type,
          'onboarding_status', sscp.onboarding_status,
          'registration_email', CASE
            WHEN ten.tenant_type = 'self_service_customer'
            THEN lower(registration_user.email)
            ELSE NULL
          END,
          'business_access_active', public.business_access_active_v1(ten.id),
          'subscription_status', subscription.status,
          'subscription_end_date', subscription.end_date,
          'active_tournament_count', (
            SELECT count(*)
            FROM public.tournament tournament
            WHERE tournament.tenant_id = ten.id
              AND tournament.deleted_at IS NULL
              AND COALESCE(tournament.status, 'active') <> 'archived'
          ),
          'archived_tournament_count', (
            SELECT count(*)
            FROM public.tournament tournament
            WHERE tournament.tenant_id = ten.id
              AND tournament.deleted_at IS NULL
              AND COALESCE(tournament.status, 'active') = 'archived'
          ),
          'account_count', (
            SELECT count(*)
            FROM public.accounts account
            WHERE account.tenant_id = ten.id
              AND account.deleted_at IS NULL
              AND account.status = 'active'
          )
        ) AS row_data
      FROM public.tenants ten
      LEFT JOIN public.self_service_customer_profiles sscp
        ON sscp.tenant_id = ten.id
      LEFT JOIN public.accounts owner_account
        ON owner_account.id = sscp.account_id
       AND owner_account.tenant_id = ten.id
       AND owner_account.deleted_at IS NULL
      LEFT JOIN auth.users registration_user
        ON registration_user.id = owner_account.user_id
      LEFT JOIN LATERAL (
        SELECT subscription_row.status, subscription_row.end_date
        FROM public.tenant_subscriptions subscription_row
        WHERE subscription_row.tenant_id = ten.id
        ORDER BY
          CASE
            WHEN subscription_row.status IN ('active', 'trial', 'scheduled')
              AND subscription_row.start_date <= now()
              AND (subscription_row.end_date IS NULL OR subscription_row.end_date > now())
            THEN 0
            ELSE 1
          END,
          subscription_row.created_at DESC
        LIMIT 1
      ) subscription ON true
      WHERE ten.deleted_at IS NULL
        AND COALESCE(ten.status, 'active') <> 'archived'
    ) summary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_tenant_tournament_summary_v1()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tenant_tournament_summary_v1()
  TO authenticated;

COMMIT;
