WITH auth_context AS (
  SELECT
    set_config('request.jwt.claim.sub', '652b872b-e3a9-4d48-8388-1f0ea1289be6', true) AS auth_sub,
    set_config('role', 'authenticated', true) AS auth_role
),
workspace_context AS (
  SELECT public.get_workspace_context_v1('thang-oanh') AS value
  FROM auth_context
),
tenant_list AS (
  SELECT public.list_tenants_v1() AS value
  FROM auth_context
),
tournament_list AS (
  SELECT public.list_tournaments_v1(
    ((SELECT value FROM workspace_context)->>'tenant_id')::uuid
  ) AS value
  FROM auth_context
),
counts AS (
  SELECT
    (SELECT count(*) FROM auth.users) AS auth_users_count,
    (
      SELECT count(*)
      FROM public.accounts a
      JOIN public.roles r ON r.id = a.role_id
      WHERE r.name = 'SUPER_ADMIN'
        AND a.status = 'active'
    ) AS active_super_admin_count,
    (
      SELECT count(*)
      FROM public.tenants
      WHERE slug = 'clb-thang-oanh'
    ) AS demo_tenant_count,
    (
      SELECT count(*)
      FROM public.tournament
      WHERE slug = 'thang-oanh'
        AND deleted_at IS NULL
    ) AS demo_tournament_count,
    (
      SELECT count(*)
      FROM public.tenant_subscriptions ts
      JOIN public.tenants ten ON ten.id = ts.tenant_id
      WHERE ten.slug = 'clb-thang-oanh'
        AND ts.status = 'active'
    ) AS demo_active_subscription_count,
    (
      SELECT count(*)
      FROM public.events
    ) AS events_count,
    (
      SELECT count(*)
      FROM public.teams
    ) AS teams_count
)
SELECT
  counts.*,
  (SELECT value FROM workspace_context) AS workspace_context,
  (
    SELECT jsonb_path_query_first(value, '$[*] ? (@.slug == "clb-thang-oanh")')
    FROM tenant_list
  ) AS tenant_from_list,
  (
    SELECT jsonb_path_query_first(value, '$[*] ? (@.slug == "thang-oanh")')
    FROM tournament_list
  ) AS tournament_from_list
FROM counts;
