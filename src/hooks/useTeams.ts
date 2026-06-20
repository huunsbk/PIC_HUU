import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';
import { isUsableEventId, useEvents } from './useEvents';

export function useTeams() {
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const currentEventId = useTournamentStore((state) => state.currentEventId);
  const { data: eventsData = [] } = useEvents();
  const selectedEventId = isUsableEventId(currentEventId) && eventsData.some((event) => event.id === currentEventId)
    ? currentEventId
    : eventsData[0]?.id;

  return useQuery({
    queryKey: ['teams', selectedEventId],
    queryFn: async () => {
      const query = supabase
        .from('teams')
        .select('id, name, group_id, seed')
        .eq('event_id', selectedEventId)
        .eq('tenant_id', activeTenantId)
        .is('deleted_at', null);

      const { data, error } = await query;
      if (error) throw error;
      
      return (data || []).map((team) => ({
        ...team,
        groupId: team.group_id || null,
      }));
    },
    enabled: !!activeTenantId && activeTenantId !== 'default' && !!selectedEventId,
  });
}
