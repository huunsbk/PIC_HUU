import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTournamentStore } from '../store';
import { tournamentRpc } from '../lib/api/tournamentRpc';

const LEGACY_PLACEHOLDER_UUID = ['11111111', '1111', '1111', '1111', '111111111111'].join('-');

export const PLACEHOLDER_EVENT_IDS = new Set([
  'event-default',
  LEGACY_PLACEHOLDER_UUID,
]);

export function isUsableEventId(eventId?: string | null) {
  return !!eventId && /^evt_[A-Za-z0-9]+$/.test(eventId) && !PLACEHOLDER_EVENT_IDS.has(eventId);
}

export function useEvents() {
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const activeTournamentId = useTournamentStore((state) => state.activeTournamentId);
  const tournamentId = useTournamentStore((state) => state.tournament.id);
  const currentEventId = useTournamentStore((state) => state.currentEventId);
  const setCurrentEvent = useTournamentStore((state) => state.setCurrentEvent);

  const query = useQuery({
    queryKey: ['events', activeTenantId, activeTournamentId || tournamentId],
    queryFn: async () => {
      const scopedTournamentId = activeTournamentId || tournamentId;
      if (!scopedTournamentId || scopedTournamentId === 't-1') {
        return [];
      }

      return tournamentRpc.listEventsByTournament(scopedTournamentId);
    },
    enabled: !!activeTenantId && activeTenantId !== 'default',
  });

  useEffect(() => {
    const events = query.data || [];
    if (events.length === 0) return;

    const hasSelectedEvent = isUsableEventId(currentEventId) && events.some((event) => event.id === currentEventId);
    if (!hasSelectedEvent) {
      setCurrentEvent(events[0].id);
    }
  }, [query.data, currentEventId, setCurrentEvent]);

  return query;
}
