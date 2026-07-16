import React, { useState } from 'react';
import {
  ArchiveRestore,
  ArrowRight,
  Building2,
  CircleCheck,
  Clock3,
  Filter,
  Loader2,
  Plus,
  Search,
  ShieldAlert,
  Trophy,
  Wrench,
} from 'lucide-react';
import { useTournamentWorkspaces } from '../hooks/useTournamentWorkspaces';
import { useTenantTournamentSummary, TenantTournamentSummary } from '../hooks/useTenantTournamentSummary';
import { useEnsureSelfServiceWorkspace } from '../hooks/useTournamentMutations';
import { useTournamentStore } from '../store';
import TournamentWorkspaceCard from './TournamentWorkspaceCard';
import CreateTournamentWorkspaceDialog, { TournamentTenantChoice } from './CreateTournamentWorkspaceDialog';

type AssistanceState = {
  label: string;
  detail: string;
  badgeClass: string;
  action: 'create' | 'ensure' | 'none';
};

function getAssistanceState(tenant: TenantTournamentSummary): AssistanceState {
  if (tenant.archived_tournament_count > 0) {
    return {
      label: 'Có giải đã lưu trữ',
      detail: 'Khôi phục giải trong mục Đã xóa để tránh tạo trùng dữ liệu.',
      badgeClass: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
      action: 'none',
    };
  }

  if (tenant.tenant_type === 'managed_enterprise') {
    return {
      label: 'Có thể tạo ngay',
      detail: 'SUPER_ADMIN nhập thông tin và tạo giải trực tiếp cho đơn vị.',
      badgeClass: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
      action: 'create',
    };
  }

  if (tenant.onboarding_status !== 'ready') {
    return {
      label: 'Chờ mở khóa',
      detail: 'Khách hàng cần hoàn tất gói dịch vụ trước khi hệ thống tạo giải.',
      badgeClass: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
      action: 'none',
    };
  }

  if (!tenant.business_access_active) {
    return {
      label: 'Gói chưa hoạt động',
      detail: 'Không tạo giải khi thuê bao đã hết hạn hoặc chưa được kích hoạt.',
      badgeClass: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300',
      action: 'none',
    };
  }

  return {
    label: 'Cần khởi tạo lại',
    detail: 'Gói đã hoạt động nhưng chưa có giải; có thể chạy lại tác vụ idempotent.',
    badgeClass: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
    action: 'ensure',
  };
}

function toTenantChoice(tenant: TenantTournamentSummary): TournamentTenantChoice {
  return {
    tenantId: tenant.tenant_id,
    tenantName: tenant.tenant_name,
    tenantSlug: tenant.tenant_slug,
  };
}

