import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';
import { generateRoundRobinMatches, balanceMatchesRestTime } from '../utils/tournamentEngine';
import { CreateTeamSchema } from '../lib/validation/schemas';

export function useTeamMutations() {
  const queryClient = useQueryClient();
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const currentEventId = useTournamentStore((state) => state.currentEventId);
  const tournamentId = useTournamentStore((state) => state.tournament.id);
  const requireTenantContext = () => {
    if (!currentEventId) {
      throw new Error('Chưa có nội dung thi đấu hiện hành.');
    }
    if (!activeTenantId || activeTenantId === 'default') {
      throw new Error('Chưa có tenant hợp lệ. Vui lòng đăng nhập lại trước khi thao tác.');
    }
  };

  const createTeamId = () => `team-${crypto.randomUUID()}`;
  const getTeamScope = () => ({
    event_id: currentEventId,
    tenant_id: activeTenantId !== 'default' ? activeTenantId : null,
    tournament_id: tournamentId || null,
  });
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
      if (!currentEventId) {
        throw new Error('Chưa có nội dung thi đấu hiện hành để thêm đội.');
      }

      const { data: result, error } = await supabase
        .from('teams')
        .insert([{
          id: createTeamId(),
          name: trimmedName,
          seed,
          ...getTeamScope(),
        }])
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', activeTenantId, currentEventId] });
    }
  });

  const updateTeam = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string, name?: string, seed?: string, group_id?: string | null }) => {
      const { data, error } = await supabase
        .from('teams')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', activeTenantId, currentEventId] });
    }
  });

  const deleteTeam = useMutation({
    mutationFn: async (id: string) => {
      requireTenantContext();
      // Soft delete
      const deletedAt = new Date().toISOString();
      const { error } = await supabase
        .from('teams')
        .update({ deleted_at: deletedAt })
        .eq('id', id)
        .eq('event_id', currentEventId)
        .eq('tenant_id', activeTenantId)
        .select('id')
        .single();
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', activeTenantId, currentEventId] });
      queryClient.invalidateQueries({ queryKey: ['groups', activeTenantId, currentEventId] });
      queryClient.invalidateQueries({ queryKey: ['matches', activeTenantId, currentEventId] });
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
      const inserts = [];

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
        
        inserts.push({
           id: createTeamId(),
           name,
           seed,
           ...getTeamScope(),
        });
      }

      const CHUNK_SIZE = 100;
      let insertedCount = 0;
      for (let i = 0; i < inserts.length; i += CHUNK_SIZE) {
         const chunk = inserts.slice(i, i + CHUNK_SIZE);
         const { error } = await supabase.from('teams').insert(chunk);
         if (error) throw error;
         insertedCount += chunk.length;
         console.log(`[Chunk Import Engine] Đã đồng bộ thành công ${insertedCount}/${inserts.length} đội.`);
      }
      return insertedCount;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', activeTenantId, currentEventId] });
    }
  });

  return { addTeam, updateTeam, deleteTeam, importTeams };
}

