import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';
import { isUsableEventId, useEvents } from './useEvents';

export function useMatches() {
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const currentEventId = useTournamentStore((state) => state.currentEventId);
  const { data: eventsData = [] } = useEvents();
  const selectedEventId = isUsableEventId(currentEventId) && eventsData.some((event) => event.id === currentEventId)
    ? currentEventId
    : eventsData[0]?.id;

  return useQuery({
    queryKey: ['matches', selectedEventId],
    queryFn: async () => {
      const query = supabase
        .from('matches')
        .select('id, group_id, team_a_id, team_b_id, placeholder_a, placeholder_b, score_a, score_b, winner_id, status, round, knockout_round_name, knockout_match_id, next_match_id, next_match_slot')
        .eq('event_id', selectedEventId)
        .eq('tenant_id', activeTenantId)
        .is('deleted_at', null);

      const { data, error } = await query;
      if (error) throw error;
      
      return (data || []).map((match) => ({
        ...match,
        groupId: match.group_id,
        teamAId: match.team_a_id,
        teamBId: match.team_b_id,
        placeholderA: match.placeholder_a,
        placeholderB: match.placeholder_b,
        scoreA: match.score_a,
        scoreB: match.score_b,
        winnerId: match.winner_id,
        knockoutRoundName: match.knockout_round_name,
        knockoutMatchId: match.knockout_match_id,
        nextMatchId: match.next_match_id,
        nextMatchSlot: match.next_match_slot,
      }));
    },
    enabled: !!activeTenantId && activeTenantId !== 'default' && !!selectedEventId,
  });
}
