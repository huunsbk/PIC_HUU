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

export function useTournamentRpcMutations() {
  const { activeTenantId, activeTournamentId, tournamentId, currentEventId, invalidateEventScope } = useRpcInvalidation();
  const { data: eventsData = [] } = useEvents();
  const selectedEventId = resolveSelectedEventId(currentEventId, eventsData);
  const requireEventId = (eventId: string | null | undefined) =>
    requireBusinessContext(activeTenantId, activeTournamentId, tournamentId, eventId);

  const updateEventConfig = useMutation({
    mutationFn: (input: EventConfigInput) => tournamentRpc.updateEventConfig(input),
    onSuccess: invalidateEventScope,
  });

  const createTeam = useMutation({
    mutationFn: ({ name, seed = 'none', eventId = selectedEventId }: { eventId?: string | null; name: string; seed?: SeedType }) =>
      tournamentRpc.createTeam(requireEventId(eventId), name, seed),
    onSuccess: invalidateEventScope,
  });

  const updateTeam = useMutation({
    mutationFn: ({ teamId, name, seed }: { teamId: string; name?: string; seed?: SeedType }) =>
      tournamentRpc.updateTeam(teamId, { name, seed }),
    onSuccess: invalidateEventScope,
  });

  const archiveTeam = useMutation({
    mutationFn: (teamId: string) => tournamentRpc.archiveTeam(teamId),
    onSuccess: invalidateEventScope,
  });

  const importTeams = useMutation({
    mutationFn: ({ eventId = selectedEventId, teams }: { eventId?: string | null; teams: TeamImportRow[] }) =>
      tournamentRpc.importTeams(requireEventId(eventId), teams),
    onSuccess: invalidateEventScope,
  });

  const setupGroups = useMutation({
    mutationFn: ({ eventId = selectedEventId, groupCount, mode = 'balanced' }: { eventId?: string | null; groupCount: number; mode?: GroupMode }) =>
      tournamentRpc.setupGroups(requireEventId(eventId), groupCount, mode),
    onSuccess: invalidateEventScope,
  });

  const assignTeamToGroup = useMutation({
    mutationFn: ({ teamId, groupId, beforeTeamId, force }: { teamId: string; groupId: string | null; beforeTeamId?: string | null; force?: boolean }) =>
      tournamentRpc.assignTeamToGroup(teamId, groupId, beforeTeamId, !!force),
    onSuccess: invalidateEventScope,
  });

  const dissolveGroups = useMutation({
    mutationFn: (eventId: string | null = requireEventId(selectedEventId)) => tournamentRpc.dissolveGroups(requireEventId(eventId)),
    onSuccess: invalidateEventScope,
  });

  const generateSchedule = useMutation({
    mutationFn: (eventId: string | null = requireEventId(selectedEventId)) => tournamentRpc.generateSchedule(requireEventId(eventId)),
    onSuccess: invalidateEventScope,
  });

  const updateMatchScore = useMutation({
    mutationFn: ({ matchId, scoreA, scoreB }: { matchId: string; scoreA: number; scoreB: number }) =>
      {
        requireEventId(selectedEventId);
        return tournamentRpc.updateMatchScore(matchId, scoreA, scoreB);
      },
    onSuccess: invalidateEventScope,
  });

  const updateMatchSetScore = useMutation({
    mutationFn: ({ matchId, setNumber, scoreA, scoreB }: { matchId: string; setNumber: 1 | 2 | 3; scoreA: number; scoreB: number }) =>
      {
        requireEventId(selectedEventId);
        return tournamentRpc.updateMatchSetScore(matchId, setNumber, scoreA, scoreB);
      },
    onSuccess: invalidateEventScope,
  });

  const finalizeMatchScore = useMutation({
    mutationFn: ({ matchId }: { matchId: string }) =>
      {
        requireEventId(selectedEventId);
        return tournamentRpc.finalizeMatchScore(matchId);
      },
    onSuccess: invalidateEventScope,
  });

  const resetMatchScore = useMutation({
    mutationFn: (matchId: string) => {
      requireEventId(selectedEventId);
      return tournamentRpc.resetMatchScore(matchId);
    },
    onSuccess: invalidateEventScope,
  });

  const saveManualKnockoutBracket = useMutation({
    mutationFn: ({
      eventId = selectedEventId,
      bracketSize,
      slots,
    }: {
      eventId?: string | null;
      bracketSize: 4 | 8 | 16 | 32;
      slots: ManualKnockoutSlotInput[];
    }) => tournamentRpc.saveManualKnockoutBracket(requireEventId(eventId), bracketSize, slots),
    onSuccess: invalidateEventScope,
  });

  const clearKnockoutBracket = useMutation({
    mutationFn: (eventId: string | null = requireEventId(selectedEventId)) => tournamentRpc.clearKnockoutBracket(requireEventId(eventId)),
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
