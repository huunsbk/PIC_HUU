WITH checks AS (
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
      FROM public.events e
      LEFT JOIN public.tournament t ON t.id = e.tournament_id
      WHERE e.tournament_id IS NOT NULL
        AND t.id IS NULL
    ) AS orphan_events_tournament_id_count,
    (
      SELECT count(*)
      FROM public.teams tm
      LEFT JOIN public.events e ON e.id = tm.event_id
      WHERE tm.event_id IS NOT NULL
        AND e.id IS NULL
    ) AS orphan_teams_event_id_count,
    (
      SELECT count(*)
      FROM public.groups g
      LEFT JOIN public.events e ON e.id = g.event_id
      WHERE g.event_id IS NOT NULL
        AND e.id IS NULL
    ) AS orphan_groups_event_id_count,
    (
      SELECT count(*)
      FROM public.matches m
      LEFT JOIN public.events e ON e.id = m.event_id
      WHERE m.event_id IS NOT NULL
        AND e.id IS NULL
    ) AS orphan_matches_event_id_count,
    (
      SELECT count(*)
      FROM public.match_sets ms
      LEFT JOIN public.events e ON e.id = ms.event_id
      WHERE ms.event_id IS NOT NULL
        AND e.id IS NULL
    ) AS orphan_match_sets_event_id_count,
    (
      SELECT count(*)
      FROM (
        SELECT tenant_id, slug, count(*) AS duplicate_count
        FROM public.tournament
        WHERE slug IS NOT NULL
          AND deleted_at IS NULL
        GROUP BY tenant_id, slug
        HAVING count(*) > 1
      ) duplicates
    ) AS duplicate_active_tournament_tenant_slug_count,
    (
      SELECT count(*)
      FROM (
        SELECT slug, count(*) AS duplicate_count
        FROM public.tenants
        WHERE slug IS NOT NULL
        GROUP BY slug
        HAVING count(*) > 1
      ) duplicates
    ) AS duplicate_tenant_slug_count
)
SELECT *
FROM checks;
