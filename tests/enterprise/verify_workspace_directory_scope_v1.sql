WITH actor AS MATERIALIZED (
  SELECT
    a.id AS account_id,
    a.tenant_id,
    set_config('request.jwt.claim.sub', a.user_id::text, true) AS claim
  FROM public.accounts a
  WHERE lower(a.username) = 'eventcocdan'
    AND a.deleted_at IS NULL
  LIMIT 1
),
other_tenant AS MATERIALIZED (
  SELECT ten.id
  FROM public.tenants ten
  JOIN actor ON true
  WHERE ten.id <> actor.tenant_id
    AND ten.deleted_at IS NULL
  ORDER BY ten.created_at
  LIMIT 1
),
page AS MATERIALIZED (
  SELECT
    actor.account_id,
    actor.tenant_id,
    public.list_accessible_workspaces_page_v1(
      other_tenant.id,
      'operational',
      NULL,
      NULL,
      NULL,
      100
    ) AS payload
  FROM actor
  LEFT JOIN other_tenant ON true
),
workspace_rows AS (
  SELECT
    page.account_id,
    page.tenant_id AS actor_tenant_id,
    item.value AS workspace
  FROM page
  CROSS JOIN LATERAL jsonb_array_elements(page.payload -> 'data') item
)
SELECT
  (SELECT count(*) FROM workspace_rows) AS workspace_count,
  NOT EXISTS (
    SELECT 1
    FROM workspace_rows row_data
    WHERE row_data.workspace ->> 'tenant_id' <> row_data.actor_tenant_id::text
  ) AS cross_tenant_filter_ignored_safely,
  NOT EXISTS (
    SELECT 1
    FROM workspace_rows row_data
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.account_event_permissions aep
      JOIN public.events e ON e.id = aep.event_id
      WHERE aep.account_id = row_data.account_id
        AND aep.deleted_at IS NULL
        AND e.tournament_id = row_data.workspace ->> 'tournament_id'
        AND e.deleted_at IS NULL
        AND COALESCE(e.status, 'active') <> 'archived'
    )
  ) AS every_workspace_has_active_event_assignment,
  NOT EXISTS (
    SELECT 1
    FROM workspace_rows row_data
    WHERE (row_data.workspace ->> 'events_count')::integer <> (
      SELECT count(DISTINCT e.id)::integer
      FROM public.account_event_permissions aep
      JOIN public.events e ON e.id = aep.event_id
      WHERE aep.account_id = row_data.account_id
        AND aep.deleted_at IS NULL
        AND e.tournament_id = row_data.workspace ->> 'tournament_id'
        AND e.deleted_at IS NULL
        AND COALESCE(e.status, 'active') <> 'archived'
    )
  ) AS event_stats_follow_assignment_scope,
  NOT EXISTS (
    SELECT 1
    FROM workspace_rows row_data
    WHERE (row_data.workspace ->> 'teams_count')::integer <> (
      SELECT count(DISTINCT tm.id)::integer
      FROM public.account_event_permissions aep
      JOIN public.teams tm ON tm.event_id = aep.event_id
      WHERE aep.account_id = row_data.account_id
        AND aep.deleted_at IS NULL
        AND tm.tournament_id = row_data.workspace ->> 'tournament_id'
        AND tm.deleted_at IS NULL
    )
  ) AS team_stats_follow_assignment_scope,
  NOT EXISTS (
    SELECT 1
    FROM workspace_rows row_data
    WHERE (row_data.workspace ->> 'matches_count')::integer <> (
      SELECT count(DISTINCT m.id)::integer
      FROM public.account_event_permissions aep
      JOIN public.matches m ON m.event_id = aep.event_id
      WHERE aep.account_id = row_data.account_id
        AND aep.deleted_at IS NULL
        AND m.tournament_id = row_data.workspace ->> 'tournament_id'
        AND m.deleted_at IS NULL
    )
  ) AS match_stats_follow_assignment_scope;
