import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';

export function useEvents() {
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);

  return useQuery({
    queryKey: ['events', activeTenantId],
    queryFn: async () => {
      const query = supabase
        .from('events')
        .select('id, name, settings')
        .is('deleted_at', null)
        .eq('tenant_id', activeTenantId);

      const { data, error } = await query;
      if (error) throw error;
      
      return data || [];
    },
    enabled: !!activeTenantId && activeTenantId !== 'default',
  });
}
