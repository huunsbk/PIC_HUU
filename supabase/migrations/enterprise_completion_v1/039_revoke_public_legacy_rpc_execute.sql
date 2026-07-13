-- Follow-up to 038: some legacy functions still remained executable by anon
-- through PUBLIC function privileges. Revoke from both PUBLIC and anon.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.archive_tournament_workspace_v6(text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.archive_tournament_workspace_v6(text) FROM PUBLIC, anon;
  END IF;

  IF to_regprocedure('public.create_tournament_workspace_v6(text,text,text,uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.create_tournament_workspace_v6(text,text,text,uuid) FROM PUBLIC, anon;
  END IF;

  IF to_regprocedure('public.transfer_tournament_owner_v6(text,uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.transfer_tournament_owner_v6(text,uuid) FROM PUBLIC, anon;
  END IF;

  IF to_regprocedure('public.create_event_admin(uuid,text,text,text,text,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.create_event_admin(uuid,text,text,text,text,text) FROM PUBLIC, anon;
  END IF;

  IF to_regprocedure('public.assign_team_to_group_v1(text,text,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.assign_team_to_group_v1(text,text,text) FROM PUBLIC, anon;
  END IF;

  IF to_regprocedure('public.dissolve_groups_v2(text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.dissolve_groups_v2(text) FROM PUBLIC, anon;
  END IF;

  IF to_regprocedure('public.setup_groups_v2(text,integer)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.setup_groups_v2(text,integer) FROM PUBLIC, anon;
  END IF;

  IF to_regprocedure('public.setup_groups_v3(text,integer,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.setup_groups_v3(text,integer,text) FROM PUBLIC, anon;
  END IF;

  IF to_regprocedure('public.record_login_session_v1()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.record_login_session_v1() FROM PUBLIC, anon;
  END IF;
END $$;

-- Keep the public tournament read path callable by anon.
GRANT EXECUTE ON FUNCTION public.get_public_tournament_snapshot_v1(text) TO anon;

COMMIT;
