-- Phase 6B: expose only non-sensitive sport/ruleset metadata to public TV pages.

CREATE OR REPLACE FUNCTION public.list_active_sports_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'slug', s.slug,
    'scoring_type', s.scoring_type,
    'default_settings', s.default_settings,
    'default_ranking_config', s.default_ranking_config,
    'ruleset_version', s.ruleset_version,
    'capabilities', s.capabilities
  ) ORDER BY CASE s.id WHEN 'sport_pickleball' THEN 0 WHEN 'sport_badminton' THEN 1 ELSE 2 END, s.name), '[]'::jsonb)
  FROM public.sports s
  WHERE s.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.list_active_sports_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_active_sports_v1() TO anon, authenticated;
