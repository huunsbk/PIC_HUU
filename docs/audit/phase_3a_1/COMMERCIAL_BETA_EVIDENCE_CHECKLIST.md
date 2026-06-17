# Commercial Beta Evidence Checklist

Phase: 3A.1
Environment: staging
Supabase project ref: `ykckqcykxfhpfqptckxk`

## Commercial Beta V1 Scale Target

- [ ] Commercial Beta V1 target is up to 100 active tournaments.
- [ ] Mục tiêu Commercial Beta V1: tối đa 100 giải hoạt động đồng thời.
- [ ] Scale beyond 100 active tournaments has benchmark evidence attached.
- [ ] 100-300 tournaments is no longer the current Commercial Beta V1 target.
- [ ] 300-800 tournaments is documented as future expansion only.
- [ ] 1000+ tournaments is not approved.
- [ ] Production remains NOT APPROVED until Staging hotfix, EXPLAIN evidence, and RLS isolation checks pass.

## RPC Signature Confirmation

- [ ] Confirm `get_tournament_workspace_dashboard_v6(NULL::timestamptz, 50)`.
- [ ] Confirm `get_tournament_owner('__TEST_EVENT_ID__'::text)`.
- [ ] Confirm `archive_tournament_workspace_v6('__TEST_TOURNAMENT_ID__'::text)`.

## Execution Plan Evidence

- [ ] Replace `before_get_tournament_workspace_dashboard_v6.json`.
- [ ] Replace `after_get_tournament_workspace_dashboard_v6.json`.
- [ ] Replace `before_archive_tournament_workspace_v6.json`.
- [ ] Replace `after_archive_tournament_workspace_v6.json`.
- [ ] Replace `before_get_tournament_owner.json`.
- [ ] Replace `after_get_tournament_owner.json`.

## Safety Checks

- [ ] No Supabase service role key is committed.
- [ ] No database migrations are run from this evidence branch.
- [ ] No table schema changes are introduced.
- [ ] No RPC signatures are changed.
- [ ] Dashboard status drift hotfix is DBA-reviewed before staging execution.
