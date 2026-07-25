import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';
import { normalizeTenantIdForRpc } from '../lib/auth/workspaceAccessService';

export interface TournamentWorkspaceStat {
  tournament_id: string;
  name: string;
  slug: string;
  created_at: string;
  settings: any;
  status: string;
  tenant_id?: string;
  tenant_name?: string | null;
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
  next_cursor: WorkspaceCursor | null;
  has_more: boolean;
}

export type WorkspaceDirectoryPhase = 'operational' | 'history' | 'all';

export interface WorkspaceCursor {
  created_at: string;
  id: string;
}

export interface WorkspaceDirectoryQuery {
  limit?: number;
  phase?: WorkspaceDirectoryPhase;
  search?: string;
  tenantId?: string | null;
}

export function useTournamentWorkspaces(options: WorkspaceDirectoryQuery = {}) {
  const limit = Math.min(Math.max(options.limit || 50, 1), 100);
  const phase = options.phase || 'operational';
  const search = options.search?.trim() || null;
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const currentEnterpriseUser = useTournamentStore((state) => state.currentEnterpriseUser);
  const scopedTenantId = normalizeTenantIdForRpc(currentEnterpriseUser?.tenant_id || activeTenantId);
  const tenantFilter = currentEnterpriseUser?.role === 'SUPER_ADMIN'
    ? normalizeTenantIdForRpc(options.tenantId)
    : scopedTenantId;

  return useInfiniteQuery({
    queryKey: [
      'workspace_directory_page_v1',
      currentEnterpriseUser?.id,
      currentEnterpriseUser?.role,
      tenantFilter,
      phase,
      search,
      limit,
    ],
    queryFn: async ({ pageParam }): Promise<InfiniteWorkspaceResponse> => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        await useTournamentStore.getState().logout();
        throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      }

      const cursor = pageParam as WorkspaceCursor | null;
      const { data, error } = await supabase.rpc('list_accessible_workspaces_page_v1', {
        p_tenant_id: tenantFilter,
        p_phase: phase,
        p_search: search,
        p_cursor_created_at: cursor?.created_at || null,
        p_cursor_id: cursor?.id || null,
        p_limit: limit,
      });

      if (error) throw error;
      return mapWorkspacePage(data);
    },
    getNextPageParam: (lastPage) => lastPage.has_more ? lastPage.next_cursor : undefined,
    initialPageParam: null as WorkspaceCursor | null,
    enabled: !!currentEnterpriseUser,
  });
}

function mapWorkspacePage(payload: any): InfiniteWorkspaceResponse {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const nextCursor = payload?.next_cursor;
  return {
    data: rows.map((row: any) => ({
      tournament_id: row.tournament_id,
      tenant_id: row.tenant_id,
      tenant_name: row.tenant_name || null,
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
    })),
    next_cursor: nextCursor?.created_at && nextCursor?.id
      ? { created_at: nextCursor.created_at, id: nextCursor.id }
      : null,
    has_more: payload?.has_more === true,
  };
}

export async function enrichWorkspaceTenantNames(rows: TournamentWorkspaceStat[]) {
      const tenantIds = Array.from(
        new Set(rows.map((row: any) => row.tenant_id).filter((id: string | null | undefined): id is string => !!id))
      );
      const tenantNameById = new Map<string, string>();

      if (tenantIds.length > 0) {
        const { data: tenantRows } = await supabase
          .from('tenants')
          .select('id, name')
          .in('id', tenantIds);

        (tenantRows || []).forEach((tenant: any) => {
          if (tenant.id && tenant.name) tenantNameById.set(tenant.id, tenant.name);
        });
      }

  return rows.map((row) => ({
    ...row,
    tenant_name: row.tenant_name || tenantNameById.get(row.tenant_id || '') || null,
  }));
}

