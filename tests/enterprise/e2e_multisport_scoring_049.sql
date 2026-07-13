BEGIN;

DO $$
DECLARE
  v_user_id uuid;
  v_tournament_id text;
  v_tournament_slug text;
  v_event_result jsonb;
  v_event_id text;
  v_team_a text;
  v_team_b text;
  v_match record;
  v_snapshot jsonb;
  v_case record;
BEGIN
  SELECT a.user_id
  INTO v_user_id
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  WHERE r.name = 'SUPER_ADMIN'
    AND a.status = 'active'
    AND a.deleted_at IS NULL
  ORDER BY a.created_at
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No active SUPER_ADMIN available for rollback E2E';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  SELECT t.id, t.slug
  INTO v_tournament_id, v_tournament_slug
  FROM public.tournament t
  JOIN public.tenants tenant ON tenant.id = t.tenant_id
  WHERE t.deleted_at IS NULL
    AND t.status = 'active'
    AND tenant.deleted_at IS NULL
    AND tenant.status = 'active'
  ORDER BY t.created_at
  LIMIT 1;

  IF v_tournament_id IS NULL THEN
    RAISE EXCEPTION 'No active tournament available for rollback E2E';
  END IF;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('sport_badminton'::text, 'Cầu lông E2E rollback'::text, 21, 15, 18, 21, 21, 19),
      ('sport_table_tennis'::text, 'Bóng bàn E2E rollback'::text, 11, 9, 8, 11, 11, 7)
    ) AS cases(sport_id, event_name, set1_a, set1_b, set2_a, set2_b, set3_a, set3_b)
  LOOP
    v_event_result := public.create_event_v1(
      v_tournament_id,
      v_case.event_name,
      v_case.sport_id,
      'singles',
      'round_robin_only',
      (SELECT default_settings FROM public.sports WHERE id = v_case.sport_id),
      (SELECT default_ranking_config || '{"groupCount":1}'::jsonb FROM public.sports WHERE id = v_case.sport_id)
    );
    v_event_id := v_event_result->>'event_id';

    v_team_a := public.create_team_v1(v_event_id, 'Đội A', 'none')->>'team_id';
    v_team_b := public.create_team_v1(v_event_id, 'Đội B', 'none')->>'team_id';
    PERFORM public.setup_groups_v4(v_event_id, 1, 'balanced');
    PERFORM public.generate_schedule_v1(v_event_id);

    SELECT * INTO v_match
    FROM public.matches
    WHERE event_id = v_event_id
      AND deleted_at IS NULL
    ORDER BY created_at
    LIMIT 1;

    IF v_match.id IS NULL OR v_match.team_a_id IS NULL OR v_match.team_b_id IS NULL THEN
      RAISE EXCEPTION 'Schedule did not create a resolvable match for %', v_case.sport_id;
    END IF;

    PERFORM public.update_match_set_score_v1(v_match.id, 1, v_case.set1_a, v_case.set1_b);
    PERFORM public.update_match_set_score_v1(v_match.id, 2, v_case.set2_a, v_case.set2_b);
    PERFORM public.update_match_set_score_v1(v_match.id, 3, v_case.set3_a, v_case.set3_b);
    PERFORM public.finalize_match_score_v1(v_match.id);

    SELECT * INTO v_match FROM public.matches WHERE id = v_match.id;
    IF v_match.status <> 'finished' OR v_match.score_a <> 2 OR v_match.score_b <> 1 OR v_match.winner_id <> v_match.team_a_id THEN
      RAISE EXCEPTION 'Finalized result is invalid for %', v_case.sport_id;
    END IF;

    BEGIN
      UPDATE public.events
      SET sport_id = 'sport_pickleball'
      WHERE id = v_event_id;
      RAISE EXCEPTION 'Sport change unexpectedly succeeded for scored event %', v_case.sport_id;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%SPORT_CHANGE_LOCKED%' THEN
        RAISE;
      END IF;
    END;

    v_snapshot := public.get_public_tournament_snapshot_v1(v_tournament_slug);
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(v_snapshot->'events', '[]'::jsonb)) event_row
      WHERE event_row->>'id' = v_event_id
        AND event_row->>'sport_id' = v_case.sport_id
    ) THEN
      RAISE EXCEPTION 'Public snapshot is missing sport metadata for %', v_case.sport_id;
    END IF;
  END LOOP;
END;
$$;

ROLLBACK;
