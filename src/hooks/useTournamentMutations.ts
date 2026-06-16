import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';

interface CreateTournamentWorkspaceParams {
  tournamentName: string;
  slug: string;
  plan: string;
  ownerAccountId: string; 
}

export function useCreateTournamentWorkspace() {
  const queryClient = useQueryClient();
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);

  return useMutation({
    mutationFn: async (params: CreateTournamentWorkspaceParams) => {
      const { data, error } = await supabase.rpc('create_tournament_workspace_v6', {
        p_tournament_name: params.tournamentName,
        p_slug: params.slug,
        p_plan: params.plan,
        p_account_id: params.ownerAccountId
      });

      if (error) {
        throw error;
      }
      
      if (data && data.success === false) {
         throw new Error(data.error || 'Failed to create workspace');
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament_workspaces_v6'] });
    }
  });
}

export function useArchiveTournamentWorkspace() {
   const queryClient = useQueryClient();
   return useMutation({
     mutationFn: async (tournamentId: string) => {
       const { data, error } = await supabase.rpc('archive_tournament_workspace_v6', {
         p_tournament_id: tournamentId
       });
 
       if (error) throw error;
       if (data && data.success === false) {
          throw new Error(data.error || 'Failed to archive workspace');
       }
 
       return data;
     },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['tournament_workspaces_v6'] });
     }
   });
 }
 
 export function useTransferTournamentAdmin() {
   const queryClient = useQueryClient();
   
   return useMutation({
     mutationFn: async ({ tournamentId, newAccountId }: { tournamentId: string, newAccountId: string }) => {
       const { data, error } = await supabase.rpc('transfer_tournament_owner_v6', {
         p_tournament_id: tournamentId,
         p_new_account_id: newAccountId
       });
 
       if (error) throw error;
       if (data && data.success === false) {
          throw new Error(data.error || 'Failed to transfer ownership');
       }
 
       return data;
     },
     onSuccess: () => {
       queryClient.invalidateQueries({ queryKey: ['tournament_workspaces_v6'] });
     }
   });
 }
