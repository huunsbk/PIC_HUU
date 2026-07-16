import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';

export interface TenantTournamentSummary {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  tenant_status: string;
  tenant_type: 'managed_enterprise' | 'self_service_customer';
  onboarding_status: 'pending_subscription' | 'ready' | 'suspended' | null;
  business_access_active: boolean;
  subscription_status: string | null;
  subscription_end_date: string | null;
  active_tournament_count: number;
  archived_tournament_count: number;
  account_count: number;
}

export function useTenantTournamentSummary(enabled: boolean) {
  return useQuery({
    queryKey: ['tenant_tournament_summary_v1'],
    queryFn: async (): Promise<TenantTournamentSummary[]> => {
      const { data, error } = await supabase.rpc('list_tenant_tournament_summary_v1');
      if (error) throw error;

      return (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
        tenant_id: String(row.tenant_id || ''),
        tenant_name: String(row.tenant_name || 'Chưa rõ đơn vị'),
        tenant_slug: String(row.tenant_slug || ''),
        tenant_status: String(row.tenant_status || 'active'),
        tenant_type: row.tenant_type === 'self_service_customer'
          ? 'self_service_customer'
          : 'managed_enterprise',
        onboarding_status: row.onboarding_status === 'ready'
          || row.onboarding_status === 'suspended'
          || row.onboarding_status === 'pending_subscription'
          ? row.onboarding_status
          : null,
        business_access_active: row.business_access_active === true,
        subscription_status: row.subscription_status ? String(row.subscription_status) : null,
        subscription_end_date: row.subscription_end_date ? String(row.subscription_end_date) : null,
        active_tournament_count: Number(row.active_tournament_count || 0),
        archived_tournament_count: Number(row.archived_tournament_count || 0),
        account_count: Number(row.account_count || 0),
      }));
    },
    enabled,
    staleTime: 30_000,
  });
}
