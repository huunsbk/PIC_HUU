import { supabase } from "../../supabaseClient";
import { getCurrentTenant } from "../auth/tenant";

export const subscriptionService = {
  async getCurrentSubscription() {
    const tenantId = await getCurrentTenant();
    if (!tenantId) return null;

    const { data, error } = await supabase
      .from('tenant_subscriptions')
      .select(`
        *,
        subscription_plans (*)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) return null;
    return data;
  },

  async activateSubscription(planCode: string, billingCycle: 'monthly' | 'yearly') {
    const tenantId = await getCurrentTenant();
    if (!tenantId) throw new Error("No tenant");

    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('id')
      .eq('code', planCode)
      .single();

    if (!plan) throw new Error("Plan not found");

    const startDate = new Date();
    const endDate = new Date();
    if (billingCycle === 'yearly') endDate.setFullYear(endDate.getFullYear() + 1);
    else endDate.setMonth(endDate.getMonth() + 1);

    const { data, error } = await supabase
      .from('tenant_subscriptions')
      .insert({
        tenant_id: tenantId,
        plan_id: plan.id,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        status: 'active',
        billing_cycle: billingCycle
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async cancelSubscription(subscriptionId: string) {
    const { error } = await supabase
      .from('tenant_subscriptions')
      .update({ status: 'cancelled' })
      .eq('id', subscriptionId);

    if (error) throw error;
    return true;
  },

  async renewSubscription(subscriptionId: string) {
    const { data: sub } = await supabase
      .from('tenant_subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .single();
    
    if (!sub) throw new Error("Subscription not found");

    const currentEnd = new Date(sub.end_date);
    const newEnd = new Date(currentEnd);
    if (sub.billing_cycle === 'yearly') newEnd.setFullYear(newEnd.getFullYear() + 1);
    else newEnd.setMonth(newEnd.getMonth() + 1);

    const { error } = await supabase
      .from('tenant_subscriptions')
      .update({ end_date: newEnd.toISOString(), status: 'active' })
      .eq('id', subscriptionId);

    if (error) throw error;
    return true;
  },

  async checkExpiration(subscriptionId: string) {
    const { data: sub } = await supabase
      .from('tenant_subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .single();
    
    if (!sub) return false;
    return new Date(sub.end_date) < new Date();
  }
};
