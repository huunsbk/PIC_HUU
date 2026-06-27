import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTournamentStore } from '../store';
import { CreateTeamSchema } from '../lib/validation/schemas';
import { tournamentRpc, type TeamImportRow } from '../lib/api/tournamentRpc';
import type { SeedType } from '../types';
import { isUsableEventId, useEvents } from './useEvents';

const SELECT_TENANT_MESSAGE = 'Vui lòng chọn hoặc tạo đơn vị trước.';
const SELECT_TOURNAMENT_MESSAGE = 'Vui lòng chọn hoặc tạo giải đấu trước.';
const SELECT_EVENT_MESSAGE = 'Vui lòng chọn hoặc tạo nội dung thi đấu trước.';

function resolveSelectedEventId(currentEventId: string | null | undefined, eventsData: Array<{ id: string }>) {
  if (isUsableEventId(currentEventId) && eventsData.some((event) => event.id === currentEventId)) {
    return currentEventId;
  }
  return eventsData[0]?.id || null;
}

export function useTeamMutations() {
  const queryClient = useQueryClient();
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const activeTournamentId = useTournamentStore((state) => state.activeTournamentId);
  const tournamentId = useTournamentStore((state) => state.tournament.id);
  const currentEventId = useTournamentStore((state) => state.currentEventId);
  const { data: eventsData = [] } = useEvents();
  const selectedEventId = resolveSelectedEventId(currentEventId, eventsData);
  const invalidateDashboardStats = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
  };
  const requireTenantContext = () => {
    if (!activeTenantId || activeTenantId === 'default') {
      throw new Error(SELECT_TENANT_MESSAGE);
    }
    if (!(activeTournamentId || tournamentId) || tournamentId === 't-1') {
      throw new Error(SELECT_TOURNAMENT_MESSAGE);
    }
    if (!isUsableEventId(selectedEventId)) {
      throw new Error(SELECT_EVENT_MESSAGE);
    }
    return selectedEventId;
  };

  const splitImportLine = (line: string) => {
    if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim());
    if (line.includes(';')) return line.split(';').map((cell) => cell.trim());
    return line.split(',').map((cell) => cell.trim());
  };
  const isRowNumber = (value?: string) => !!value && /^\d+$/.test(value.trim());
  const normalizeSeed = (value?: string) => {
    const rawSeed = (value || '').trim().toLowerCase();
    if (['hạt giống 1', 'seed 1', 'seed1', '1'].includes(rawSeed)) return '1';
    if (['hạt giống 2', 'seed 2', 'seed2', '2'].includes(rawSeed)) return '2';
    if (['hạt giống 3', 'seed 3', 'seed3', '3'].includes(rawSeed)) return '3';
    if (['hạt giống 4', 'seed 4', 'seed4', '4'].includes(rawSeed)) return '4';
    return 'none';
  };

  const addTeam = useMutation({
    mutationFn: async (data: { name: string, seed: string }) => {
      const { name, seed } = data;
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error('Tên đội không được để trống.');
      }
      const eventId = requireTenantContext();

      return tournamentRpc.createTeam(eventId, trimmedName, seed as SeedType);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      invalidateDashboardStats();
    }
  });

  const updateTeam = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string, name?: string, seed?: string, group_id?: string | null }) => {
      return tournamentRpc.updateTeam(id, {
        name: updates.name,
        seed: updates.seed as SeedType | undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      invalidateDashboardStats();
    }
  });

  const deleteTeam = useMutation({
    mutationFn: async (id: string) => {
      requireTenantContext();
      return tournamentRpc.archiveTeam(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      invalidateDashboardStats();
    }
  });

  const importTeams = useMutation({
    mutationFn: async (csvContent: string) => {
      const lines = csvContent.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      // Skip header if contains specific keywords
      let startIndex = 0;
      if (lines.length > 0 && (lines[0].toLowerCase().includes('tên đội') || lines[0].toLowerCase().includes('team'))) {
        startIndex = 1;
      }

      const rawInputs = lines.slice(startIndex).map(splitImportLine);
      const imports: TeamImportRow[] = [];

      for (const columns of rawInputs) {
        const nameIndex = isRowNumber(columns[0]) && columns[1] ? 1 : 0;
        const seedIndex = nameIndex + 1;
        const name = columns[nameIndex]?.trim();
        if (!name) continue;

        const seed = normalizeSeed(columns[seedIndex]);
        
        // Zod validation check on item parsing stage
        const validation = CreateTeamSchema.safeParse({ name, seed });
        if (!validation.success) {
          console.warn('[Zod Bulk Validate] Bỏ qua đội do không đạt định dạng:', name, validation.error.format());
          continue;
        }
        
        imports.push({ name, seed: seed as SeedType });
      }

      const eventId = requireTenantContext();

      const result = await tournamentRpc.importTeams(eventId, imports);
      return result.imported_count ?? imports.length;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      invalidateDashboardStats();
    }
  });

  return { addTeam, updateTeam, deleteTeam, importTeams };
}

