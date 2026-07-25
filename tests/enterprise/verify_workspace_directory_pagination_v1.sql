WITH actor AS MATERIALIZED (
  SELECT set_config('request.jwt.claim.sub', a.user_id::text, true) AS claim
  FROM public.accounts a
  WHERE lower(a.username) = 'cocdan'
    AND a.deleted_at IS NULL
  LIMIT 1
),
first_page AS MATERIALIZED (
  SELECT public.list_accessible_workspaces_page_v1(
    NULL,
    'operational',
    NULL,
    NULL,
    NULL,
    1
  ) AS payload
  FROM actor
),
second_page AS MATERIALIZED (
  SELECT public.list_accessible_workspaces_page_v1(
    NULL,
    'operational',
    NULL,
    (first_page.payload -> 'next_cursor' ->> 'created_at')::timestamptz,
    first_page.payload -> 'next_cursor' ->> 'id',
    1
  ) AS payload
  FROM first_page
  WHERE first_page.payload -> 'next_cursor' IS NOT NULL
)
SELECT
  to_regprocedure(
    'public.list_accessible_workspaces_page_v1(uuid,text,text,timestamp with time zone,text,integer)'
  ) IS NOT NULL AS function_exists,
  jsonb_array_length(first_page.payload -> 'data') AS first_page_count,
  COALESCE((first_page.payload ->> 'has_more')::boolean, false) AS first_page_has_more,
  COALESCE(jsonb_array_length(second_page.payload -> 'data'), 0) AS second_page_count,
  (
    first_page.payload -> 'data' -> 0 ->> 'tournament_id'
  ) IS DISTINCT FROM (
    second_page.payload -> 'data' -> 0 ->> 'tournament_id'
  ) AS cursor_has_no_overlap
FROM first_page
LEFT JOIN second_page ON true;
