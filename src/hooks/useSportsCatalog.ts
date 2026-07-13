import { useQuery } from '@tanstack/react-query';
import { tournamentRpc } from '../lib/api/tournamentRpc';

export function useSportsCatalog() {
  return useQuery({
    queryKey: ['sports-catalog'],
    queryFn: () => tournamentRpc.listActiveSports(),
    staleTime: 5 * 60 * 1000,
  });
}
