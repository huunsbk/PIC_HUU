BEGIN;

DO $$
DECLARE
  v_user_id uuid;
  v_tournament_id text;
  v_event_id text;
  v_groups text[];
  v_match record;
  v_ko_match record;
  v_final record;
  v_winner text;
BEGIN
  SELECT a.user_id INTO v_user_id
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  WHERE r.name = 'SUPER_ADMIN'
    AND a.status = 'active'
    AND a.deleted_at IS NULL
  ORDER BY a.created_at
  LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  SELECT t.id INTO v_tournament_id
  FROM public.tournament t
  JOIN public.tenants tenant ON tenant.id = t.tenant_id
  WHERE t.deleted_at IS NULL
    AND t.status = 'active'
    AND tenant.deleted_at IS NULL
    AND tenant.status = 'active'
  ORDER BY t.created_at
  LIMIT 1;

  v_event_id := public.create_event_v1(
    v_tournament_id,
    'Cầu lông KO E2E rollback',
    'sport_badminton',
    'singles',
    'group_then_knockout',
    (SELECT default_settings FROM public.sports WHERE id = 'sport_badminton'),
    (SELECT default_ranking_config || '{"groupCount":2,"top_per_group":2}'::jsonb FROM public.sports WHERE id = 'sport_badminton')
  )->>'event_id';

  PERFORM public.create_team_v1(v_event_id, 'A', 'none');
  PERFORM public.create_team_v1(v_event_id, 'B', 'none');
  PERFORM public.create_team_v1(v_event_id, 'C', 'none');
  PERFORM public.create_team_v1(v_event_id, 'D', 'none');
  PERFORM public.setup_groups_v4(v_event_id, 2, 'balanced');
  PERFORM public.generate_schedule_v1(v_event_id);

  FOR v_match IN
    SELECT * FROM public.matches
    WHERE event_id = v_event_id
      AND group_id <> 'knockout'
      AND deleted_at IS NULL
    ORDER BY created_at
  LOOP
    PERFORM public.update_match_set_score_v1(v_match.id, 1, 21, 10);
    PERFORM public.update_match_set_score_v1(v_match.id, 2, 21, 12);
    PERFORM public.finalize_match_score_v1(v_match.id);
  END LOOP;

  SELECT array_agg(id ORDER BY name) INTO v_groups
  FROM public.groups
  WHERE event_id = v_event_id
    AND deleted_at IS NULL;

  PERFORM public.save_manual_knockout_bracket_v1(
    v_event_id,
    4,
    jsonb_build_array(
      jsonb_build_object(
        'match_index', 1,
        'slot_a', jsonb_build_object('source_type', 'group_rank', 'group_id', v_groups[1], 'group_rank', 1, 'label', 'Hạng 1 bảng A'),
        'slot_b', jsonb_build_object('source_type', 'group_rank', 'group_id', v_groups[2], 'group_rank', 2, 'label', 'Hạng 2 bảng B')
      ),
      jsonb_build_object(
        'match_index', 2,
        'slot_a', jsonb_build_object('source_type', 'group_rank', 'group_id', v_groups[2], 'group_rank', 1, 'label', 'Hạng 1 bảng B'),
        'slot_b', jsonb_build_object('source_type', 'group_rank', 'group_id', v_groups[1], 'group_rank', 2, 'label', 'Hạng 2 bảng A')
      )
    )
  );
  PERFORM public.resolve_knockout_slots_v1(v_event_id);

  SELECT * INTO v_ko_match
  FROM public.matches
  WHERE event_id = v_event_id
    AND group_id = 'knockout'
    AND round = 1
    AND deleted_at IS NULL
  ORDER BY display_order
  LIMIT 1;

  IF v_ko_match.team_a_id IS NULL OR v_ko_match.team_b_id IS NULL THEN
    RAISE EXCEPTION 'Badminton knockout rank slots did not resolve to real teams';
  END IF;

  PERFORM public.update_match_set_score_v1(v_ko_match.id, 1, 21, 14);
  PERFORM public.update_match_set_score_v1(v_ko_match.id, 2, 21, 17);
  PERFORM public.finalize_match_score_v1(v_ko_match.id);
  SELECT winner_id INTO v_winner FROM public.matches WHERE id = v_ko_match.id;

  SELECT * INTO v_final FROM public.matches WHERE id = v_ko_match.next_match_id;
  IF (v_ko_match.next_match_slot = 'A' AND v_final.team_a_id IS DISTINCT FROM v_winner)
     OR (v_ko_match.next_match_slot = 'B' AND v_final.team_b_id IS DISTINCT FROM v_winner) THEN
    RAISE EXCEPTION 'Badminton knockout winner did not propagate to the final';
  END IF;
END;
$$;

ROLLBACK;
