# Content PDF Requirements - Implementation Report

Date: 2026-06-26

## Summary

Implemented the business changes requested from `nội dung sửa.pdf` and deployed them to production.

## Implemented Requirements

| Requirement | Implementation |
| --- | --- |
| Ranking `Séc` column | Added set-diff fields and UI/export columns. Ranking order now prioritizes points, set diff, point diff, then head-to-head. |
| Empty group creation / manual drag-drop | `setup_groups_v4` supports empty mode; `assign_team_to_group_v2` supports move out, move between groups, order insertion, and forced schedule impact handling. |
| Score entry table | Score entry now shows match rows by set columns and reads from `match_sets`. |
| Save set vs finalize match | `update_match_set_score_v1` saves a set only; `finalize_match_score_v1` finalizes winner/status server-side. |
| Knockout rank-slot labels | Added migration 016 and frontend normalization so KO primary labels are `Hạng 1 bảng ...`, `Hạng 2 bảng ...`, `Hạng 3 xuất sắc ...`. |
| Group finished / KO resolution | `prepare_knockout_candidates_v1` reports group status and requires completed groups before resolving rank slots. |
| Clear bracket | Added `clear_knockout_bracket_v1` and a dedicated `Xóa sơ đồ` action in KO UI. |
| Event management layout | Reworked table/tree view with Vietnamese columns: `STT`, `Đơn vị quản lý`, `Giải đấu`, `Nội dung thi đấu`, `Chức năng`. |
| Header identity context | Header displays logged-in name, role, and tournament. |
| Tenant/tournament context usability | Tournament management groups by tenant name; dashboard host organization field locks to the tenant opened by URL. |

## Changed Files

- `src/App.tsx`
- `src/components/Dashboard.tsx`
- `src/components/GroupManager.tsx`
- `src/components/KnockoutBracket.tsx`
- `src/components/ScoreEntry.tsx`
- `src/components/SchedulerAndScoreKeeper.tsx`
- `src/components/Standings.tsx`
- `src/components/LiveDashboard.tsx`
- `src/components/ExportManager.tsx`
- `src/components/event-management-page.tsx`
- `src/components/create-event-modal.tsx`
- `src/hooks/useDataMutations.ts`
- `src/hooks/useTournamentRpcMutations.ts`
- `src/lib/api/tournamentRpc.ts`
- `src/lib/validation/schemas.ts`
- `src/store.ts`
- `src/types.ts`
- `src/utils/scoreDisplay.ts`
- `src/utils/tournamentEngine.ts`

## Migrations / RPC

- `014_content_pdf_group_order_and_setdiff.sql`
- `015_content_pdf_score_finalize_and_knockout_cleanup.sql`
- `016_content_pdf_knockout_rank_labels.sql`

Key RPC/functions:

- `setup_groups_v4`
- `assign_team_to_group_v2`
- `update_match_set_score_v1`
- `finalize_match_score_v1`
- `prepare_knockout_candidates_v1`
- `clear_knockout_bracket_v1`
- `p12_knockout_seed_label_v1`

## Verification

- Build/lint pass.
- Supabase functions and KO labels verified directly against production DB.
- Production route, UI, KO labels, score table, tenant context, and role smoke verified on Vercel.
