WITH active_event_grants AS (
  SELECT DISTINCT
    aep.account_id,
    COALESCE(aep.permission, 'enter_scores') AS permission,
    aep.event_id
  FROM public.account_event_permissions aep
  JOIN public.events e ON e.id = aep.event_id
  JOIN public.tournament t ON t.id = e.tournament_id
  JOIN public.tenants ten ON ten.id = t.tenant_id
  WHERE aep.deleted_at IS NULL
    AND COALESCE(aep.tenant_id, t.tenant_id) = t.tenant_id
    AND e.deleted_at IS NULL
    AND COALESCE(e.status, 'active') <> 'archived'
    AND t.deleted_at IS NULL
    AND COALESCE(t.status, 'active') <> 'archived'
    AND ten.deleted_at IS NULL
    AND COALESCE(ten.status, 'active') <> 'archived'
), duplicate_active_grants AS (
  SELECT account_id, permission, event_id, count(*) AS row_count
  FROM active_event_grants
  GROUP BY account_id, permission, event_id
  HAVING count(*) > 1
)
SELECT jsonb_build_object(
  'success',
    has_function_privilege('authenticated', 'public.list_my_effective_access_grants_v1()'::regprocedure, 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.can_access_workspace_v1(text)'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.list_my_effective_access_grants_v1()'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.can_access_workspace_v1(text)'::regprocedure, 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM duplicate_active_grants),
  'duplicate_active_grants',
    COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM duplicate_active_grants d), '[]'::jsonb)
) AS effective_access_contract_044;

