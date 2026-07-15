SELECT
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenants'
      AND column_name = 'tenant_type'
  ) AS tenant_type_exists,
  to_regclass('public.self_service_customer_profiles') IS NOT NULL AS profile_table_exists,
  to_regprocedure('public.bootstrap_self_service_customer_v1(uuid)') IS NOT NULL AS bootstrap_rpc_exists,
  has_function_privilege(
    'service_role',
    'public.bootstrap_self_service_customer_v1(uuid)'::regprocedure,
    'EXECUTE'
  ) AS service_role_can_bootstrap,
  NOT has_function_privilege(
    'authenticated',
    'public.bootstrap_self_service_customer_v1(uuid)'::regprocedure,
    'EXECUTE'
  ) AS authenticated_cannot_bootstrap_directly,
  NOT has_function_privilege(
    'anon',
    'public.bootstrap_self_service_customer_v1(uuid)'::regprocedure,
    'EXECUTE'
  ) AS anon_cannot_bootstrap,
  has_function_privilege(
    'authenticated',
    'public.get_current_profile()'::regprocedure,
    'EXECUTE'
  ) AS authenticated_can_load_profile,
  (
    SELECT count(*) = 0
    FROM public.tenants
    WHERE tenant_type IS NULL
  ) AS existing_tenants_classified,
  (
    SELECT count(*) = 0
    FROM (
      SELECT user_id
      FROM public.accounts
      WHERE user_id IS NOT NULL
      GROUP BY user_id
      HAVING count(*) > 1
    ) duplicate_users
  ) AS account_user_ids_unique;
