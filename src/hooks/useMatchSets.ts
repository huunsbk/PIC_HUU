import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';
import type { MatchSet } from '../types';
import { isUsableEventId, useEvents } from './useEvents';

export function useMatchSets() {
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const currentEventId = useTournamentStore((state) => state.currentEventId);
  const { data: eventsData = [] } = useEvents();
  const selectedEventId = isUsableEventId(currentEventId) && eventsData.some((event) => event.id === currentEventId)
    ? currentEventId
    : eventsData[0]?.id;

  return useQuery({
    queryKey: ['match-sets', selectedEventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('match_sets')
        .select('id, match_id, tenant_id, event_id, set_number, score_a, score_b, winner_id, status, created_at, updated_at, deleted_at')
        .eq('event_id', selectedEventId)
        .eq('tenant_id', activeTenantId)
        .is('deleted_at', null)
        .order('set_number', { ascending: true });

      if (error) throw error;
      return (data || []) as MatchSet[];
    },
    enabled: !!activeTenantId && activeTenantId !== 'default' && !!selectedEventId,
  });
}
