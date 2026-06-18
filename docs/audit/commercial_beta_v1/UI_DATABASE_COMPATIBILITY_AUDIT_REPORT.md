# UI Database Compatibility Audit Report

## Scope

Commercial Beta V1 review for UI/database compatibility across the main tournament operations surface.

## External Product References

- Tournament platforms commonly expose a real-time event dashboard, pool/bracket management, scheduling, standings, and score updates from one authoritative data source.
- The product direction for PIC_HUU follows the CTO rule: UI sends user intent; Supabase/PostgreSQL/RPC validates permissions, tenant scope, business rules, and writes data.

## Findings Fixed In This Branch

### Trang chủ

- Problem: dashboard statistics were reading legacy Zustand store data while operational pages read Supabase via React Query.
- User-visible symptom: cards showed `0 / 0`, `0 Đội`, `0 Bảng`, `0 Trận` even when DB-backed pages had data.
- Fix:
  - Dashboard now reads current-event teams, groups, and matches from the same Supabase query hooks used by operational pages.
  - Added tenant-wide dashboard aggregate query for total teams, groups, group matches, completed group matches, and knockout matches.
  - Mutations now invalidate `dashboard-stats` so the home page updates after team/group/match changes.

### Chia bảng

- Problem: previous frontend logic attempted to create groups and assign teams from the browser.
- CTO fix:
  - Added `setup_groups_v3(p_event_id, p_num_groups, p_mode)`.
  - Added `assign_team_to_group_v1(p_event_id, p_team_id, p_group_id)`.
  - Frontend now calls RPC contracts; database handles permission, tenant, event scope, group creation, seeded assignment, random assignment, and team reassignment.

## Remaining CTO Follow-Up

- Move schedule generation into a versioned RPC so `Lịch & Kết quả` no longer inserts matches directly from the frontend.
- Move match score reset and pending-score updates into RPCs where direct table updates still exist.
- Move JSON restore into an explicit backend/import RPC or Edge Function before allowing production usage.
- Review account-management backend endpoints for deployment compatibility on GitHub Pages.

## Verification

- No SQL was executed by this audit step.
- No Supabase command was run by this audit step.
- No secrets were added.
