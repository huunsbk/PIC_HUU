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

  return useQuery({
    queryKey: ['dashboard-stats', activeTenantId],
    queryFn: async (): Promise<DashboardStats> => {
      const [teamsResult, groupsResult, matchesResult] = await Promise.all([
        supabase
          .from('teams')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', activeTenantId)
          .is('deleted_at', null),
        supabase
          .from('groups')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', activeTenantId)
          .is('deleted_at', null),
        supabase
          .from('matches')
          .select('id, group_id, status')
          .eq('tenant_id', activeTenantId)
          .is('deleted_at', null),
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
