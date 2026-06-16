import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';
import { generateRoundRobinMatches, balanceMatchesRestTime } from '../utils/tournamentEngine';

export function useTeamMutations() {
  const queryClient = useQueryClient();
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const currentEventId = useTournamentStore((state) => state.currentEventId);

  const addTeam = useMutation({
    mutationFn: async (data: { name: string, seed: string }) => {
      const { name, seed } = data;
      const { data: result, error } = await supabase
        .from('teams')
        .insert([{
          name,
          seed,
          event_id: currentEventId,
          tenant_id: activeTenantId !== 'default' ? activeTenantId : null
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
      // Soft delete
      const deletedAt = new Date().toISOString();
      const { error } = await supabase
        .from('teams')
        .update({ deleted_at: deletedAt })
        .eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams', activeTenantId, currentEventId] });
      queryClient.invalidateQueries({ queryKey: ['matches', activeTenantId, currentEventId] });
    }
  });

  const importTeams = useMutation({
    mutationFn: async (csvContent: string) => {
      const lines = csvContent.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      // Skip header if contains specific keywords
      let startIndex = 0;
      if (lines.length > 0 && lines[0].toLowerCase().includes('tên đội') || lines[0].toLowerCase().includes('team')) {
        startIndex = 1;
      }

      const rawInputs = lines.slice(startIndex).map(line => line.split(','));
      const inserts = [];

      for (const columns of rawInputs) {
        if (!columns[0]) continue;
        const name = columns[0].trim();
        if (!name) continue;

        let seed = 'none';
        if (columns[1]) {
          const rawSeed = columns[1].trim().toLowerCase();
          if (['hạt giống 1', 'seed 1', '1'].includes(rawSeed)) seed = 'seed1';
          else if (['hạt giống 2', 'seed 2', '2'].includes(rawSeed)) seed = 'seed2';
          else if (['hạt giống 3', 'seed 3', '3'].includes(rawSeed)) seed = 'seed3';
          else if (['vượt qua vòng loại', 'qualified', 'q'].includes(rawSeed)) seed = 'qualified';
        }
        
        inserts.push({
           name,
           seed,
           event_id: currentEventId,
           tenant_id: activeTenantId !== 'default' ? activeTenantId : null
        });
      }

      if (inserts.length > 0) {
         const { error } = await supabase.from('teams').insert(inserts);
         if (error) throw error;
      }
      return inserts.length;
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

  const clearAllGroups = useMutation({
     mutationFn: async () => {
       const deletedAt = new Date().toISOString();
       await supabase.from('groups').update({ deleted_at: deletedAt }).eq('event_id', currentEventId);
     },
     onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['groups', activeTenantId, currentEventId] });
     }
  });

  const setupGroups = useMutation({
     mutationFn: async (numGroups: number) => {
        await supabase.rpc('setup_groups_v1', { p_event_id: currentEventId, p_num_groups: numGroups });
     },
     onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['groups', activeTenantId, currentEventId] });
        queryClient.invalidateQueries({ queryKey: ['teams', activeTenantId, currentEventId] });
     }
  });

  const autoGroupTeams = useMutation({
    mutationFn: async () => {
      // Basic auto group logic: distribute teams evenly across existing groups
      // Better to do this via an RPC or query teams and groups, update them.
      // Since it requires a bit of logic, we can do it client side and then bulk update teams.
      const { data: groups } = await supabase.from('groups').select('*').eq('event_id', currentEventId).is('deleted_at', null);
      const { data: teams } = await supabase.from('teams').select('*').eq('event_id', currentEventId).is('deleted_at', null);
      if (!groups || !teams || groups.length === 0 || teams.length === 0) return;

      const sortedTeams = [...teams].sort((a,b) => {
        return (a.seed || '').localeCompare(b.seed || ''); // very basic seed sorting
      });

      const updates: any[] = [];
      sortedTeams.forEach((team, index) => {
         const groupIndex = index % groups.length;
         updates.push({ id: team.id, group_id: groups[groupIndex].id });
      });

      // Execute bulk update
      for (const update of updates) {
         await supabase.from('teams').update({ group_id: update.group_id }).eq('id', update.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', activeTenantId, currentEventId] });
      queryClient.invalidateQueries({ queryKey: ['teams', activeTenantId, currentEventId] });
    }
  });

  const moveTeamToGroup = useMutation({
    mutationFn: async ({ teamId, fromGroupId, toGroupId }: { teamId: string, fromGroupId: string, toGroupId: string }) => {
      const dbGroupId = toGroupId === 'unassigned' ? null : toGroupId;
      await supabase.from('teams').update({ group_id: dbGroupId }).eq('id', teamId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', activeTenantId, currentEventId] });
      queryClient.invalidateQueries({ queryKey: ['teams', activeTenantId, currentEventId] });
    }
  });

  return { clearAllGroups, setupGroups, autoGroupTeams, moveTeamToGroup };
}

export function useMatchMutations() {
  const queryClient = useQueryClient();
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const currentEventId = useTournamentStore((state) => state.currentEventId);
  const tournament = useTournamentStore((state) => state.tournament);

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
      const dbMatches = newMatches.map(m => ({
        ...m,
        event_id: currentEventId,
        tenant_id: activeTenantId !== 'default' ? activeTenantId : null,
      }));
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
      const dbMatches = latestMatched.map(m => ({
        ...m,
        event_id: currentEventId,
        tenant_id: activeTenantId !== 'default' ? activeTenantId : null,
      }));
      
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
