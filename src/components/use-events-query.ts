import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTournamentStore } from '../store';
import { isPublicViewerRoute, isTournamentDataRoute, isUsableEventId } from '../hooks/useEvents';
import { tournamentRpc } from '../lib/api/tournamentRpc';

export function useEventsQuery() {
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const activeTournamentId = useTournamentStore((state) => state.activeTournamentId);
  const tournamentId = useTournamentStore((state) => state.tournament.id);
  const currentEnterpriseUser = useTournamentStore((state) => state.currentEnterpriseUser);
  const currentEventId = useTournamentStore((state) => state.currentEventId);
  const setCurrentEvent = useTournamentStore((state) => state.setCurrentEvent);
  const userRole = useTournamentStore((state) => state.userRole);
  const shouldUsePublicSnapshot = userRole === 'guest' && isPublicViewerRoute();
  const shouldLoadTournamentData = isTournamentDataRoute();
  const commercialAccessActive = currentEnterpriseUser?.tenant_type !== 'self_service_customer'
    || currentEnterpriseUser?.business_access_active !== false;

  const query = useQuery({
    queryKey: ['events', activeTournamentId || tournamentId],
    queryFn: async () => {
      const scopedTournamentId = activeTournamentId || tournamentId;
      if (!scopedTournamentId || scopedTournamentId === 't-1') {
        return [];
      }

      let events = await tournamentRpc.listEventsByTournament(scopedTournamentId);
      
      // Client-side visual filter fallback. RLS already enforced this at DB level
      if (currentEnterpriseUser?.role === 'EVENT_ADMIN' || currentEnterpriseUser?.role === 'REFEREE') {
        const allowedEventIds = currentEnterpriseUser.event_ids || [];
        events = events.filter((evt: any) => allowedEventIds.includes(evt.id));
      }

      return events;
    },
    enabled: commercialAccessActive && shouldLoadTournamentData && !shouldUsePublicSnapshot && !!activeTenantId
      && activeTenantId !== 'default' && !!(activeTournamentId || tournamentId),
  });

  useEffect(() => {
    if (shouldUsePublicSnapshot) return;
    const events = query.data || [];
    if (events.length === 0) return;

    const hasSelectedEvent = isUsableEventId(currentEventId) && events.some((event: any) => event.id === currentEventId);
    if (!hasSelectedEvent) {
      setCurrentEvent(events[0].id);
    }
  }, [query.data, currentEventId, setCurrentEvent, shouldUsePublicSnapshot]);

  return query;
}

export function useEventMembersQuery(eventId: string | null) {
  return useQuery({
    queryKey: ['event_members', eventId],
    queryFn: async () => {
      if (!eventId) {
        return {
          grants: [],
          eligible_accounts: [],
        };
      }

      return tournamentRpc.listEventAccess(eventId);
    },
    enabled: !!eventId,
  });
}
