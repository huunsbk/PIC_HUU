-- Enterprise Completion V1 - Prompt 05
-- Core RPC/RLS/audit/scoring foundation.
--
-- Safety:
-- - Does not reset business data.
-- - Does not touch auth.users.
-- - Locks direct client writes to public.match_sets.
-- - All business writes below go through SECURITY DEFINER RPCs.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.current_account_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT a.id
  FROM public.accounts a
  WHERE a.user_id = auth.uid()
    AND a.deleted_at IS NULL
    AND a.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT a.tenant_id
  FROM public.accounts a
  WHERE a.user_id = auth.uid()
    AND a.deleted_at IS NULL
    AND a.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_role_name()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT r.name
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  WHERE a.user_id = auth.uid()
    AND a.deleted_at IS NULL
    AND a.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_permission(perm_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.user_id = auth.uid()
      AND a.deleted_at IS NULL
      AND a.status = 'active'
      AND (
        EXISTS (
          SELECT 1
          FROM public.account_permissions ap
          JOIN public.permissions p ON p.id = ap.permission_id
          WHERE ap.account_id = a.id
            AND p.name = perm_name
        )
        OR EXISTS (
          SELECT 1
          FROM public.role_permissions rp
          JOIN public.permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = a.role_id
            AND p.name = perm_name
        )
        OR EXISTS (
          SELECT 1
          FROM public.role_permissions rp
          JOIN public.permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = a.role_id
            AND p.name = '*'
        )
      )
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.has_event_access(check_event_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  WITH current_context AS (
    SELECT
      a.id AS account_id,
      a.tenant_id,
      r.name AS role_name
    FROM public.accounts a
    JOIN public.roles r ON r.id = a.role_id
    WHERE a.user_id = auth.uid()
      AND a.deleted_at IS NULL
      AND a.status = 'active'
    LIMIT 1
  ),
  target_event AS (
    SELECT e.id, e.tenant_id
    FROM public.events e
    WHERE e.id = check_event_id
      AND e.deleted_at IS NULL
    LIMIT 1
  )
  SELECT COALESCE((
    SELECT
      CASE
        WHEN cc.account_id IS NULL THEN false
        WHEN te.id IS NULL THEN false
        WHEN cc.role_name = 'SUPER_ADMIN' THEN true
        WHEN cc.role_name = 'TENANT_ADMIN' AND te.tenant_id = cc.tenant_id THEN true
        WHEN cc.role_name IN ('EVENT_ADMIN', 'REFEREE')
          AND te.tenant_id = cc.tenant_id
          AND EXISTS (
            SELECT 1
            FROM public.account_event_permissions aep
            WHERE aep.account_id = cc.account_id
              AND aep.event_id = te.id
              AND aep.deleted_at IS NULL
          )
          THEN true
        ELSE false
      END
    FROM current_context cc
    CROSS JOIN target_event te
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.log_audit_event_v1(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
  v_tenant_id uuid;
  v_details jsonb;
  v_audit_id bigint;
BEGIN
  v_account_id := public.current_account_id();
  v_tenant_id := public.current_tenant_id();

  IF auth.uid() IS NULL OR v_account_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF p_action IS NULL OR btrim(p_action) = '' THEN
    RAISE EXCEPTION 'p_action is required';
  END IF;

  IF to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION 'audit_logs table is missing';
  END IF;

  v_details := jsonb_build_object(
    'account_id', v_account_id,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'payload', COALESCE(p_payload, '{}'::jsonb)
  );

  INSERT INTO public.audit_logs (
    timestamp,
    action,
    details,
    created_at,
    tenant_id
  )
  VALUES (
    to_char(now(), 'HH24:MI:SS DD/MM/YYYY'),
    p_action,
    v_details::text,
    now(),
    v_tenant_id
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'success', true,
    'audit_id', v_audit_id,
    'action', p_action,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_event_access_v1(
  p_account_id uuid,
  p_event_id text,
  p_role_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_actor_account_id uuid;
  v_actor_tenant_id uuid;
  v_actor_role text;
  v_event_tenant_id uuid;
  v_target_tenant_id uuid;
  v_target_role_id uuid;
  v_normalized_role text;
BEGIN
  v_actor_account_id := public.current_account_id();
  v_actor_tenant_id := public.current_tenant_id();
  v_actor_role := public.current_role_name();
  v_normalized_role := upper(btrim(COALESCE(p_role_name, '')));

  IF auth.uid() IS NULL OR v_actor_account_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF v_normalized_role NOT IN ('EVENT_ADMIN', 'REFEREE', 'VIEWER') THEN
    RAISE EXCEPTION 'Invalid event role: %', p_role_name;
  END IF;

  SELECT tenant_id INTO v_event_tenant_id
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_event_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  SELECT tenant_id INTO v_target_tenant_id
  FROM public.accounts
  WHERE id = p_account_id
    AND deleted_at IS NULL
    AND status = 'active'
  LIMIT 1;

  IF v_target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF v_target_tenant_id <> v_event_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant event access grant is not allowed';
  END IF;

  IF NOT (
    v_actor_role = 'SUPER_ADMIN'
    OR (v_actor_role = 'TENANT_ADMIN' AND v_actor_tenant_id = v_event_tenant_id)
    OR (
      public.has_permission('manage_events')
      AND public.has_event_access(p_event_id)
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied for grant_event_access_v1';
  END IF;

  SELECT id INTO v_target_role_id
  FROM public.roles
  WHERE name = v_normalized_role
  LIMIT 1;

  IF v_target_role_id IS NULL THEN
    RAISE EXCEPTION 'Role not found: %', v_normalized_role;
  END IF;

  UPDATE public.accounts
  SET role_id = v_target_role_id,
      updated_at = now()
  WHERE id = p_account_id;

  INSERT INTO public.account_event_permissions (
    account_id,
    event_id,
    created_at,
    deleted_at
  )
  VALUES (
    p_account_id,
    p_event_id,
    now(),
    NULL
  )
  ON CONFLICT (account_id, event_id) DO UPDATE
  SET deleted_at = NULL;

  PERFORM public.log_audit_event_v1(
    'GRANT_EVENT_ACCESS',
    'event',
    p_event_id,
    jsonb_build_object(
      'target_account_id', p_account_id,
      'role_name', v_normalized_role
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'account_id', p_account_id,
    'event_id', p_event_id,
    'role_name', v_normalized_role
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_event_access_v1(
  p_account_id uuid,
  p_event_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_actor_account_id uuid;
  v_actor_tenant_id uuid;
  v_actor_role text;
  v_event_tenant_id uuid;
  v_target_tenant_id uuid;
  v_rows integer := 0;
BEGIN
  v_actor_account_id := public.current_account_id();
  v_actor_tenant_id := public.current_tenant_id();
  v_actor_role := public.current_role_name();

  IF auth.uid() IS NULL OR v_actor_account_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT tenant_id INTO v_event_tenant_id
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_event_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  SELECT tenant_id INTO v_target_tenant_id
  FROM public.accounts
  WHERE id = p_account_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_target_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF v_target_tenant_id <> v_event_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant event access revoke is not allowed';
  END IF;

  IF NOT (
    v_actor_role = 'SUPER_ADMIN'
    OR (v_actor_role = 'TENANT_ADMIN' AND v_actor_tenant_id = v_event_tenant_id)
    OR (
      public.has_permission('manage_events')
      AND public.has_event_access(p_event_id)
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied for revoke_event_access_v1';
  END IF;

  UPDATE public.account_event_permissions
  SET deleted_at = now()
  WHERE account_id = p_account_id
    AND event_id = p_event_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  PERFORM public.log_audit_event_v1(
    'REVOKE_EVENT_ACCESS',
    'event',
    p_event_id,
    jsonb_build_object(
      'target_account_id', p_account_id,
      'revoked_rows', v_rows
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'account_id', p_account_id,
    'event_id', p_event_id,
    'revoked_rows', v_rows
  );
END;
$$;

DROP POLICY IF EXISTS match_sets_insert_scoped ON public.match_sets;
DROP POLICY IF EXISTS match_sets_update_scoped ON public.match_sets;
DROP POLICY IF EXISTS match_sets_delete_scoped ON public.match_sets;

DROP POLICY IF EXISTS match_sets_select_scoped ON public.match_sets;
CREATE POLICY match_sets_select_scoped
ON public.match_sets
FOR SELECT
TO authenticated
USING (
  public.current_role_name() = 'SUPER_ADMIN'
  OR tenant_id = public.current_tenant_id()
  OR public.has_event_access(event_id)
);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.match_sets FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.match_sets FROM authenticated;
GRANT SELECT ON public.match_sets TO authenticated;

CREATE OR REPLACE FUNCTION public.update_event_config_v1(
  p_event_id text,
  p_sport_id text,
  p_competition_type text,
  p_format_type text,
  p_scoring_config jsonb,
  p_ranking_config jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
  v_tenant_id uuid;
  v_role text;
  v_event record;
  v_old_config jsonb;
  v_mode text;
  v_number_of_sets integer;
  v_sets_to_win integer;
  v_max_score integer;
  v_cap_score integer;
BEGIN
  v_account_id := public.current_account_id();
  v_tenant_id := public.current_tenant_id();
  v_role := public.current_role_name();

  IF auth.uid() IS NULL OR v_account_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT *
    INTO v_event
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_role = 'REFEREE' OR v_role = 'VIEWER' THEN
    RAISE EXCEPTION 'Permission denied for update_event_config_v1';
  END IF;

  IF NOT (
    v_role = 'SUPER_ADMIN'
    OR (v_role = 'TENANT_ADMIN' AND v_event.tenant_id = v_tenant_id)
    OR (v_role = 'EVENT_ADMIN' AND public.has_event_access(p_event_id))
  ) THEN
    RAISE EXCEPTION 'Permission denied for update_event_config_v1';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sports
    WHERE id = p_sport_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Sport not found';
  END IF;

  IF p_format_type NOT IN ('round_robin_only', 'knockout_only', 'group_then_knockout') THEN
    RAISE EXCEPTION 'Invalid format_type: %', p_format_type;
  END IF;

  IF p_competition_type NOT IN ('singles', 'doubles', 'team', 'individual_time', 'custom') THEN
    RAISE EXCEPTION 'Invalid competition_type: %', p_competition_type;
  END IF;

  IF p_scoring_config IS NULL OR jsonb_typeof(p_scoring_config) <> 'object' THEN
    RAISE EXCEPTION 'scoring_config must be a json object';
  END IF;

  IF p_ranking_config IS NULL OR jsonb_typeof(p_ranking_config) <> 'object' THEN
    RAISE EXCEPTION 'ranking_config must be a json object';
  END IF;

  v_mode := p_scoring_config->>'matchSetMode';
  IF v_mode NOT IN ('single', 'best_of_3') THEN
    RAISE EXCEPTION 'Invalid matchSetMode: %', v_mode;
  END IF;

  IF jsonb_typeof(p_scoring_config->'numberOfSets') <> 'number' THEN
    RAISE EXCEPTION 'numberOfSets must be numeric';
  END IF;
  IF jsonb_typeof(p_scoring_config->'setsToWin') <> 'number' THEN
    RAISE EXCEPTION 'setsToWin must be numeric';
  END IF;
  IF jsonb_typeof(p_scoring_config->'maxScore') <> 'number' THEN
    RAISE EXCEPTION 'maxScore must be numeric';
  END IF;
  IF jsonb_typeof(p_scoring_config->'capScore') <> 'number' THEN
    RAISE EXCEPTION 'capScore must be numeric';
  END IF;

  v_number_of_sets := (p_scoring_config->>'numberOfSets')::integer;
  v_sets_to_win := (p_scoring_config->>'setsToWin')::integer;
  v_max_score := (p_scoring_config->>'maxScore')::integer;
  v_cap_score := (p_scoring_config->>'capScore')::integer;

  IF v_mode = 'single' AND NOT (v_number_of_sets = 1 AND v_sets_to_win = 1) THEN
    RAISE EXCEPTION 'single mode requires numberOfSets=1 and setsToWin=1';
  END IF;

  IF v_mode = 'best_of_3' AND NOT (v_number_of_sets = 3 AND v_sets_to_win = 2) THEN
    RAISE EXCEPTION 'best_of_3 mode requires numberOfSets=3 and setsToWin=2';
  END IF;

  IF v_max_score <= 0 THEN
    RAISE EXCEPTION 'maxScore must be greater than 0';
  END IF;

  IF v_cap_score < v_max_score THEN
    RAISE EXCEPTION 'capScore must be greater than or equal to maxScore';
  END IF;

  IF p_scoring_config ? 'winByTwo'
     AND jsonb_typeof(p_scoring_config->'winByTwo') <> 'boolean' THEN
    RAISE EXCEPTION 'winByTwo must be boolean';
  END IF;

  IF p_scoring_config ? 'allowDraw'
     AND jsonb_typeof(p_scoring_config->'allowDraw') <> 'boolean' THEN
    RAISE EXCEPTION 'allowDraw must be boolean';
  END IF;

  v_old_config := jsonb_build_object(
    'sport_id', v_event.sport_id,
    'competition_type', v_event.competition_type,
    'format_type', v_event.format_type,
    'scoring_config', v_event.scoring_config,
    'ranking_config', v_event.ranking_config
  );

  UPDATE public.events
  SET sport_id = p_sport_id,
      competition_type = p_competition_type,
      format_type = p_format_type,
      scoring_config = p_scoring_config,
      ranking_config = p_ranking_config
  WHERE id = p_event_id;

  PERFORM public.log_audit_event_v1(
    'UPDATE_EVENT_CONFIG',
    'event',
    p_event_id,
    jsonb_build_object(
      'old', v_old_config,
      'new', jsonb_build_object(
        'sport_id', p_sport_id,
        'competition_type', p_competition_type,
        'format_type', p_format_type,
        'scoring_config', p_scoring_config,
        'ranking_config', p_ranking_config
      )
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'sport_id', p_sport_id,
    'format_type', p_format_type,
    'competition_type', p_competition_type,
    'scoring_config', p_scoring_config,
    'ranking_config', p_ranking_config
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_match_score_v1(
  p_match_id text,
  p_score_a integer,
  p_score_b integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
  v_tenant_id uuid;
  v_role text;
  v_match record;
  v_event record;
  v_config jsonb;
  v_mode text;
  v_max_score integer;
  v_cap_score integer;
  v_win_by_two boolean;
  v_allow_draw boolean;
  v_winner_id text;
  v_winner_score integer;
  v_loser_score integer;
BEGIN
  v_account_id := public.current_account_id();
  v_tenant_id := public.current_tenant_id();
  v_role := public.current_role_name();

  IF auth.uid() IS NULL OR v_account_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT m.*
    INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  SELECT e.*
    INTO v_event
  FROM public.events e
  WHERE e.id = v_match.event_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_role <> 'SUPER_ADMIN' AND v_match.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'Match not found for current tenant';
  END IF;

  IF NOT (
    v_role = 'SUPER_ADMIN'
    OR (v_role = 'TENANT_ADMIN' AND v_match.tenant_id = v_tenant_id)
    OR (
      v_role IN ('EVENT_ADMIN', 'REFEREE')
      AND public.has_event_access(v_match.event_id)
      AND (
        public.has_permission('enter_scores')
        OR public.has_permission('manage_matches')
      )
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied for update_match_score_v1';
  END IF;

  v_config := CASE
    WHEN v_event.scoring_config = '{}'::jsonb THEN (
      SELECT default_settings
      FROM public.sports
      WHERE id = COALESCE(v_event.sport_id, 'sport_pickleball')
    )
    ELSE v_event.scoring_config
  END;

  v_mode := COALESCE(v_config->>'matchSetMode', 'single');
  IF v_mode <> 'single' THEN
    RAISE EXCEPTION 'update_match_score_v1 is only for single-set events';
  END IF;

  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Scores must be non-negative integers';
  END IF;

  v_max_score := COALESCE((v_config->>'maxScore')::integer, 15);
  v_cap_score := COALESCE((v_config->>'capScore')::integer, v_max_score);
  v_win_by_two := COALESCE((v_config->>'winByTwo')::boolean, true);
  v_allow_draw := COALESCE((v_config->>'allowDraw')::boolean, false);

  IF p_score_a > v_cap_score OR p_score_b > v_cap_score THEN
    RAISE EXCEPTION 'Score exceeds capScore';
  END IF;

  IF p_score_a = p_score_b AND NOT v_allow_draw THEN
    RAISE EXCEPTION 'Draw is not allowed for this event';
  END IF;

  IF p_score_a > p_score_b THEN
    v_winner_id := v_match.team_a_id;
    v_winner_score := p_score_a;
    v_loser_score := p_score_b;
  ELSIF p_score_b > p_score_a THEN
    v_winner_id := v_match.team_b_id;
    v_winner_score := p_score_b;
    v_loser_score := p_score_a;
  ELSE
    v_winner_id := NULL;
    v_winner_score := p_score_a;
    v_loser_score := p_score_b;
  END IF;

  IF v_winner_id IS NULL AND NOT v_allow_draw THEN
    RAISE EXCEPTION 'Winner could not be determined';
  END IF;

  IF v_winner_id IS NOT NULL THEN
    IF v_winner_score < v_max_score THEN
      RAISE EXCEPTION 'Winner score must reach maxScore';
    END IF;

    IF v_win_by_two THEN
      IF v_winner_score < v_cap_score AND (v_winner_score - v_loser_score) < 2 THEN
        RAISE EXCEPTION 'Winner must lead by two before capScore';
      END IF;

      IF v_winner_score = v_cap_score AND (v_winner_score - v_loser_score) < 1 THEN
        RAISE EXCEPTION 'Winner must lead at capScore';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.match_sets (
    match_id,
    tenant_id,
    event_id,
    set_number,
    score_a,
    score_b,
    winner_id,
    status,
    updated_at,
    deleted_at
  )
  VALUES (
    p_match_id,
    v_match.tenant_id,
    v_match.event_id,
    1,
    p_score_a,
    p_score_b,
    v_winner_id,
    'finished',
    now(),
    NULL
  )
  ON CONFLICT (match_id, set_number) DO UPDATE
  SET score_a = EXCLUDED.score_a,
      score_b = EXCLUDED.score_b,
      winner_id = EXCLUDED.winner_id,
      status = 'finished',
      updated_at = now(),
      deleted_at = NULL;

  UPDATE public.matches
  SET score_a = CASE WHEN v_winner_id = v_match.team_a_id THEN 1 WHEN v_winner_id = v_match.team_b_id THEN 0 ELSE 0 END,
      score_b = CASE WHEN v_winner_id = v_match.team_b_id THEN 1 WHEN v_winner_id = v_match.team_a_id THEN 0 ELSE 0 END,
      winner_id = v_winner_id,
      status = 'finished'
  WHERE id = p_match_id;

  PERFORM public.log_audit_event_v1(
    'UPDATE_MATCH_SCORE',
    'match',
    p_match_id,
    jsonb_build_object(
      'event_id', v_match.event_id,
      'score_a', p_score_a,
      'score_b', p_score_b,
      'winner_id', v_winner_id,
      'matchSetMode', 'single'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'match_id', p_match_id,
    'winner_id', v_winner_id,
    'score_a', CASE WHEN v_winner_id = v_match.team_a_id THEN 1 WHEN v_winner_id = v_match.team_b_id THEN 0 ELSE 0 END,
    'score_b', CASE WHEN v_winner_id = v_match.team_b_id THEN 1 WHEN v_winner_id = v_match.team_a_id THEN 0 ELSE 0 END,
    'status', 'finished'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_match_set_score_v1(
  p_match_id text,
  p_set_number integer,
  p_score_a integer,
  p_score_b integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
  v_tenant_id uuid;
  v_role text;
  v_match record;
  v_event record;
  v_config jsonb;
  v_mode text;
  v_max_score integer;
  v_cap_score integer;
  v_win_by_two boolean;
  v_allow_draw boolean;
  v_set_winner_id text;
  v_winner_score integer;
  v_loser_score integer;
  v_sets_a integer;
  v_sets_b integer;
  v_match_winner_id text;
  v_match_status text;
BEGIN
  v_account_id := public.current_account_id();
  v_tenant_id := public.current_tenant_id();
  v_role := public.current_role_name();

  IF auth.uid() IS NULL OR v_account_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF p_set_number NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'p_set_number must be 1, 2, or 3';
  END IF;

  SELECT m.*
    INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  IF v_match.status = 'finished' THEN
    RAISE EXCEPTION 'Match is already finished; reset before editing scores';
  END IF;

  SELECT e.*
    INTO v_event
  FROM public.events e
  WHERE e.id = v_match.event_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found';
  END IF;

  IF v_role <> 'SUPER_ADMIN' AND v_match.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'Match not found for current tenant';
  END IF;

  IF NOT (
    v_role = 'SUPER_ADMIN'
    OR (v_role = 'TENANT_ADMIN' AND v_match.tenant_id = v_tenant_id)
    OR (
      v_role IN ('EVENT_ADMIN', 'REFEREE')
      AND public.has_event_access(v_match.event_id)
      AND (
        public.has_permission('enter_scores')
        OR public.has_permission('manage_matches')
      )
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied for update_match_set_score_v1';
  END IF;

  v_config := CASE
    WHEN v_event.scoring_config = '{}'::jsonb THEN (
      SELECT default_settings
      FROM public.sports
      WHERE id = COALESCE(v_event.sport_id, 'sport_pickleball')
    )
    ELSE v_event.scoring_config
  END;

  v_mode := COALESCE(v_config->>'matchSetMode', 'single');
  IF v_mode <> 'best_of_3' THEN
    RAISE EXCEPTION 'update_match_set_score_v1 is only for best_of_3 events';
  END IF;

  SELECT
    count(*) FILTER (WHERE winner_id = v_match.team_a_id),
    count(*) FILTER (WHERE winner_id = v_match.team_b_id)
    INTO v_sets_a, v_sets_b
  FROM public.match_sets
  WHERE match_id = p_match_id
    AND deleted_at IS NULL;

  IF p_set_number = 3 AND (v_sets_a >= 2 OR v_sets_b >= 2) THEN
    RAISE EXCEPTION 'Set 3 is not allowed after a 2-0 result';
  END IF;

  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Scores must be non-negative integers';
  END IF;

  v_max_score := COALESCE((v_config->>'maxScore')::integer, 15);
  v_cap_score := COALESCE((v_config->>'capScore')::integer, v_max_score);
  v_win_by_two := COALESCE((v_config->>'winByTwo')::boolean, true);
  v_allow_draw := COALESCE((v_config->>'allowDraw')::boolean, false);

  IF p_score_a > v_cap_score OR p_score_b > v_cap_score THEN
    RAISE EXCEPTION 'Score exceeds capScore';
  END IF;

  IF p_score_a = p_score_b AND NOT v_allow_draw THEN
    RAISE EXCEPTION 'Draw is not allowed for this event';
  END IF;

  IF p_score_a > p_score_b THEN
    v_set_winner_id := v_match.team_a_id;
    v_winner_score := p_score_a;
    v_loser_score := p_score_b;
  ELSIF p_score_b > p_score_a THEN
    v_set_winner_id := v_match.team_b_id;
    v_winner_score := p_score_b;
    v_loser_score := p_score_a;
  ELSE
    v_set_winner_id := NULL;
    v_winner_score := p_score_a;
    v_loser_score := p_score_b;
  END IF;

  IF v_set_winner_id IS NULL AND NOT v_allow_draw THEN
    RAISE EXCEPTION 'Set winner could not be determined';
  END IF;

  IF v_set_winner_id IS NOT NULL THEN
    IF v_winner_score < v_max_score THEN
      RAISE EXCEPTION 'Winner score must reach maxScore';
    END IF;

    IF v_win_by_two THEN
      IF v_winner_score < v_cap_score AND (v_winner_score - v_loser_score) < 2 THEN
        RAISE EXCEPTION 'Winner must lead by two before capScore';
      END IF;

      IF v_winner_score = v_cap_score AND (v_winner_score - v_loser_score) < 1 THEN
        RAISE EXCEPTION 'Winner must lead at capScore';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.match_sets (
    match_id,
    tenant_id,
    event_id,
    set_number,
    score_a,
    score_b,
    winner_id,
    status,
    updated_at,
    deleted_at
  )
  VALUES (
    p_match_id,
    v_match.tenant_id,
    v_match.event_id,
    p_set_number,
    p_score_a,
    p_score_b,
    v_set_winner_id,
    'finished',
    now(),
    NULL
  )
  ON CONFLICT (match_id, set_number) DO UPDATE
  SET score_a = EXCLUDED.score_a,
      score_b = EXCLUDED.score_b,
      winner_id = EXCLUDED.winner_id,
      status = 'finished',
      updated_at = now(),
      deleted_at = NULL;

  SELECT
    count(*) FILTER (WHERE winner_id = v_match.team_a_id),
    count(*) FILTER (WHERE winner_id = v_match.team_b_id)
    INTO v_sets_a, v_sets_b
  FROM public.match_sets
  WHERE match_id = p_match_id
    AND deleted_at IS NULL;

  IF v_sets_a >= 2 THEN
    v_match_winner_id := v_match.team_a_id;
    v_match_status := 'finished';
  ELSIF v_sets_b >= 2 THEN
    v_match_winner_id := v_match.team_b_id;
    v_match_status := 'finished';
  ELSE
    v_match_winner_id := NULL;
    v_match_status := 'in_progress';
  END IF;

  UPDATE public.matches
  SET score_a = v_sets_a,
      score_b = v_sets_b,
      winner_id = v_match_winner_id,
      status = v_match_status
  WHERE id = p_match_id;

  PERFORM public.log_audit_event_v1(
    'UPDATE_MATCH_SET_SCORE',
    'match',
    p_match_id,
    jsonb_build_object(
      'event_id', v_match.event_id,
      'set_number', p_set_number,
      'score_a', p_score_a,
      'score_b', p_score_b,
      'set_winner_id', v_set_winner_id,
      'match_winner_id', v_match_winner_id,
      'match_status', v_match_status,
      'matchSetMode', 'best_of_3'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'match_id', p_match_id,
    'set_number', p_set_number,
    'match_status', v_match_status,
    'winner_id', v_match_winner_id,
    'score_a', v_sets_a,
    'score_b', v_sets_b
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_match_score_v1(
  p_match_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_account_id uuid;
  v_tenant_id uuid;
  v_role text;
  v_match record;
  v_reset_sets integer := 0;
BEGIN
  v_account_id := public.current_account_id();
  v_tenant_id := public.current_tenant_id();
  v_role := public.current_role_name();

  IF auth.uid() IS NULL OR v_account_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT m.*
    INTO v_match
  FROM public.matches m
  WHERE m.id = p_match_id
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  IF v_role <> 'SUPER_ADMIN' AND v_match.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'Match not found for current tenant';
  END IF;

  IF NOT (
    v_role = 'SUPER_ADMIN'
    OR (v_role = 'TENANT_ADMIN' AND v_match.tenant_id = v_tenant_id)
    OR (
      v_role IN ('EVENT_ADMIN', 'REFEREE')
      AND public.has_event_access(v_match.event_id)
      AND (
        public.has_permission('enter_scores')
        OR public.has_permission('manage_matches')
      )
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied for reset_match_score_v1';
  END IF;

  UPDATE public.match_sets
  SET deleted_at = now(),
      status = 'pending',
      updated_at = now()
  WHERE match_id = p_match_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_reset_sets = ROW_COUNT;

  UPDATE public.matches
  SET score_a = NULL,
      score_b = NULL,
      winner_id = NULL,
      status = 'pending'
  WHERE id = p_match_id;

  PERFORM public.log_audit_event_v1(
    'RESET_MATCH_SCORE',
    'match',
    p_match_id,
    jsonb_build_object(
      'event_id', v_match.event_id,
      'reset_sets', v_reset_sets,
      'knockout_downstream_reset', 'TODO: downstream knockout reset is not implemented in Prompt 05'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'match_id', p_match_id,
    'status', 'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit_event_v1(text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_audit_event_v1(text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_audit_event_v1(text, text, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.grant_event_access_v1(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_event_access_v1(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_event_access_v1(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_event_access_v1(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_event_access_v1(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_event_access_v1(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_event_config_v1(text, text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_event_config_v1(text, text, text, text, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_event_config_v1(text, text, text, text, jsonb, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.update_match_score_v1(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_match_score_v1(text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_match_score_v1(text, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.update_match_set_score_v1(text, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_match_set_score_v1(text, integer, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_match_set_score_v1(text, integer, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.reset_match_score_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_match_score_v1(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reset_match_score_v1(text) TO authenticated;

COMMIT;
