import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';
import { EventData } from '../types';

export function useEvents() {
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);

  return useQuery({
    queryKey: ['events', activeTenantId],
    queryFn: async () => {
      let query = supabase.from('events').select('id, name, settings, current_stage, active_group_id, start_date, end_date').is('deleted_at', null);

      if (activeTenantId !== 'default') {
        query = query.eq('tenant_id', activeTenantId);
      } else {
        query = query.is('tenant_id', null);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      return data || [];
    },
    enabled: !!activeTenantId,
  });
}
