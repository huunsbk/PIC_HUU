import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Archive, RotateCcw, Plus, ShieldAlert } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';

interface TenantRow {
  tenant_id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  account_count: number;
  tournament_count: number;
}

export default function TenantManagementPage() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const queryClient = useQueryClient();
  const currentEnterpriseUser = useTournamentStore((state) => state.currentEnterpriseUser);
  const setWorkspaceContext = useTournamentStore((state) => state.setWorkspaceContext);
  const setSelectedTab = useTournamentStore((state) => state.setSelectedTab);

  const isSuperAdmin = currentEnterpriseUser?.role === 'SUPER_ADMIN';

  const tenantsQuery = useQuery({
    queryKey: ['tenants_v1'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_tenants_v1');
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as TenantRow[];
    },
    enabled: isSuperAdmin,
  });

  const createTenant = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('create_tenant_v1', {
        p_name: name,
        p_slug: slug,
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || 'Không thể tạo đơn vị.');
      return data;
    },
    onSuccess: () => {
      setName('');
      setSlug('');
      queryClient.invalidateQueries({ queryKey: ['tenants_v1'] });
    },
  });

  const archiveTenant = useMutation({
    mutationFn: async (tenantId: string) => {
      const { data, error } = await supabase.rpc('archive_tenant_v1', { p_tenant_id: tenantId });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || 'Không thể lưu trữ đơn vị.');
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenants_v1'] }),
  });

  const restoreTenant = useMutation({
    mutationFn: async (tenantId: string) => {
      const { data, error } = await supabase.rpc('restore_tenant_v1', { p_tenant_id: tenantId });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || 'Không thể khôi phục đơn vị.');
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenants_v1'] }),
  });

  const updateTenant = useMutation({
    mutationFn: async (tenant: TenantRow) => {
      const nameValue = window.prompt('Tên đơn vị', tenant.name);
      if (!nameValue || nameValue.trim() === tenant.name) return null;
      const { data, error } = await supabase.rpc('update_tenant_v1', {
        p_tenant_id: tenant.tenant_id,
        p_name: nameValue.trim(),
        p_slug: tenant.slug,
        p_status: tenant.status,
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || 'Không thể cập nhật đơn vị.');
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenants_v1'] }),
  });

  const generateSlug = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-zinc-900 rounded-xl border border-red-100 dark:border-red-900/30">
        <ShieldAlert className="w-12 h-12 text-red-500 mb-4" />
        <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Chỉ SUPER_ADMIN được quản lý đơn vị</h3>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-1">
          <Building2 className="text-blue-600" size={24} />
          <h1 className="text-2xl font-black text-zinc-950 dark:text-zinc-50">Quản lý đơn vị</h1>
        </div>
        <p className="text-sm text-zinc-500">Tạo, lưu trữ và khôi phục tenant trước khi tạo giải đấu thuộc tenant đó.</p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          createTenant.mutate();
        }}
        className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4"
      >
        <input
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slug || slug === generateSlug(name)) setSlug(generateSlug(e.target.value));
          }}
          placeholder="Tên đơn vị"
          className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-semibold"
        />
        <input
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="slug-don-vi"
          className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono"
        />
        <button
          type="submit"
          disabled={createTenant.isPending}
          className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Plus size={16} /> Tạo đơn vị
        </button>
      </form>

      {createTenant.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {(createTenant.error as Error).message}
        </div>
      )}

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Đơn vị</th>
                <th className="text-left px-4 py-3">Slug</th>
                <th className="text-left px-4 py-3">Trạng thái</th>
                <th className="text-left px-4 py-3">Ngày tạo</th>
                <th className="text-right px-4 py-3">Giải</th>
                <th className="text-right px-4 py-3">Tài khoản</th>
                <th className="text-right px-4 py-3">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {tenantsQuery.isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">Đang tải đơn vị...</td></tr>
              ) : tenantsQuery.error ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-red-600">{(tenantsQuery.error as Error).message}</td></tr>
              ) : tenantsQuery.data?.length ? tenantsQuery.data.map((tenant) => (
                <tr key={tenant.tenant_id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="px-4 py-3 font-bold text-zinc-900 dark:text-zinc-100">{tenant.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{tenant.slug}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${tenant.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>
                      {tenant.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{new Date(tenant.created_at).toLocaleDateString('vi-VN')}</td>
                  <td className="px-4 py-3 text-right font-bold">{tenant.tournament_count}</td>
                  <td className="px-4 py-3 text-right font-bold">{tenant.account_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setWorkspaceContext({ tenantId: tenant.tenant_id, tenantName: tenant.name });
                          setSelectedTab('workspaces');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold hover:bg-blue-100"
                      >
                        Xem giải
                      </button>
                      <button
                        type="button"
                        onClick={() => updateTenant.mutate(tenant)}
                        className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-bold hover:bg-amber-100"
                      >
                        Sửa
                      </button>
                      {tenant.status === 'archived' ? (
                        <button type="button" onClick={() => restoreTenant.mutate(tenant.tenant_id)} className="p-2 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100" title="Khôi phục">
                          <RotateCcw size={16} />
                        </button>
                      ) : (
                        <button type="button" onClick={() => archiveTenant.mutate(tenant.tenant_id)} className="p-2 rounded-lg bg-red-50 text-red-700 hover:bg-red-100" title="Lưu trữ">
                          <Archive size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">Chưa có đơn vị nào.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
