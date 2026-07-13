-- Phase 4 security hardening:
-- - Keep public read RPCs intact.
-- - Remove anon direct write surface on core business tables.
-- - Remove anon execute surface from legacy mutation/admin RPCs.

BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE
  public.accounts,
  public.account_event_permissions,
  public.active_sessions,
  public.audit_logs,
  public.events,
  public.groups,
  public.matches,
  public.match_sets,
  public.knockout_slots,
  public.teams,
  public.tenants,
  public.tournament
FROM anon;

-- Legacy workspace/admin mutation RPCs. Authenticated users keep existing grants;
-- anon should not be able to call these SECURITY DEFINER mutation functions.
DO $$
BEGIN
  IF to_regprocedure('public.archive_tournament_workspace_v6(text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.archive_tournament_workspace_v6(text) FROM anon;
  END IF;

  IF to_regprocedure('public.create_tournament_workspace_v6(text,text,text,uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.create_tournament_workspace_v6(text,text,text,uuid) FROM anon;
  END IF;

  IF to_regprocedure('public.transfer_tournament_owner_v6(text,uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.transfer_tournament_owner_v6(text,uuid) FROM anon;
  END IF;

  IF to_regprocedure('public.create_event_admin(uuid,text,text,text,text,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.create_event_admin(uuid,text,text,text,text,text) FROM anon;
  END IF;

  IF to_regprocedure('public.assign_team_to_group_v1(text,text,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.assign_team_to_group_v1(text,text,text) FROM anon;
  END IF;

  IF to_regprocedure('public.dissolve_groups_v2(text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.dissolve_groups_v2(text) FROM anon;
  END IF;

  IF to_regprocedure('public.setup_groups_v2(text,integer)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.setup_groups_v2(text,integer) FROM anon;
  END IF;

  IF to_regprocedure('public.setup_groups_v3(text,integer,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.setup_groups_v3(text,integer,text) FROM anon;
  END IF;

  IF to_regprocedure('public.record_login_session_v1()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.record_login_session_v1() FROM anon;
  END IF;
END $$;

-- Public tournament read path must remain callable by anon because
-- /api/public/tournament/:slug uses the anon Supabase client.
GRANT EXECUTE ON FUNCTION public.get_public_tournament_snapshot_v1(text) TO anon;

COMMIT;
