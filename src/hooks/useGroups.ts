import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';

export function useGroups() {
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const currentEventId = useTournamentStore((state) => state.currentEventId);

  return useQuery({
    queryKey: ['groups', activeTenantId, currentEventId],
    queryFn: async () => {
      const query = supabase
        .from('groups')
        .select('id, name, team_ids')
        .eq('event_id', currentEventId)
        .eq('tenant_id', activeTenantId)
        .is('deleted_at', null);
      const teamsQuery = supabase
        .from('teams')
        .select('id, group_id')
        .eq('event_id', currentEventId)
        .eq('tenant_id', activeTenantId)
        .is('deleted_at', null);

      const [{ data, error }, { data: teamRows, error: teamsError }] = await Promise.all([
        query,
        teamsQuery,
      ]);
      if (error) throw error;
      if (teamsError) throw teamsError;

      const teamIdsByGroup = new Map<string, string[]>();
      (teamRows || []).forEach((team) => {
        if (!team.group_id) return;
        const teamIds = teamIdsByGroup.get(team.group_id) || [];
        teamIds.push(team.id);
        teamIdsByGroup.set(team.group_id, teamIds);
      });
      
      return (data || []).map((group) => ({
        ...group,
        teamIds: teamIdsByGroup.get(group.id) || (Array.isArray(group.team_ids) ? group.team_ids : []),
      }));
    },
    enabled: !!activeTenantId && activeTenantId !== 'default' && !!currentEventId,
  });
}
