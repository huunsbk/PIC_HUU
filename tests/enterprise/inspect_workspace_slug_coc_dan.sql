SELECT
  t.id AS tenant_id,
  t.name AS tenant_name,
  t.slug AS tenant_slug,
  count(tw.id) FILTER (WHERE tw.deleted_at IS NULL) AS active_tournament_count,
  COALESCE(json_agg(json_build_object('id', tw.id, 'name', tw.name, 'slug', tw.slug) ORDER BY tw.created_at DESC) FILTER (WHERE tw.id IS NOT NULL AND tw.deleted_at IS NULL), '[]'::json) AS tournaments
FROM public.tenants t
LEFT JOIN public.tournament tw ON tw.tenant_id = t.id
WHERE t.slug = 'coc-dan'
GROUP BY t.id, t.name, t.slug;