export function useGroupMutations() {
  const queryClient = useQueryClient();
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const activeTournamentId = useTournamentStore((state) => state.activeTournamentId);
  const tournamentId = useTournamentStore((state) => state.tournament.id);
  const currentEventId = useTournamentStore((state) => state.currentEventId);
  const { data: eventsData = [] } = useEvents();
  const selectedEventId = resolveSelectedEventId(currentEventId, eventsData);
  const invalidateDashboardStats = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
  };
  const requireTenantContext = () => {
    if (!activeTenantId || activeTenantId === 'default') {
      throw new Error(SELECT_TENANT_MESSAGE);
    }
    if (!(activeTournamentId || tournamentId) || tournamentId === 't-1') {
      throw new Error(SELECT_TOURNAMENT_MESSAGE);
    }
    if (!isUsableEventId(selectedEventId)) {
      throw new Error(SELECT_EVENT_MESSAGE);
    }
    return selectedEventId;
  };

  type GroupingMode = 'balanced' | 'seed' | 'random' | 'empty';

  const setupGroupsContract = async (numGroups: number, mode: GroupingMode = 'balanced') => {
    const eventId = requireTenantContext();

    return tournamentRpc.setupGroups(eventId, numGroups, mode) as Promise<{
      success?: boolean;
      event_id?: string;
      num_groups?: number;
      group_count?: number;
      mode?: GroupingMode;
      group_ids?: string[];
      assigned_teams?: number;
    } | null>;
  };

  const clearAllGroups = useMutation({
     mutationFn: async () => {
       const eventId = requireTenantContext();
       return tournamentRpc.dissolveGroups(eventId) as Promise<{
         success?: boolean;
         event_id?: string;
         teams_cleared?: number;
         groups_dissolved?: number;
         matches_soft_deleted?: number;
       } | null>;
     },
     onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['groups'] });
        queryClient.invalidateQueries({ queryKey: ['teams'] });
        queryClient.invalidateQueries({ queryKey: ['matches'] });
        invalidateDashboardStats();
     }
  });

  const setupGroups = useMutation({
     mutationFn: async (numGroups: number) => {
        return setupGroupsContract(numGroups, 'empty');
     },
     onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['groups'] });
        queryClient.invalidateQueries({ queryKey: ['teams'] });
        queryClient.invalidateQueries({ queryKey: ['matches'] });
        invalidateDashboardStats();
     }
  });

  const autoGroupTeams = useMutation({
    mutationFn: async (params?: { method?: 'random' | 'seed'; numGroups?: number }) => {
      const requestedGroups = params?.numGroups || 4;
      return setupGroupsContract(requestedGroups, params?.method || 'seed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      invalidateDashboardStats();
    }
  });

  const moveTeamToGroup = useMutation({
    mutationFn: async ({ teamId, toGroupId, beforeTeamId, force }: { teamId: string, toGroupId: string | null, beforeTeamId?: string | null, force?: boolean }) => {
      requireTenantContext();
      const dbGroupId = toGroupId === 'unassigned' ? null : toGroupId;
      return tournamentRpc.assignTeamToGroup(teamId, dbGroupId, beforeTeamId, !!force);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      invalidateDashboardStats();
    }
  });

  return { clearAllGroups, setupGroups, autoGroupTeams, moveTeamToGroup };
}

