SELECT
  tm.event_id,
  count(*) AS orphan_team_count,
  jsonb_agg(
    jsonb_build_object(
      'id', tm.id,
      'name', tm.name,
      'tournament_id', tm.tournament_id
    )
    ORDER BY tm.name
  ) AS sample_teams
FROM public.teams tm
LEFT JOIN public.events e ON e.id = tm.event_id
WHERE tm.event_id IS NOT NULL
  AND e.id IS NULL
GROUP BY tm.event_id
ORDER BY orphan_team_count DESC, tm.event_id;