export function useGroupMutations() {
  const queryClient = useQueryClient();
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const currentEventId = useTournamentStore((state) => state.currentEventId);
  const requireTenantContext = () => {
    if (!currentEventId) {
      throw new Error('Chưa có nội dung thi đấu hiện hành.');
    }
    if (!activeTenantId || activeTenantId === 'default') {
      throw new Error('Chưa có tenant hợp lệ. Vui lòng đăng nhập lại trước khi thao tác.');
    }
  };

  type GroupingMode = 'empty' | 'seed' | 'random';

  const setupGroupsContract = async (numGroups: number, mode: GroupingMode = 'empty') => {
    requireTenantContext();

    const { data, error } = await supabase.rpc('setup_groups_v3', {
      p_event_id: currentEventId,
      p_num_groups: numGroups,
      p_mode: mode,
    });
    if (error) throw error;

    return data as {
      success?: boolean;
      event_id?: string;
      num_groups?: number;
      mode?: GroupingMode;
      group_ids?: string[];
      assigned_teams?: number;
    } | null;
  };

  const clearAllGroups = useMutation({
     mutationFn: async () => {
       requireTenantContext();
       const { data, error } = await supabase.rpc('dissolve_groups_v2', {
         p_event_id: currentEventId,
       });
       if (error) throw error;
       return data as {
         success?: boolean;
         event_id?: string;
         teams_cleared?: number;
         groups_dissolved?: number;
         matches_soft_deleted?: number;
       } | null;
     },
     onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['groups', activeTenantId, currentEventId] });
        queryClient.invalidateQueries({ queryKey: ['teams', activeTenantId, currentEventId] });
        queryClient.invalidateQueries({ queryKey: ['matches', activeTenantId, currentEventId] });
     }
  });

  const setupGroups = useMutation({
     mutationFn: async (numGroups: number) => {
        return setupGroupsContract(numGroups, 'empty');
     },
     onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['groups', activeTenantId, currentEventId] });
        queryClient.invalidateQueries({ queryKey: ['teams', activeTenantId, currentEventId] });
        queryClient.invalidateQueries({ queryKey: ['matches', activeTenantId, currentEventId] });
     }
  });

  const autoGroupTeams = useMutation({
    mutationFn: async (params?: { method?: 'random' | 'seed'; numGroups?: number }) => {
      const requestedGroups = params?.numGroups || 4;
      return setupGroupsContract(requestedGroups, params?.method || 'seed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', activeTenantId, currentEventId] });
      queryClient.invalidateQueries({ queryKey: ['teams', activeTenantId, currentEventId] });
      queryClient.invalidateQueries({ queryKey: ['matches', activeTenantId, currentEventId] });
    }
  });

  const moveTeamToGroup = useMutation({
    mutationFn: async ({ teamId, toGroupId }: { teamId: string, toGroupId: string | null }) => {
      requireTenantContext();
      const dbGroupId = toGroupId === 'unassigned' ? null : toGroupId;
      const { data, error } = await supabase.rpc('assign_team_to_group_v1', {
        p_event_id: currentEventId,
        p_team_id: teamId,
        p_group_id: dbGroupId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', activeTenantId, currentEventId] });
      queryClient.invalidateQueries({ queryKey: ['teams', activeTenantId, currentEventId] });
      queryClient.invalidateQueries({ queryKey: ['matches', activeTenantId, currentEventId] });
    }
  });

  return { clearAllGroups, setupGroups, autoGroupTeams, moveTeamToGroup };
}

export function useMatchMutations() {
  const queryClient = useQueryClient();
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const currentEventId = useTournamentStore((state) => state.currentEventId);
  const tournament = useTournamentStore((state) => state.tournament);
  const tenantId = activeTenantId !== 'default' ? activeTenantId : null;
  const mapMatchToDbInsert = (match: any) => ({
    id: match.id,
    group_id: match.groupId,
    team_a_id: match.teamAId,
    team_b_id: match.teamBId,
    score_a: match.scoreA,
    score_b: match.scoreB,
    winner_id: match.winnerId,
    status: match.status,
    round: match.round,
    event_id: currentEventId,
    tenant_id: tenantId,
    tournament_id: tournament.id || null,
    placeholder_a: match.placeholderA || null,
    placeholder_b: match.placeholderB || null,
    knockout_round_name: match.knockoutRoundName || null,
    knockout_match_id: match.knockoutMatchId || null,
    next_match_id: match.nextMatchId || null,
    next_match_slot: match.nextMatchSlot || null,
  });

  const updateMatchScore = useMutation({
    mutationFn: async ({ matchId, scoreA, scoreB }: { matchId: string, scoreA: number | null, scoreB: number | null }) => {
      if (scoreA !== null && scoreB !== null) {
         await supabase.rpc('update_match_score_v1', { p_match_id: matchId, p_score_a: scoreA, p_score_b: scoreB });
      } else {
         const { error } = await supabase.from('matches').update({ score_a: null, score_b: null, winner_id: null, status: 'pending' }).eq('id', matchId);
         if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches', activeTenantId, currentEventId] });
    }
  });

  const resetMatchScore = useMutation({
    mutationFn: async (matchId: string) => {
      const { error } = await supabase.from('matches').update({ score_a: null, score_b: null, winner_id: null, status: 'pending' }).eq('id', matchId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches', activeTenantId, currentEventId] });
    }
  });

  const generateForGroup = useMutation({
    mutationFn: async ({ groupId, teamIds }: { groupId: string, teamIds: string[] }) => {
      // 1. Delete old matches for this group
      await supabase.from('matches').delete().eq('group_id', groupId);
      // 2. Local generation
      const newMatches = generateRoundRobinMatches(groupId, teamIds, tournament.settings);
      // 3. Map to DB inserts
      const dbMatches = newMatches.map(mapMatchToDbInsert);
      if (dbMatches.length > 0) {
        const { error } = await supabase.from('matches').insert(dbMatches);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches', activeTenantId, currentEventId] });
    }
  });

  const generateAllSchedules = useMutation({
    mutationFn: async (groups: any[]) => {
      // Delete old group matches
      await supabase.from('matches').delete().eq('event_id', currentEventId).neq('group_id', 'knockout');
      let allNewMatches: any[] = [];
      
      groups.forEach(group => {
        if (group && group.teamIds && group.teamIds.length > 0) {
          const generated = generateRoundRobinMatches(group.id, group.teamIds, tournament.settings);
          allNewMatches = [...allNewMatches, ...generated];
        }
      });
      
      const latestMatched = balanceMatchesRestTime(allNewMatches);
      const dbMatches = latestMatched.map(mapMatchToDbInsert);
      
      if (dbMatches.length > 0) {
        const { error } = await supabase.from('matches').insert(dbMatches);
        if (error) throw error;
      }
    },
    onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['matches', activeTenantId, currentEventId] });
    }
  });

  const updateMatchStatus = useMutation({
    mutationFn: async ({ matchId, status }: { matchId: string, status: 'pending' | 'playing' | 'finished' }) => {
      const { error } = await supabase.from('matches').update({ status }).eq('id', matchId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches', activeTenantId, currentEventId] });
    }
  });

  return { updateMatchScore, resetMatchScore, generateForGroup, generateAllSchedules, updateMatchStatus };
}
