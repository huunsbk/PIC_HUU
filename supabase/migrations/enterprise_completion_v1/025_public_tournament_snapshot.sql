-- Public read-only tournament snapshot for audience/TV viewer routes.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_tournament_snapshot_v1(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_tournament record;
  v_tenant record;
  v_event_ids text[] := ARRAY[]::text[];
BEGIN
  IF v_slug = '' THEN
    RAISE EXCEPTION 'PUBLIC_SLUG_REQUIRED';
  END IF;

  SELECT
    t.id,
    t.name,
    t.organization,
    t.location,
    t.date,
    t.settings,
    t.current_event_id,
    t.tenant_id,
    t.slug,
    t.status,
    t.start_date,
    t.created_at
  INTO v_tournament
  FROM public.tournament t
  JOIN public.tenants ten ON ten.id = t.tenant_id
  WHERE t.deleted_at IS NULL
    AND ten.deleted_at IS NULL
    AND (
      lower(t.slug::text) = v_slug
      OR lower(t.id::text) = v_slug
      OR lower(ten.slug::text) = v_slug
      OR lower(ten.id::text) = v_slug
    )
  ORDER BY
    CASE WHEN t.status = 'active' THEN 0 ELSE 1 END,
    t.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_tournament.id IS NULL THEN
    RAISE EXCEPTION 'PUBLIC_TOURNAMENT_NOT_FOUND';
  END IF;

  SELECT ten.id, ten.name, ten.slug, ten.status
  INTO v_tenant
  FROM public.tenants ten
  WHERE ten.id = v_tournament.tenant_id
    AND ten.deleted_at IS NULL
  LIMIT 1;

  IF v_tenant.id IS NULL THEN
    RAISE EXCEPTION 'PUBLIC_TENANT_NOT_FOUND';
  END IF;

  SELECT coalesce(array_agg(e.id ORDER BY e.created_at ASC NULLS LAST, e.name ASC), ARRAY[]::text[])
  INTO v_event_ids
  FROM public.events e
  WHERE e.tenant_id = v_tenant.id
    AND e.tournament_id = v_tournament.id
    AND e.deleted_at IS NULL
    AND coalesce(e.status, 'active') <> 'archived';

  RETURN jsonb_build_object(
    'success', true,
    'generated_at', now(),
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'name', v_tenant.name,
      'slug', v_tenant.slug,
      'status', v_tenant.status
    ),
    'tournament', jsonb_build_object(
      'id', v_tournament.id,
      'name', v_tournament.name,
      'organization', v_tournament.organization,
      'location', v_tournament.location,
      'date', v_tournament.date,
      'settings', coalesce(v_tournament.settings, '{}'::jsonb),
      'current_event_id', v_tournament.current_event_id,
      'tenant_id', v_tenant.id,
      'slug', v_tournament.slug,
      'status', v_tournament.status,
      'start_date', v_tournament.start_date
    ),
    'events', coalesce((
      SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.created_at ASC NULLS LAST, ev.name ASC)
      FROM (
        SELECT
          e.id,
          e.name,
          e.settings,
          e.active_group_id,
          e.advance_selection_mode,
          e.manual_qualified_team_ids,
          e.created_at,
          e.tenant_id,
          e.tournament_id,
          e.slug,
          e.status,
          e.sport_id,
          e.competition_type,
          e.format_type,
          e.scoring_config,
          e.ranking_config,
          e.schedule_config
        FROM public.events e
        WHERE e.id = ANY(v_event_ids)
          AND e.deleted_at IS NULL
      ) ev
    ), '[]'::jsonb),
    'teams', coalesce((
      SELECT jsonb_agg(to_jsonb(tm) ORDER BY tm.event_id ASC, tm.name ASC)
      FROM (
        SELECT
          t.id,
          t.name,
          t.group_id,
          t.seed,
          t.event_id,
          t.created_at,
          t.tenant_id,
          t.tournament_id
        FROM public.teams t
        WHERE t.tenant_id = v_tenant.id
          AND t.tournament_id = v_tournament.id
          AND t.event_id = ANY(v_event_ids)
          AND t.deleted_at IS NULL
      ) tm
    ), '[]'::jsonb),
    'groups', coalesce((
      SELECT jsonb_agg(to_jsonb(gr) ORDER BY gr.event_id ASC, gr.name ASC)
      FROM (
        SELECT
          g.id,
          g.name,
          g.team_ids,
          g.event_id,
          g.created_at,
          g.tenant_id,
          g.tournament_id
        FROM public.groups g
        WHERE g.tenant_id = v_tenant.id
          AND g.tournament_id = v_tournament.id
          AND g.event_id = ANY(v_event_ids)
          AND g.deleted_at IS NULL
      ) gr
    ), '[]'::jsonb),
    'matches', coalesce((
      SELECT jsonb_agg(to_jsonb(mt) ORDER BY mt.event_id ASC, mt.display_order ASC NULLS LAST, mt.round ASC NULLS LAST, mt.slot_number ASC NULLS LAST, mt.court_number ASC NULLS LAST, mt.created_at ASC NULLS LAST)
      FROM (
        SELECT
          m.id,
          m.group_id,
          m.team_a_id,
          m.team_b_id,
          m.score_a,
          m.score_b,
          m.winner_id,
          m.status,
          m.round,
          m.knockout_round_name,
          m.knockout_match_id,
          m.next_match_id,
          m.next_match_slot,
          m.event_id,
          m.created_at,
          m.tenant_id,
          m.tournament_id,
          m.placeholder_a,
          m.placeholder_b,
          m.court_number,
          m.slot_number,
          m.display_order,
          m.metadata
        FROM public.matches m
        WHERE m.tenant_id = v_tenant.id
          AND m.tournament_id = v_tournament.id
          AND m.event_id = ANY(v_event_ids)
          AND m.deleted_at IS NULL
      ) mt
    ), '[]'::jsonb),
    'match_sets', coalesce((
      SELECT jsonb_agg(to_jsonb(ms) ORDER BY ms.event_id ASC, ms.match_id ASC, ms.set_number ASC)
      FROM (
        SELECT
          s.id,
          s.match_id,
          s.tenant_id,
          s.event_id,
          s.set_number,
          s.score_a,
          s.score_b,
          s.winner_id,
          s.status,
          s.created_at,
          s.updated_at
        FROM public.match_sets s
        WHERE s.tenant_id = v_tenant.id
          AND s.event_id = ANY(v_event_ids)
          AND s.deleted_at IS NULL
      ) ms
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_tournament_snapshot_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_snapshot_v1(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_snapshot_v1(text) TO authenticated;

COMMIT;
