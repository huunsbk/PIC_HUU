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
  tenant_id?: string;
  location?: string | null;
  start_date?: string | null;
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
  const currentEnterpriseUser = useTournamentStore((state) => state.currentEnterpriseUser);

  return useInfiniteQuery({
    queryKey: ['tournaments_v1', activeTenantId, currentEnterpriseUser?.role, limit],
    queryFn: async (): Promise<InfiniteWorkspaceResponse> => {
      const tenantParam = currentEnterpriseUser?.role === 'SUPER_ADMIN' ? null : activeTenantId;
      const { data, error } = await supabase.rpc('list_tournaments_v1', {
        p_tenant_id: tenantParam
      });

      if (error) {
        throw error;
      }

      const rows = Array.isArray(data) ? data : [];
      const mapped = rows.slice(0, limit).map((row: any) => ({
        tournament_id: row.tournament_id,
        tenant_id: row.tenant_id,
        name: row.name,
        slug: row.slug,
        created_at: row.created_at,
        settings: {},
        status: row.status || 'active',
        location: row.location || null,
        start_date: row.start_date || null,
        owner_name: null,
        owner_account_id: null,
        events_count: Number(row.events_count || 0),
        teams_count: Number(row.teams_count || 0),
        matches_count: Number(row.matches_count || 0),
      }));

      return { data: mapped, next_cursor: null, has_more: false };
    },
    getNextPageParam: (lastPage) => lastPage.has_more ? lastPage.next_cursor : undefined,
    initialPageParam: null as string | null,
    enabled: !!activeTenantId,
  });
}