export function useMatchMutations() {
  const queryClient = useQueryClient();
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const activeTournamentId = useTournamentStore((state) => state.activeTournamentId);
  const tournamentId = useTournamentStore((state) => state.tournament.id);
  const currentEventId = useTournamentStore((state) => state.currentEventId);
  const { data: eventsData = [] } = useEvents();
  const selectedEventId = resolveSelectedEventId(currentEventId, eventsData);
  const invalidateDashboardStats = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
  };
  const requireBusinessContext = () => {
    if (!activeTenantId || activeTenantId === 'default') {
      throw new Error(SELECT_TENANT_MESSAGE);
    }
    if (!(activeTournamentId || tournamentId) || tournamentId === 't-1') {
      throw new Error(SELECT_TOURNAMENT_MESSAGE);
    }
    if (!isUsableEventId(selectedEventId)) {
      throw new Error(SELECT_EVENT_MESSAGE);
    }
    return selectedEventId;
  };
  const updateMatchScore = useMutation({
    mutationFn: async ({ matchId, scoreA, scoreB }: { matchId: string, scoreA: number | null, scoreB: number | null }) => {
      requireBusinessContext();
      if (scoreA !== null && scoreB !== null) {
         return tournamentRpc.updateMatchScore(matchId, scoreA, scoreB);
      } else {
         return tournamentRpc.resetMatchScore(matchId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['match-sets'] });
      invalidateDashboardStats();
    }
  });

  const resetMatchScore = useMutation({
    mutationFn: async (matchId: string) => {
      requireBusinessContext();
      return tournamentRpc.resetMatchScore(matchId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['match-sets'] });
      invalidateDashboardStats();
    }
  });

  const generateForGroup = useMutation({
    mutationFn: async (_params: { groupId: string, teamIds: string[] }) => {
      const eventId = requireBusinessContext();
      return tournamentRpc.generateSchedule(eventId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      invalidateDashboardStats();
    }
  });

  const generateAllSchedules = useMutation({
    mutationFn: async (_groups: any[]) => {
      const eventId = requireBusinessContext();
      return tournamentRpc.generateSchedule(eventId);
    },
    onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['matches'] });
       invalidateDashboardStats();
    }
  });

  const updateMatchStatus = useMutation({
    mutationFn: async ({ matchId, status }: { matchId: string, status: 'pending' | 'playing' | 'finished' }) => {
      requireBusinessContext();
      if (status === 'pending' || status === 'playing') {
        return tournamentRpc.updateMatchStatus(matchId, status);
      }
      throw new Error('Trạng thái finished phải được cập nhật thông qua RPC nhập điểm.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['match-sets'] });
      invalidateDashboardStats();
    }
  });

  const updateMatchSetScore = useMutation({
    mutationFn: async ({ matchId, setNumber, scoreA, scoreB }: { matchId: string, setNumber: 1 | 2 | 3, scoreA: number, scoreB: number }) => {
      requireBusinessContext();
      return tournamentRpc.updateMatchSetScore(matchId, setNumber, scoreA, scoreB);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['match-sets'] });
      invalidateDashboardStats();
    }
  });

  const finalizeMatchScore = useMutation({
    mutationFn: async (matchId: string) => {
      requireBusinessContext();
      return tournamentRpc.finalizeMatchScore(matchId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.invalidateQueries({ queryKey: ['match-sets'] });
      invalidateDashboardStats();
    }
  });

  return { updateMatchScore, updateMatchSetScore, finalizeMatchScore, resetMatchScore, generateForGroup, generateAllSchedules, updateMatchStatus };
}