export default function TournamentWorkspaceListPage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createTargetTenant, setCreateTargetTenant] = useState<TournamentTenantChoice | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [actionNotice, setActionNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const limit = 50;
  const {
    data: workspacesResponse,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useTournamentWorkspaces(limit);
  const currentEnterpriseUser = useTournamentStore((state) => state.currentEnterpriseUser);
  const hasPermission = useTournamentStore((state) => state.hasPermission);
  const setSelectedTab = useTournamentStore((state) => state.setSelectedTab);
  const isSuperAdmin = currentEnterpriseUser?.role === 'SUPER_ADMIN';
  const tenantSummaryQuery = useTenantTournamentSummary(isSuperAdmin);
  const ensureSelfServiceWorkspace = useEnsureSelfServiceWorkspace();
  const isSelfServiceCustomer = currentEnterpriseUser?.tenant_type === 'self_service_customer';
  const canManageTournaments = !isSelfServiceCustomer
    && (hasPermission('*') || hasPermission('manage_tournaments'));

  const tournaments = workspacesResponse?.pages.flatMap((page) => page.data) || [];
  const tenantSummaries = tenantSummaryQuery.data || [];
  const managedTenantOptions = React.useMemo(
    () => tenantSummaries
      .filter((tenant) => (
        tenant.tenant_status === 'active'
        && tenant.tenant_type === 'managed_enterprise'
        && !(tenant.active_tournament_count === 0 && tenant.archived_tournament_count > 0)
      ))
      .sort((a, b) => a.tenant_name.localeCompare(b.tenant_name, 'vi'))
      .map(toTenantChoice),
    [tenantSummaries],
  );

  const tenantOptions = React.useMemo(() => {
    const names = new Set<string>();
    tournaments.forEach((tournament) => names.add(tournament.tenant_name || tournament.tenant_id || 'Chưa rõ đơn vị'));
    tenantSummaries.forEach((tenant) => names.add(tenant.tenant_name));
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [tournaments, tenantSummaries]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredTournaments = React.useMemo(() => tournaments.filter((tournament) => {
    const tenantName = tournament.tenant_name || tournament.tenant_id || 'Chưa rõ đơn vị';
    const matchesTenant = tenantFilter === 'all' || tenantName === tenantFilter;
    const status = tournament.status || 'active';
    if (status === 'archived') return false;
    const matchesStatus = statusFilter === 'all' || status === statusFilter;
    const matchesSearch = !normalizedQuery
      || tournament.name?.toLowerCase().includes(normalizedQuery)
      || tournament.slug?.toLowerCase().includes(normalizedQuery)
      || tenantName.toLowerCase().includes(normalizedQuery);
    return matchesTenant && matchesStatus && matchesSearch;
  }), [tournaments, normalizedQuery, statusFilter, tenantFilter]);

  const groupedTournaments = React.useMemo(() => {
    const groups = new Map<string, typeof filteredTournaments>();
    filteredTournaments.forEach((tournament) => {
      const tenantName = tournament.tenant_name || tournament.tenant_id || 'Chưa rõ đơn vị';
      const current = groups.get(tenantName) || [];
      current.push(tournament);
      groups.set(tenantName, current);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, 'vi'));
  }, [filteredTournaments]);

  const zeroTournamentTenants = React.useMemo(
    () => tenantSummaries.filter((tenant) => (
      tenant.tenant_status === 'active' && tenant.active_tournament_count === 0
    )),
    [tenantSummaries],
  );
  const filteredZeroTournamentTenants = React.useMemo(
    () => zeroTournamentTenants.filter((tenant) => {
      const matchesTenant = tenantFilter === 'all' || tenant.tenant_name === tenantFilter;
      const matchesSearch = !normalizedQuery
        || tenant.tenant_name.toLowerCase().includes(normalizedQuery)
        || tenant.tenant_slug.toLowerCase().includes(normalizedQuery);
      return matchesTenant && matchesSearch;
    }),
    [normalizedQuery, tenantFilter, zeroTournamentTenants],
  );

  const actionableManagedCount = zeroTournamentTenants.filter((tenant) => (
    getAssistanceState(tenant).action === 'create'
  )).length;
  const repairableSelfServiceCount = zeroTournamentTenants.filter((tenant) => (
    getAssistanceState(tenant).action === 'ensure'
  )).length;
  const waitingCount = zeroTournamentTenants.length - actionableManagedCount - repairableSelfServiceCount;

  const openCreateDialog = (tenant: TournamentTenantChoice | null = null) => {
    setActionNotice(null);
    setCreateTargetTenant(tenant);
    setIsCreateModalOpen(true);
  };

  const closeCreateDialog = () => {
    setIsCreateModalOpen(false);
    setCreateTargetTenant(null);
  };

  const handleEnsureSelfServiceWorkspace = (tenant: TenantTournamentSummary) => {
    const confirmed = window.confirm(
      `Khởi tạo lại giải mặc định cho "${tenant.tenant_name}"? Tác vụ không tạo trùng nếu giải đã tồn tại.`,
    );
    if (!confirmed) return;

    setActionNotice(null);
    ensureSelfServiceWorkspace.mutate(tenant.tenant_id, {
      onSuccess: (result) => {
        setActionNotice({
          tone: 'success',
          message: result?.created
            ? `Đã khởi tạo giải mặc định cho ${tenant.tenant_name}.`
            : `Giải của ${tenant.tenant_name} đã tồn tại và danh sách đã được đồng bộ.`,
        });
      },
      onError: (mutationError) => {
        setActionNotice({
          tone: 'error',
          message: mutationError instanceof Error ? mutationError.message : 'Không thể khởi tạo giải mặc định.',
        });
      },
    });
  };

  if (!currentEnterpriseUser) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-red-100 bg-white p-12 text-center dark:border-red-900/30 dark:bg-zinc-900">
        <ShieldAlert className="mb-6 h-16 w-16 animate-pulse text-red-500" />
        <h3 className="mb-2 text-2xl font-black text-zinc-900 dark:text-zinc-100">Cần đăng nhập</h3>
        <p className="max-w-md text-zinc-500 dark:text-zinc-400">Đăng nhập để xem danh sách giải đấu được phân quyền.</p>
      </div>
    );
  }

  return (
    <div className="space-y-7 animate-fade-in">
      <header className="relative flex flex-col items-start justify-between gap-5 overflow-hidden rounded-xl bg-gradient-to-r from-blue-900 to-indigo-900 p-7 shadow-lg sm:flex-row sm:items-center">
        <div className="pointer-events-none absolute right-0 top-0 p-8 opacity-10">
          <Trophy size={120} />
        </div>
        <div className="relative z-10">
          <h1 className="mb-2 flex items-center gap-3 text-3xl font-black text-white">
            <Trophy className="text-amber-400" />
            Giải đấu được quyền truy cập
          </h1>
          <p className="font-medium text-blue-200">Chọn đúng đơn vị, sau đó mở hoặc thiết lập giải theo phạm vi tài khoản.</p>
        </div>

        {canManageTournaments ? (
          <button
            type="button"
            onClick={() => openCreateDialog(null)}
            disabled={isSuperAdmin && managedTenantOptions.length === 0}
            className="relative z-10 flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-black text-blue-900 shadow-md transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={18} /> {isSuperAdmin ? 'TẠO GIẢI THEO ĐƠN VỊ' : 'TẠO GIẢI ĐẤU'}
          </button>
        ) : null}
      </header>

      <div className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-[1fr_220px_180px]">
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Tìm theo tên giải, đường dẫn hoặc đơn vị..."
            className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-10 pr-3 text-sm font-semibold dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <label className="relative block">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
          <select
            value={tenantFilter}
            onChange={(event) => setTenantFilter(event.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm font-semibold dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="all">Tất cả đơn vị</option>
            {tenantOptions.map((tenantName) => (
              <option key={tenantName} value={tenantName}>{tenantName}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="active">Đang hoạt động</option>
            <option value="all">Tất cả trạng thái</option>
          </select>
        </label>
      </div>

      {actionNotice ? (
        <div className={`rounded-lg border px-4 py-3 text-sm font-bold ${actionNotice.tone === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {actionNotice.message}
        </div>
      ) : null}

      {isSuperAdmin ? (
        <section className="space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Hỗ trợ thiết lập</p>
              <h2 className="text-xl font-black text-zinc-950 dark:text-zinc-100">Đơn vị chưa có giải hoạt động</h2>
              <p className="mt-1 text-sm text-zinc-500">Hệ thống tự phân loại để SUPER_ADMIN không dùng nhầm luồng tạo giải.</p>
            </div>
            <span className="text-sm font-bold text-zinc-500">{zeroTournamentTenants.length} đơn vị cần xem xét</span>
          </div>

          <div className="grid overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-4 sm:divide-x sm:divide-zinc-200 dark:sm:divide-zinc-800">
            <div className="px-4 py-3">
              <p className="text-xs font-bold text-zinc-500">Chưa có giải</p>
              <p className="text-2xl font-black text-zinc-950 dark:text-white">{zeroTournamentTenants.length}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs font-bold text-zinc-500">Có thể tạo ngay</p>
              <p className="text-2xl font-black text-blue-600">{actionableManagedCount}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs font-bold text-zinc-500">Cần khởi tạo lại</p>
              <p className="text-2xl font-black text-emerald-600">{repairableSelfServiceCount}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs font-bold text-zinc-500">Chờ xử lý điều kiện</p>
              <p className="text-2xl font-black text-amber-600">{waitingCount}</p>
            </div>
          </div>

          {tenantSummaryQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white py-8 text-sm font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
              <Loader2 size={18} className="animate-spin" /> Đang phân loại đơn vị...
            </div>
          ) : tenantSummaryQuery.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              Không tải được trạng thái đơn vị: {(tenantSummaryQuery.error as Error).message}
            </div>
          ) : filteredZeroTournamentTenants.length > 0 ? (
            <div className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {filteredZeroTournamentTenants.map((tenant) => {
                const state = getAssistanceState(tenant);
                const isEnsuring = ensureSelfServiceWorkspace.isPending
                  && ensureSelfServiceWorkspace.variables === tenant.tenant_id;
                return (
                  <div key={tenant.tenant_id} className="grid gap-4 p-4 md:grid-cols-[minmax(220px,1.1fr)_minmax(180px,0.8fr)_minmax(260px,1.4fr)_auto] md:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        <Building2 size={20} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-black text-zinc-950 dark:text-white">{tenant.tenant_name}</p>
                        <p className="truncate text-xs font-semibold text-zinc-500">{tenant.tenant_slug}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-zinc-500">Loại đơn vị</p>
                      <p className="text-sm font-black text-zinc-800 dark:text-zinc-200">
                        {tenant.tenant_type === 'self_service_customer' ? 'Khách hàng tự đăng ký' : 'Đơn vị doanh nghiệp'}
                      </p>
                    </div>
                    <div>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${state.badgeClass}`}>
                        {state.label}
                      </span>
                      <p className="mt-1.5 text-xs font-medium leading-5 text-zinc-500">{state.detail}</p>
                    </div>
                    <div className="flex justify-start md:justify-end">
                      {state.action === 'create' ? (
                        <button
                          type="button"
                          onClick={() => openCreateDialog(toTenantChoice(tenant))}
                          className="inline-flex min-w-40 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-700"
                        >
                          <Plus size={16} /> Tạo giải
                        </button>
                      ) : state.action === 'ensure' ? (
                        <button
                          type="button"
                          onClick={() => handleEnsureSelfServiceWorkspace(tenant)}
                          disabled={isEnsuring}
                          className="inline-flex min-w-48 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {isEnsuring ? <Loader2 size={16} className="animate-spin" /> : <Wrench size={16} />}
                          Khởi tạo giải mặc định
                        </button>
                      ) : tenant.archived_tournament_count > 0 ? (
                        <button
                          type="button"
                          onClick={() => setSelectedTab('deleted')}
                          className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                          <ArchiveRestore size={15} /> Mở mục Đã xóa
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                          <Clock3 size={15} /> Chưa thể tạo
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
              <CircleCheck size={20} /> Không có đơn vị chưa lập giải phù hợp bộ lọc hiện tại.
            </div>
          )}
        </section>
      ) : null}

      <section className="space-y-5">
        <div className="flex items-end justify-between gap-4 border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Danh sách vận hành</p>
            <h2 className="text-xl font-black text-zinc-950 dark:text-white">Giải đấu đang hoạt động</h2>
          </div>
          <span className="text-sm font-bold text-zinc-500">{filteredTournaments.length} giải</span>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-24">
            <div className="mb-4 h-12 w-12 animate-spin rounded-full border-b-4 border-blue-600" />
            <p className="animate-pulse font-medium text-zinc-500">Đang nạp dữ liệu giải đấu...</p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-600">
            Đã xảy ra lỗi khi tải danh sách giải đấu: {(error as Error).message}
          </div>
        ) : filteredTournaments.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-white py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-5 rounded-full bg-zinc-100 p-5 dark:bg-zinc-800">
              <Trophy className="h-12 w-12 text-zinc-400" />
            </div>
            <h3 className="mb-2 text-xl font-bold text-zinc-900 dark:text-zinc-100">Chưa có giải đấu phù hợp</h3>
            <p className="max-w-md text-zinc-500 dark:text-zinc-400">
              Kiểm tra bộ lọc hoặc dùng hành động đúng tại khu đơn vị chưa có giải.
            </p>
            {!isSuperAdmin && canManageTournaments ? (
              <button type="button" onClick={() => openCreateDialog(null)} className="mt-5 flex items-center gap-2 font-bold text-blue-600 hover:text-blue-700">
                Khởi tạo ngay <ArrowRight size={16} />
              </button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-8">
            {groupedTournaments.map(([tenantName, tenantTournaments]) => (
              <section key={tenantName} className="space-y-4">
                <div className="flex items-center justify-between gap-4 border-b border-zinc-200 pb-3 dark:border-zinc-800">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400">Đơn vị</p>
                    <h2 className="text-xl font-black text-zinc-900 dark:text-zinc-100">{tenantName}</h2>
                  </div>
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {tenantTournaments.length} giải đấu
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {tenantTournaments.map((tournament) => (
                    <TournamentWorkspaceCard key={tournament.tournament_id} tournament={tournament} />
                  ))}
                </div>
              </section>
            ))}

            {hasNextPage ? (
              <div className="flex justify-center pb-4 pt-8">
                <button
                  type="button"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="flex items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-6 py-2.5 text-sm font-bold text-indigo-600 shadow-sm transition-all hover:bg-zinc-50 hover:shadow-md disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  {isFetchingNextPage ? (
                    <><Loader2 size={16} className="animate-spin" /> Đang tải...</>
                  ) : 'Tải thêm giải đấu'}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {isCreateModalOpen ? (
        <CreateTournamentWorkspaceDialog
          onClose={closeCreateDialog}
          targetTenant={createTargetTenant}
          tenantOptions={managedTenantOptions}
        />
      ) : null}
    </div>
  );
}
