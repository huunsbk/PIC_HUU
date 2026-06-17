import { supabase } from "../../supabaseClient";
import { getCurrentTenant } from "../auth/tenant";

export interface SubscriptionLimit {
  max_users: number;
  max_events: number;
  max_storage_gb: number;
}

export const billingService = {
  async getTenantLimits(): Promise<SubscriptionLimit | null> {
    const tenantId = await getCurrentTenant();
    if (!tenantId) return null;

    const { data: sub } = await supabase
      .from('tenant_subscriptions')
      .select('plan_id, status')
      .eq('tenant_id', tenantId)
      .in('status', ['active', 'trial'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!sub) return null;

    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('max_users, max_events, max_storage_gb')
      .eq('id', sub.plan_id)
      .single();

    return plan;
  },

  async canCreateUser(): Promise<boolean> {
    const limits = await this.getTenantLimits();
    if (!limits) return false;

    const tenantId = await getCurrentTenant();
    const { count } = await supabase
      .from('accounts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    return (count || 0) < limits.max_users;
  },

  async canCreateEvent(): Promise<boolean> {
    const limits = await this.getTenantLimits();
    if (!limits) return false;

    const tenantId = await getCurrentTenant();
    const { count } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    return (count || 0) < limits.max_events;
  },

  async canUploadFile(fileSizeGb: number): Promise<boolean> {
    const limits = await this.getTenantLimits();
    if (!limits) return false;

    const tenantId = await getCurrentTenant();
    const { data: metric } = await supabase
      .from('tenant_metrics')
      .select('storage_bytes')
      .eq('tenant_id', tenantId)
      .single();

    const usedGb = (metric?.storage_bytes || 0) / (1024 * 1024 * 1024);
    return (usedGb + fileSizeGb) <= limits.max_storage_gb;
  }
};
