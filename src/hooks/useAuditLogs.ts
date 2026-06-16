import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';

export function useAuditLogs(limit: number = 50) {
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);

  return useInfiniteQuery({
    queryKey: ['auditLogs', activeTenantId, limit],
    queryFn: async ({ pageParam = null }): Promise<any> => {
      let query = supabase
        .from('audit_logs')
        .select('id, action, details, timestamp, created_at')
        .order('created_at', { ascending: false })
        .limit(limit + 1);

      if (pageParam) {
        query = query.lt('created_at', pageParam);
      }

      if (activeTenantId !== 'default') {
        query = query.eq('tenant_id', activeTenantId);
      } else {
        query = query.is('tenant_id', null);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      const hasMore = data && data.length > limit;
      const slicedData = hasMore ? data.slice(0, limit) : (data || []);
      const nextCursor = hasMore ? slicedData[slicedData.length - 1].created_at : null;

      return {
        data: slicedData,
        has_more: hasMore,
        next_cursor: nextCursor
      };
    },
    getNextPageParam: (lastPage) => lastPage.has_more ? lastPage.next_cursor : undefined,
    initialPageParam: null as string | null,
    enabled: !!activeTenantId,
  });
}
