import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  tournamentRpc,
  type EventConfigInput,
  type ManualKnockoutSlotInput,
  type TeamImportRow,
} from '../lib/api/tournamentRpc';
import { useTournamentStore } from '../store';
import type { SeedType } from '../types';
import { isUsableEventId, useEvents } from './useEvents';
import { assertFreshEventPermission } from '../lib/auth/livePermissions';

type GroupMode = 'balanced' | 'random' | 'seed' | 'empty';

const SELECT_TENANT_MESSAGE = 'Vui lòng chọn hoặc tạo đơn vị trước.';
const SELECT_TOURNAMENT_MESSAGE = 'Vui lòng chọn hoặc tạo giải đấu trước.';
const SELECT_EVENT_MESSAGE = 'Vui lòng chọn hoặc tạo nội dung thi đấu trước.';

function useRpcInvalidation() {
  const queryClient = useQueryClient();
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const activeTournamentId = useTournamentStore((state) => state.activeTournamentId);
  const tournamentId = useTournamentStore((state) => state.tournament.id);
  const currentEventId = useTournamentStore((state) => state.currentEventId);

  const invalidateEventScope = () => {
    queryClient.invalidateQueries({ queryKey: ['events'] });
    queryClient.invalidateQueries({ queryKey: ['teams'] });
    queryClient.invalidateQueries({ queryKey: ['groups'] });
    queryClient.invalidateQueries({ queryKey: ['matches'] });
    queryClient.invalidateQueries({ queryKey: ['match-sets'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
  };

  return { activeTenantId, activeTournamentId, tournamentId, currentEventId, invalidateEventScope };
}

function resolveSelectedEventId(currentEventId: string | null | undefined, eventsData: Array<{ id: string }>) {
  if (isUsableEventId(currentEventId) && eventsData.some((event) => event.id === currentEventId)) {
    return currentEventId;
  }
  return eventsData[0]?.id || null;
}

function requireBusinessContext(
  activeTenantId: string | null | undefined,
  activeTournamentId: string | null | undefined,
  tournamentId: string | null | undefined,
  eventId: string | null | undefined,
) {
  if (!activeTenantId || activeTenantId === 'default') {
    throw new Error(SELECT_TENANT_MESSAGE);
  }
  if (!(activeTournamentId || tournamentId) || tournamentId === 't-1') {
    throw new Error(SELECT_TOURNAMENT_MESSAGE);
  }
  if (!isUsableEventId(eventId)) {
    throw new Error(SELECT_EVENT_MESSAGE);
  }
  return eventId;
}

async function assertEventPermission(eventId: string, permission: string) {
  await assertFreshEventPermission(eventId, permission);
}

export function useTournamentRpcMutations() {
  const { activeTenantId, activeTournamentId, tournamentId, currentEventId, invalidateEventScope } = useRpcInvalidation();
  const { data: eventsData = [] } = useEvents();
  const selectedEventId = resolveSelectedEventId(currentEventId, eventsData);
  const requireEventId = (eventId: string | null | undefined) =>
    requireBusinessContext(activeTenantId, activeTournamentId, tournamentId, eventId);

  const updateEventConfig = useMutation({
    mutationFn: async (input: EventConfigInput) => {
      const eventId = requireEventId(input.eventId);
      await assertEventPermission(eventId, 'manage_event_config');
      return tournamentRpc.updateEventConfig(input);
    },
    onSuccess: invalidateEventScope,
  });

  const createTeam = useMutation({
    mutationFn: async ({ name, seed = 'none', eventId = selectedEventId }: { eventId?: string | null; name: string; seed?: SeedType }) => {
      const requiredEventId = requireEventId(eventId);
      await assertEventPermission(requiredEventId, 'manage_teams');
      return tournamentRpc.createTeam(requiredEventId, name, seed);
    },
    onSuccess: invalidateEventScope,
  });

  const updateTeam = useMutation({
    mutationFn: async ({ teamId, name, seed }: { teamId: string; name?: string; seed?: SeedType }) => {
      const eventId = requireEventId(selectedEventId);
      await assertEventPermission(eventId, 'manage_teams');
      return tournamentRpc.updateTeam(teamId, { name, seed });
    },
    onSuccess: invalidateEventScope,
  });

  const archiveTeam = useMutation({
    mutationFn: async (teamId: string) => {
      const eventId = requireEventId(selectedEventId);
      await assertEventPermission(eventId, 'manage_teams');
      return tournamentRpc.archiveTeam(teamId);
    },
    onSuccess: invalidateEventScope,
  });

  const importTeams = useMutation({
    mutationFn: async ({ eventId = selectedEventId, teams }: { eventId?: string | null; teams: TeamImportRow[] }) => {
      const requiredEventId = requireEventId(eventId);
      await assertEventPermission(requiredEventId, 'manage_teams');
      return tournamentRpc.importTeams(requiredEventId, teams);
    },
    onSuccess: invalidateEventScope,
  });

  const setupGroups = useMutation({
    mutationFn: async ({ eventId = selectedEventId, groupCount, mode = 'balanced' }: { eventId?: string | null; groupCount: number; mode?: GroupMode }) => {
      const requiredEventId = requireEventId(eventId);
      await assertEventPermission(requiredEventId, 'manage_groups');
      return tournamentRpc.setupGroups(requiredEventId, groupCount, mode);
    },
    onSuccess: invalidateEventScope,
  });

  const assignTeamToGroup = useMutation({
    mutationFn: async ({ teamId, groupId, beforeTeamId, force }: { teamId: string; groupId: string | null; beforeTeamId?: string | null; force?: boolean }) => {
      const eventId = requireEventId(selectedEventId);
      await assertEventPermission(eventId, 'manage_groups');
      return tournamentRpc.assignTeamToGroup(teamId, groupId, beforeTeamId, !!force);
    },
    onSuccess: invalidateEventScope,
  });

  const dissolveGroups = useMutation({
    mutationFn: async (eventId: string | null = requireEventId(selectedEventId)) => {
      const requiredEventId = requireEventId(eventId);
      await assertEventPermission(requiredEventId, 'manage_groups');
      return tournamentRpc.dissolveGroups(requiredEventId);
    },
    onSuccess: invalidateEventScope,
  });

  const generateSchedule = useMutation({
    mutationFn: async (eventId: string | null = requireEventId(selectedEventId)) => {
      const requiredEventId = requireEventId(eventId);
      await assertEventPermission(requiredEventId, 'manage_schedule');
      return tournamentRpc.generateSchedule(requiredEventId);
    },
    onSuccess: invalidateEventScope,
  });

  const updateMatchScore = useMutation({
    mutationFn: async ({ matchId, scoreA, scoreB }: { matchId: string; scoreA: number; scoreB: number }) =>
      {
        const eventId = requireEventId(selectedEventId);
        await assertFreshEventPermission(eventId, 'enter_scores');
        return tournamentRpc.updateMatchScore(matchId, scoreA, scoreB);
      },
    onSuccess: invalidateEventScope,
  });

  const updateMatchSetScore = useMutation({
    mutationFn: async ({ matchId, setNumber, scoreA, scoreB }: { matchId: string; setNumber: 1 | 2 | 3; scoreA: number; scoreB: number }) =>
      {
        const eventId = requireEventId(selectedEventId);
        await assertFreshEventPermission(eventId, 'enter_scores');
        return tournamentRpc.updateMatchSetScore(matchId, setNumber, scoreA, scoreB);
      },
    onSuccess: invalidateEventScope,
  });

  const finalizeMatchScore = useMutation({
    mutationFn: async ({ matchId }: { matchId: string }) =>
      {
        const eventId = requireEventId(selectedEventId);
        await assertFreshEventPermission(eventId, 'enter_scores');
        return tournamentRpc.finalizeMatchScore(matchId);
      },
    onSuccess: invalidateEventScope,
  });

  const resetMatchScore = useMutation({
    mutationFn: async (matchId: string) => {
      const eventId = requireEventId(selectedEventId);
      await assertFreshEventPermission(eventId, 'enter_scores');
      return tournamentRpc.resetMatchScore(matchId);
    },
    onSuccess: invalidateEventScope,
  });

  const saveManualKnockoutBracket = useMutation({
    mutationFn: async ({
      eventId = selectedEventId,
      bracketSize,
      slots,
    }: {
      eventId?: string | null;
      bracketSize: 4 | 8 | 16 | 32;
      slots: ManualKnockoutSlotInput[];
    }) => {
      const requiredEventId = requireEventId(eventId);
      await assertEventPermission(requiredEventId, 'manage_knockout');
      return tournamentRpc.saveManualKnockoutBracket(requiredEventId, bracketSize, slots);
    },
    onSuccess: invalidateEventScope,
  });

  const clearKnockoutBracket = useMutation({
    mutationFn: async (eventId: string | null = requireEventId(selectedEventId)) => {
      const requiredEventId = requireEventId(eventId);
      await assertEventPermission(requiredEventId, 'manage_knockout');
      return tournamentRpc.clearKnockoutBracket(requiredEventId);
    },
    onSuccess: invalidateEventScope,
  });

  return {
    update_event_config_v1: updateEventConfig,
    create_team_v1: createTeam,
    update_team_v1: updateTeam,
    archive_team_v1: archiveTeam,
    import_teams_v1: importTeams,
    setup_groups_v4: setupGroups,
    assign_team_to_group_v2: assignTeamToGroup,
    dissolve_groups_v4: dissolveGroups,
    generate_schedule_v1: generateSchedule,
    update_match_score_v1: updateMatchScore,
    update_match_set_score_v1: updateMatchSetScore,
    finalize_match_score_v1: finalizeMatchScore,
    reset_match_score_v1: resetMatchScore,
    save_manual_knockout_bracket_v1: saveManualKnockoutBracket,
    clear_knockout_bracket_v1: clearKnockoutBracket,
  };
}
