import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';

type MatchStatRow = {
  id: string;
  group_id: string | null;
  status: string | null;
};

export type DashboardStats = {
  teamsAll: number;
  groupsAll: number;
  groupMatchesAll: number;
  finishedGroupMatchesAll: number;
  knockoutMatchesAll: number;
};

const safeCount = (count: number | null) => count ?? 0;

export function useDashboardStats() {
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const activeTournamentId = useTournamentStore((state) => state.activeTournamentId);
  const tournamentId = useTournamentStore((state) => state.tournament.id);
  const scopedTournamentId = activeTournamentId || tournamentId;

  return useQuery({
    queryKey: ['dashboard-stats', activeTenantId, scopedTournamentId],
    queryFn: async (): Promise<DashboardStats> => {
      let teamsQuery = supabase
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', activeTenantId)
        .is('deleted_at', null);
      let groupsQuery = supabase
        .from('groups')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', activeTenantId)
        .is('deleted_at', null);
      let matchesQuery = supabase
        .from('matches')
        .select('id, group_id, status')
        .eq('tenant_id', activeTenantId)
        .is('deleted_at', null);

      if (scopedTournamentId && scopedTournamentId !== 't-1') {
        teamsQuery = teamsQuery.eq('tournament_id', scopedTournamentId);
        groupsQuery = groupsQuery.eq('tournament_id', scopedTournamentId);
        matchesQuery = matchesQuery.eq('tournament_id', scopedTournamentId);
      }

      const [teamsResult, groupsResult, matchesResult] = await Promise.all([
        teamsQuery,
        groupsQuery,
        matchesQuery,
      ]);

      if (teamsResult.error) throw teamsResult.error;
      if (groupsResult.error) throw groupsResult.error;
      if (matchesResult.error) throw matchesResult.error;

      const matches = (matchesResult.data || []) as MatchStatRow[];
      const groupMatches = matches.filter((match) => match.group_id !== 'knockout');
      const knockoutMatches = matches.filter((match) => match.group_id === 'knockout');

      return {
        teamsAll: safeCount(teamsResult.count),
        groupsAll: safeCount(groupsResult.count),
        groupMatchesAll: groupMatches.length,
        finishedGroupMatchesAll: groupMatches.filter((match) => match.status === 'finished').length,
        knockoutMatchesAll: knockoutMatches.length,
      };
    },
    enabled: !!activeTenantId && activeTenantId !== 'default',
    staleTime: 15_000,
  });
}
