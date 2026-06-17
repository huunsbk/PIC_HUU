import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';

export function useEventsQuery() {
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const currentEnterpriseUser = useTournamentStore((state) => state.currentEnterpriseUser);

  return useQuery({
    queryKey: ['events', activeTenantId],
    queryFn: async () => {
      let query = supabase.from('events').select('id, name, tournament_id, tenant_id, settings, created_at').is('deleted_at', null);

      if (activeTenantId !== 'default') {
        query = query.eq('tenant_id', activeTenantId);
      } else {
        query = query.is('tenant_id', null);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      let events = data || [];
      
      // Client-side visual filter fallback. RLS already enforced this at DB level
      if (currentEnterpriseUser?.role === 'EVENT_ADMIN' || currentEnterpriseUser?.role === 'REFEREE') {
        const allowedEventIds = currentEnterpriseUser.event_ids || [];
        events = events.filter((evt: any) => allowedEventIds.includes(evt.id));
      }

      return events;
    },
    enabled: !!activeTenantId,
  });
}

// Giả định get_current_profile trả về thành viên
// Để thiết kế Zero Trust, RPC get_event_members nên được sử dụng.
// Ở đây fetch bằng account_event_permissions join accounts
export function useEventMembersQuery(eventId: string | null) {
  return useQuery({
    queryKey: ['event_members', eventId],
    queryFn: async () => {
      if (!eventId) return [];
      const { data, error } = await supabase
        .from('account_event_permissions')
        .select(`
          account_id,
          events (name),
          accounts (
            id,
            display_name,
            username,
            roles (name)
          )
        `)
        .eq('event_id', eventId)
        .is('deleted_at', null);
        
      if (error) throw error;
      return data || [];
    },
    enabled: !!eventId,
  });
}
