import { supabase } from "../../supabaseClient";

export const cronJobs = {
  async expireSubscriptions() {
    const now = new Date().toISOString();
    
    // Find active subscriptions past end_date
    const { data: expiredSubs, error } = await supabase
      .from('tenant_subscriptions')
      .update({ status: 'expired' })
      .lt('end_date', now)
      .in('status', ['active', 'trial'])
      .select('id, tenant_id');

    if (error) console.error("Error expiring subscriptions", error);
    return expiredSubs;
  },

  async suspendExpiredTenants() {
    // Note: For advanced SaaS apps, suspended tenants might lose login capability or shift to a read-only state.
    // We update subscriptions that have been expired for over 7 days to suspended.
    const gracePeriodEnd = new Date();
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() - 7);

    const { data: suspendedSubs, error } = await supabase
      .from('tenant_subscriptions')
      .update({ status: 'suspended' })
      .lt('end_date', gracePeriodEnd.toISOString())
      .eq('status', 'expired')
      .select('id, tenant_id');

    if (error) console.error("Error suspending subscriptions", error);
    return suspendedSubs;
  },

  async generateRenewalInvoices() {
    const upcomingRenewals = new Date();
    upcomingRenewals.setDate(upcomingRenewals.getDate() + 3);

    const { data: renewingSubs, error } = await supabase
      .from('tenant_subscriptions')
      .select('*, subscription_plans(*)')
      .lte('end_date', upcomingRenewals.toISOString())
      .eq('status', 'active');

    if (error || !renewingSubs) return [];

    const generatedInvoices = [];
    for (const sub of renewingSubs) {
      const plan = sub.subscription_plans as any;
      const amount = sub.billing_cycle === 'yearly' ? plan.yearly_price : plan.monthly_price;
      
      if (amount > 0) {
        const { data: invoice } = await supabase
          .from('invoices')
          .insert({
            tenant_id: sub.tenant_id,
            subscription_id: sub.id,
            amount: amount,
            currency: 'USD',
            status: 'pending',
            invoice_date: new Date().toISOString()
          }).select().single();
        
        generatedInvoices.push(invoice);
      }
    }
    
    return generatedInvoices;
  }
};
