WITH target_groups AS (
  SELECT
    tournament.slug AS tournament_slug,
    event.id AS event_id,
    event.name AS event_name,
    group_row.id AS group_id,
    group_row.name AS group_name,
    (
      SELECT count(*)::integer
      FROM public.teams team
      WHERE team.group_id = group_row.id
        AND team.event_id = event.id
        AND team.deleted_at IS NULL
    ) AS active_teams
  FROM public.tournament
  JOIN public.events event
    ON event.tournament_id = tournament.id
   AND event.deleted_at IS NULL
  JOIN public.groups group_row
    ON group_row.event_id = event.id
   AND group_row.deleted_at IS NULL
  WHERE tournament.slug = 'giai-noi-bo-clb-lan-1-nam-2026'
    AND tournament.deleted_at IS NULL
), ordered_matches AS (
  SELECT
    target_groups.group_id,
    row_number() OVER (
      PARTITION BY target_groups.group_id
      ORDER BY match_row.display_order, match_row.id
    ) AS sequence_no,
    match_row.id,
    match_row.team_a_id,
    match_row.team_b_id
  FROM target_groups
  JOIN public.matches match_row
    ON match_row.group_id = target_groups.group_id
   AND match_row.event_id = target_groups.event_id
   AND match_row.deleted_at IS NULL
), adjacent_conflicts AS (
  SELECT
    current_match.group_id,
    count(*)::integer AS conflict_count
  FROM ordered_matches current_match
  JOIN ordered_matches next_match
    ON next_match.group_id = current_match.group_id
   AND next_match.sequence_no = current_match.sequence_no + 1
  WHERE current_match.team_a_id IN (next_match.team_a_id, next_match.team_b_id)
     OR current_match.team_b_id IN (next_match.team_a_id, next_match.team_b_id)
  GROUP BY current_match.group_id
)
SELECT
  target_groups.tournament_slug,
  target_groups.event_id,
  target_groups.event_name,
  target_groups.group_id,
  target_groups.group_name,
  target_groups.active_teams,
  count(match_row.id)::integer AS active_matches,
  count(DISTINCT match_row.round)::integer AS active_rounds,
  count(match_row.id) FILTER (
    WHERE match_row.status <> 'pending'
       OR match_row.score_a IS NOT NULL
       OR match_row.score_b IS NOT NULL
       OR EXISTS (
         SELECT 1
         FROM public.match_sets set_row
         WHERE set_row.match_id = match_row.id
           AND set_row.deleted_at IS NULL
           AND (set_row.score_a IS NOT NULL OR set_row.score_b IS NOT NULL)
       )
  )::integer AS protected_matches,
  bool_and(match_row.metadata->>'scheduling_mode' = 'round_robin_circle_v1') AS uses_circle_method,
  COALESCE(adjacent_conflicts.conflict_count, 0) AS adjacent_team_conflicts
FROM target_groups
LEFT JOIN public.matches match_row
  ON match_row.group_id = target_groups.group_id
 AND match_row.event_id = target_groups.event_id
 AND match_row.deleted_at IS NULL
LEFT JOIN adjacent_conflicts ON adjacent_conflicts.group_id = target_groups.group_id
GROUP BY
  target_groups.tournament_slug,
  target_groups.event_id,
  target_groups.event_name,
  target_groups.group_id,
  target_groups.group_name,
  target_groups.active_teams,
  adjacent_conflicts.conflict_count
ORDER BY target_groups.event_name, target_groups.group_name;
