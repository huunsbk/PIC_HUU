import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';

export function useGroups() {
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const currentEventId = useTournamentStore((state) => state.currentEventId);

  return useQuery({
    queryKey: ['groups', activeTenantId, currentEventId],
    queryFn: async () => {
      let query = supabase.from('groups').select('id, name, team_ids').eq('event_id', currentEventId).is('deleted_at', null);

      if (activeTenantId !== 'default') {
        query = query.eq('tenant_id', activeTenantId);
      } else {
        query = query.is('tenant_id', null);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      return data || [];
    },
    enabled: !!activeTenantId && !!currentEventId,
  });
}
