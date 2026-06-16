import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';

export interface TournamentWorkspaceStat {
  tournament_id: string;
  name: string;
  slug: string;
  created_at: string;
  settings: any;
  status: string;
  owner_name: string | null;
  owner_account_id: string | null;
  events_count: number;
  teams_count: number;
  matches_count: number;
}

export interface InfiniteWorkspaceResponse {
  data: TournamentWorkspaceStat[];
  next_cursor: string | null;
  has_more: boolean;
}

export function useTournamentWorkspaces(limit: number = 50) {
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);

  return useInfiniteQuery({
    queryKey: ['tournament_workspaces_v6', activeTenantId, limit],
    queryFn: async ({ pageParam = null }): Promise<InfiniteWorkspaceResponse> => {
      const { data, error } = await supabase.rpc('get_tournament_workspace_dashboard_v6', {
        p_cursor: pageParam,
        p_limit: limit
      });

      if (error) throw error;
      return (data as any) || { data: [], next_cursor: null, has_more: false };
    },
    getNextPageParam: (lastPage) => lastPage.has_more ? lastPage.next_cursor : undefined,
    initialPageParam: null as string | null,
    enabled: !!activeTenantId,
  });
}

