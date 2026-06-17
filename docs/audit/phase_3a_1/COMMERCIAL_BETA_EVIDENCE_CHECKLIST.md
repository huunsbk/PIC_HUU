# Commercial Beta Evidence Checklist

Phase: 3A.1
Environment: staging
Supabase project ref: `ykckqcykxfhpfqptckxk`

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
