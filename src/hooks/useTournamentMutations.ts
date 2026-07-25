import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';
import { normalizeRpcError } from '../lib/api/tournamentRpc';

interface CreateTournamentWorkspaceParams {
  tournamentName: string;
  slug: string;
  tenantId?: string | null;
  location?: string | null;
  startDate?: string | null;
}

export function useCreateTournamentWorkspace() {
  const queryClient = useQueryClient();
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);

  return useMutation({
    mutationFn: async (params: CreateTournamentWorkspaceParams) => {
      const tenantId = params.tenantId || activeTenantId;
      if (!tenantId || tenantId === 'default') {
        throw new Error('Vui lòng chọn đơn vị trước khi tạo giải đấu.');
      }

      const { data, error } = await supabase.rpc('create_tournament_v1', {
        p_tenant_id: tenantId,
        p_name: params.tournamentName,
        p_slug: params.slug,
        p_location: params.location || null,
        p_start_date: params.startDate || null
      });

      if (error) {
        throw normalizeRpcError(error);
      }
      
      if (data && data.success === false) {
         throw new Error(data.error || 'Không thể tạo giải đấu');
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant_tournament_summary_v1'] });
      queryClient.invalidateQueries({ queryKey: ['tournaments_v1'] });
      queryClient.invalidateQueries({ queryKey: ['workspace_directory_page_v1'] });
      queryClient.invalidateQueries({ queryKey: ['tournament_workspaces_v6'] });
      queryClient.invalidateQueries({ queryKey: ['commercial_access_state'] });
    }
  });
}

export function useEnsureSelfServiceWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tenantId: string) => {
      if (!tenantId || tenantId === 'default') {
        throw new Error('Không xác định được đơn vị cần khởi tạo giải.');
      }

      const { data, error } = await supabase.rpc('admin_ensure_self_service_workspace_v1', {
        p_tenant_id: tenantId,
      });

      if (error) throw normalizeRpcError(error);
      if (data?.success === false) {
        throw new Error(data.error || 'Không thể khởi tạo giải mặc định.');
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant_tournament_summary_v1'] });
      queryClient.invalidateQueries({ queryKey: ['tournaments_v1'] });
      queryClient.invalidateQueries({ queryKey: ['workspace_directory_page_v1'] });
      queryClient.invalidateQueries({ queryKey: ['tournament_workspaces_v6'] });
      queryClient.invalidateQueries({ queryKey: ['commercial_access_state'] });
    },
  });
}

export function useArchiveTournamentWorkspace() {
   const queryClient = useQueryClient();
   return useMutation({
     mutationFn: async (tournamentId: string) => {
       const { data, error } = await supabase.rpc('archive_tournament_v1', {
         p_tournament_id: tournamentId
       });
 
       if (error) throw error;
       if (data && data.success === false) {
          throw new Error(data.error || 'Không thể lưu trữ giải đấu');
       }
 
       return data;
     },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['tournaments_v1'] });
       queryClient.invalidateQueries({ queryKey: ['workspace_directory_page_v1'] });
       queryClient.invalidateQueries({ queryKey: ['tournament_workspaces_v6'] });
       queryClient.invalidateQueries({ queryKey: ['commercial_access_state'] });
     }
   });
 }

export function useUpdateTournamentWorkspace() {
   const queryClient = useQueryClient();
   return useMutation({
     mutationFn: async (params: {
       tournamentId: string;
       name: string;
       slug: string;
       location?: string | null;
       startDate?: string | null;
       status?: string | null;
     }) => {
       const { data, error } = await supabase.rpc('update_tournament_v1', {
         p_tournament_id: params.tournamentId,
         p_name: params.name,
         p_slug: params.slug,
         p_location: params.location || null,
         p_start_date: params.startDate || null,
         p_status: params.status || null
       });

       if (error) throw error;
       if (data && data.success === false) {
          throw new Error(data.error || 'Không thể cập nhật giải đấu');
       }

       return data;
     },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['tournaments_v1'] });
       queryClient.invalidateQueries({ queryKey: ['workspace_directory_page_v1'] });
       queryClient.invalidateQueries({ queryKey: ['tournament_workspaces_v6'] });
       queryClient.invalidateQueries({ queryKey: ['commercial_access_state'] });
     }
   });
}

export function useRestoreTournamentWorkspace() {
   const queryClient = useQueryClient();
   return useMutation({
     mutationFn: async (tournamentId: string) => {
       const { data, error } = await supabase.rpc('restore_tournament_v1', {
         p_tournament_id: tournamentId
       });

       if (error) throw error;
       if (data && data.success === false) {
          throw new Error(data.error || 'Không thể khôi phục giải đấu');
       }

       return data;
     },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['tournaments_v1'] });
       queryClient.invalidateQueries({ queryKey: ['workspace_directory_page_v1'] });
       queryClient.invalidateQueries({ queryKey: ['tournament_workspaces_v6'] });
       queryClient.invalidateQueries({ queryKey: ['commercial_access_state'] });
     }
   });
}

export function useTransferTournamentAdmin() {
   const queryClient = useQueryClient();

   return useMutation({
     mutationFn: async ({ tournamentId, newAccountId }: { tournamentId: string, newAccountId: string }) => {
       void tournamentId;
       void newAccountId;
       throw new Error('Chuyển owner giải đấu chưa được nối lại trong Prompt 07-C.');
     },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['tournament_workspaces_v6'] });
     }
   });
}
