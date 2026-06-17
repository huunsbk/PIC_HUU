-- This is the Staging-validated Commercial Beta V1 hotfix.
-- It intentionally returns NULL owner fields because tournament.owner_account_id is not part of the current schema.

CREATE OR REPLACE FUNCTION public.get_tournament_workspace_dashboard_v6(
  p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_limit integer DEFAULT 50
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result json;
BEGIN
  WITH limited_tournaments AS (
    SELECT
      tr.id,
      tr.name,
      tr.slug,
      tr.created_at,
      tr.settings
    FROM public.tournament tr
    WHERE p_cursor IS NULL
       OR tr.created_at < p_cursor
    ORDER BY tr.created_at DESC, tr.id DESC
    LIMIT GREATEST(p_limit, 0) + 1
  ),
  page_tournaments AS (
    SELECT
      id,
      name,
      slug,
      created_at,
      settings
    FROM limited_tournaments
    ORDER BY created_at DESC, id DESC
    LIMIT GREATEST(p_limit, 0)
  ),
  has_extra AS (
    SELECT COUNT(*) > GREATEST(p_limit, 0) AS has_more
    FROM limited_tournaments
  ),
  rows_with_counts AS (
    SELECT
      pt.id AS tournament_id,
      pt.name,
      pt.slug,
      pt.created_at,
      pt.settings,
      'draft'::text AS status,
      COALESCE(events.events_count, 0)::integer AS events_count,
      COALESCE(teams.teams_count, 0)::integer AS teams_count,
      COALESCE(matches.matches_count, 0)::integer AS matches_count,
      NULL::text AS owner_name,
      NULL::uuid AS owner_account_id
    FROM page_tournaments pt
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS events_count
      FROM public.events e
      WHERE e.tournament_id = pt.id
        AND e.deleted_at IS NULL
    ) events ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS teams_count
      FROM public.teams team
      WHERE team.tournament_id = pt.id
        AND team.deleted_at IS NULL
    ) teams ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS matches_count
      FROM public.matches match_row
      WHERE match_row.tournament_id = pt.id
        AND match_row.deleted_at IS NULL
    ) matches ON true
  )
  SELECT json_build_object(
    'items', COALESCE(json_agg(
      json_build_object(
        'tournament_id', rwc.tournament_id,
        'name', rwc.name,
        'slug', rwc.slug,
        'created_at', rwc.created_at,
        'settings', rwc.settings,
        'status', rwc.status,
        'events_count', rwc.events_count,
        'teams_count', rwc.teams_count,
        'matches_count', rwc.matches_count,
        'owner_name', rwc.owner_name,
        'owner_account_id', rwc.owner_account_id
      )
      ORDER BY rwc.created_at DESC, rwc.tournament_id DESC
    ), '[]'::json),
    'next_cursor', (
      SELECT MIN(created_at)
      FROM rows_with_counts
    ),
    'has_more', (
      SELECT has_more
      FROM has_extra
    )
  )
  INTO result
  FROM rows_with_counts rwc;

  RETURN COALESCE(result, json_build_object(
    'items', '[]'::json,
    'next_cursor', NULL,
    'has_more', false
  ));
END;
$function$;
