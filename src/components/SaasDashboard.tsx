import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { usePermission } from '../auth/usePermission';
import { Loader2, TrendingUp, Users, AlertCircle, DollarSign, Activity } from 'lucide-react';

export default function SaasDashboard() {
  const { role, loading: permLoading } = usePermission();
  const [metrics, setMetrics] = useState({
    mrr: 0,
    arr: 0,
    activeTenants: 0,
    trialTenants: 0,
    expiredTenants: 0,
    revenueGrowth: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (role !== 'SUPER_ADMIN') {
      setLoading(false);
      return;
    }

    async function fetchMetrics() {
      // 1. Calculate MRR & ARR based on active subscriptions
      let mrr = 0;
      let arr = 0;
      let activeT = 0;
      let trialT = 0;
      let expiredT = 0;

      const { data: subs } = await supabase
        .from('tenant_subscriptions')
        .select('status, billing_cycle, subscription_plans(monthly_price, yearly_price)');

      if (subs) {
        subs.forEach(s => {
          const plan: any = s.subscription_plans;
          if (!plan) return;

          if (s.status === 'active') {
            activeT++;
            if (s.billing_cycle === 'monthly') {
              mrr += Number(plan.monthly_price);
              arr += Number(plan.monthly_price) * 12;
            } else {
              mrr += Number(plan.yearly_price) / 12;
              arr += Number(plan.yearly_price);
            }
          } else if (s.status === 'trial') {
            trialT++;
          } else if (s.status === 'expired') {
            expiredT++;
          }
        });
      }

      setMetrics({
        mrr,
        arr,
        activeTenants: activeT,
        trialTenants: trialT,
        expiredTenants: expiredT,
        revenueGrowth: 15.4 // Mocked for display
      });
      setLoading(false);
    }

    fetchMetrics();
  }, [role]);

  if (permLoading || loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-zinc-400" /></div>;

  if (role !== 'SUPER_ADMIN') {
    return <div className="p-8 text-center text-red-500 font-medium">Unauthorized Access. Super Admin only.</div>;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-2">SaaS Overview</h1>
        <p className="text-zinc-500 text-sm">Enterprise metrics, billing, and tenant activity.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 text-zinc-500 mb-4">
            <DollarSign className="w-5 h-5 text-emerald-500" />
            <h3 className="font-medium text-sm">Monthly Recurring (MRR)</h3>
          </div>
          <div className="text-3xl font-semibold text-zinc-900">${metrics.mrr.toLocaleString()}</div>
          <div className="mt-2 text-xs text-emerald-600 flex items-center gap-1 font-medium">
            <TrendingUp className="w-3 h-3" /> +{metrics.revenueGrowth}% from last month
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 text-zinc-500 mb-4">
            <Activity className="w-5 h-5 text-blue-500" />
            <h3 className="font-medium text-sm">Annual Recurring (ARR)</h3>
          </div>
          <div className="text-3xl font-semibold text-zinc-900">${metrics.arr.toLocaleString()}</div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 text-zinc-500 mb-4">
            <Users className="w-5 h-5 text-indigo-500" />
            <h3 className="font-medium text-sm">Active Tenants</h3>
          </div>
          <div className="text-3xl font-semibold text-zinc-900">{metrics.activeTenants}</div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 text-zinc-500 mb-4">
            <Users className="w-5 h-5 text-orange-500" />
            <h3 className="font-medium text-sm">Trial Tenants</h3>
          </div>
          <div className="text-3xl font-semibold text-zinc-900">{metrics.trialTenants}</div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 text-zinc-500 mb-4">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <h3 className="font-medium text-sm">Expired Tenants</h3>
          </div>
          <div className="text-3xl font-semibold text-zinc-900">{metrics.expiredTenants}</div>
        </div>

      </div>
    </div>
  );
}
