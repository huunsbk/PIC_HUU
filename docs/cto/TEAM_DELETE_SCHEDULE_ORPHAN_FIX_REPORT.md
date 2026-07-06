# Team Delete / Schedule Orphan Fix

## Root Cause

- UI xoa doi goi RPC `archive_team_v1`.
- `archive_team_v1` hien chi soft-delete doi bang `teams.deleted_at = now()` va xoa `group_id`.
- RPC co cap nhat lai `groups.team_ids`, nhung khong kiem tra bang `matches` / `match_sets`.
- `useMatches` van tai cac tran active tu bang `matches`, trong khi `useTeams` chi tai doi active `deleted_at IS NULL`.
- Vi vay khi doi da archived nhung match active con `team_a_id` / `team_b_id`, UI khong map duoc ten doi va co the roi ve raw id dang `team-...`.

## Related Files / RPC

- `src/components/TeamManager.tsx`
- `src/hooks/useDataMutations.ts`
- `src/lib/api/tournamentRpc.ts`
- `src/hooks/useTeams.ts`
- `src/hooks/useMatches.ts`
- `src/utils/tournamentEngine.ts`
- `public.archive_team_v1`
- `public.dissolve_groups_v4`

## Current Data Flow

1. Team delete button -> `deleteTeam.mutateAsync(teamId)`.
2. Frontend calls `tournamentRpc.archiveTeam(teamId)`.
3. RPC `archive_team_v1` soft-deletes team and removes it from active group list.
4. Schedule screen loads active matches separately.
5. Match rows still point to archived team ids, but active team query no longer returns those teams.

## Proposed Safe Fix

- Block archiving a team when active matches still reference that team.
- If referenced match already has score/finalized data, show a stricter message and preserve history.
- If referenced matches are only pending, require the operator to dissolve groups/schedule first.
- Update UI copy so delete team no longer claims it will clean schedule automatically.
- Prevent legacy orphan data from rendering raw `team-...` ids by showing a clear inactive-team label.
- Add a separate destructive action `Xóa toàn bộ đội` for EVENT_ADMIN or higher. This calls `hard_delete_event_teams_v1` and deletes data in reverse order: match sets, knockout slots/selections, matches, groups, then teams.

## Why This Option

- It avoids silent data loss on production.
- It preserves match history and score records.
- It forces an explicit operational step before destructive changes.
- It fixes the raw-id symptom for existing orphan data without hiding the underlying integrity issue.
- It keeps single-team delete safe while still giving admins an explicit reset path for broken/test event data.
