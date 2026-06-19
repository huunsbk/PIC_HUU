# Prompt 07-J Demo E2E Report

Status: completed on Supabase beta.

Scope:

- Create complete demo data for tournament `thang-oanh`.
- Keep all writes scoped to tenant `CLB Thắng Oanh` and the three demo events.
- Do not reset the database globally.
- Do not touch `auth.users`, accounts, roles, permissions, or sports.
- Do not run Prompt 08.

Expected demo data:

| Event | Teams | Groups | Group matches | Scores | Knockout |
|---|---:|---:|---:|---|---|
| Đôi Nam | 16 | 4 | 24 | all group matches | top 2 per group, bracket 8 |
| Đôi Nữ | 8 | 2 | 12 | partial group scores | not generated |
| Đôi Nam Nữ | 8 | 2 | 12 | pending | not generated |

Execution files:

- `tests/enterprise/seed_demo_e2e_07j.sql`
- `tests/enterprise/verify_demo_e2e_07j.sql`
- Existing negative context tests:
  - `tests/enterprise/negative_010_tournament_as_event_id.sql`
  - `tests/enterprise/negative_010_tenant_as_event_id.sql`

Result:

- `tests/enterprise/seed_demo_e2e_07j.sql`: PASS.
- `tests/enterprise/verify_demo_e2e_07j.sql`: PASS.
- `tests/enterprise/negative_010_tournament_as_event_id.sql`: PASS, blocked with `INVALID_CONTEXT`.
- `tests/enterprise/negative_010_tenant_as_event_id.sql`: PASS, blocked with `INVALID_CONTEXT`.

Verified data:

| Event | Event id | Teams | Groups | Group matches | Finished group matches | Confirmed KO teams | KO matches |
|---|---|---:|---:|---:|---:|---:|---:|
| Đôi Nam | `evt_6da72de38f5c469d8e829348c92dfde2` | 16 | 4 | 24 | 24 | 8 | 7 |
| Đôi Nữ | `evt_4b8ff313ce2c43fb8aa796cf6a9da464` | 8 | 2 | 12 | 4 | 0 | 0 |
| Đôi Nam Nữ | `evt_86d3121231e2486c99590615a11d5407` | 8 | 2 | 12 | 0 | 0 | 0 |

Isolation checks:

- Đôi Nam has Đôi Nữ demo teams: `0`.
- Đôi Nữ has Đôi Nam demo teams: `0`.
- Cross-event match/team mismatches: `0`.
- All selected demo event ids begin with `evt_`.
- Tournament id and tenant id are not valid event ids.

Referee access:

- Active REFEREE accounts in tenant `CLB Thắng Oanh`: `0`.
- Đôi Nam REFEREE grants: `0`.
- Cross-tenant REFEREE grants to Đôi Nam: `0`.
- REFEREE E2E remains blocked by data. No `auth.users` record was created.

Safety:

- No global database reset.
- No `TRUNCATE CASCADE`.
- No `auth.users` mutation.
- No account/role/permission/sport mutation.
- Cleanup was scoped to the demo events under tournament `thang-oanh`.
- Direct cleanup for locked business tables was avoided; match score cleanup uses `reset_match_score_v1`.
- Prompt 08 was not run.
