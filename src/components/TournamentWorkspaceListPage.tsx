import React, { useState } from 'react';
import { Plus, Trophy, ShieldAlert, ArrowRight, Loader2, Search, Filter } from 'lucide-react';
import { useTournamentWorkspaces } from '../hooks/useTournamentWorkspaces';
import { useTournamentStore } from '../store';
import TournamentWorkspaceCard from './TournamentWorkspaceCard';
import CreateTournamentWorkspaceDialog from './CreateTournamentWorkspaceDialog';

export default function TournamentWorkspaceListPage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [tenantFilter, setTenantFilter] = useState('all');
  
  const limit = 50;
  const { data: workspacesResponse, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useTournamentWorkspaces(limit);
  const currentEnterpriseUser = useTournamentStore(state => state.currentEnterpriseUser);
  const hasPermission = useTournamentStore(state => state.hasPermission);
  const canManageTournaments = hasPermission('*') || hasPermission('manage_tournaments');

  if (!currentEnterpriseUser) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-red-100 dark:border-red-900/30 min-h-[400px]">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-6 animate-pulse" />
        <h3 className="text-2xl font-black text-zinc-900 dark:text-zinc-100 mb-2">Cần đăng nhập</h3>
        <p className="text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">Đăng nhập để xem danh sách giải đấu được phân quyền.</p>
      </div>
    );
  }

  const tournaments = workspacesResponse?.pages.flatMap(page => page.data) || [];
  const tenantOptions = React.useMemo(() => {
    return Array.from(
      new Set(tournaments.map((tour) => tour.tenant_name || tour.tenant_id || 'Chưa rõ đơn vị'))
    ).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [tournaments]);
  const filteredTournaments = React.useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return tournaments.filter((tour) => {
      const tenantName = tour.tenant_name || tour.tenant_id || 'Chưa rõ đơn vị';
      const matchesTenant = tenantFilter === 'all' || tenantName === tenantFilter;
      const status = tour.status || 'active';
      if (status === 'archived') return false;
      const matchesStatus = statusFilter === 'all' || status === statusFilter;
      const matchesSearch =
        !normalizedQuery ||
        tour.name?.toLowerCase().includes(normalizedQuery) ||
        tour.slug?.toLowerCase().includes(normalizedQuery) ||
        tenantName.toLowerCase().includes(normalizedQuery);
      return matchesTenant && matchesStatus && matchesSearch;
    });
  }, [tournaments, searchQuery, statusFilter, tenantFilter]);
  const groupedTournaments = React.useMemo(() => {
    const groups = new Map<string, typeof filteredTournaments>();

    filteredTournaments.forEach((tour) => {
      const tenantName = tour.tenant_name || tour.tenant_id || 'Chưa rõ đơn vị';
      const current = groups.get(tenantName) || [];
      current.push(tour);
      groups.set(tenantName, current);
    });

    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, 'vi'));
  }, [filteredTournaments]);

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 bg-gradient-to-r from-blue-900 to-indigo-900 p-8 rounded-2xl shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
           <Trophy size={120} />
        </div>
        <div className="relative z-10">
          <h1 className="text-3xl font-black text-white mb-2 flex items-center gap-3">
             <Trophy className="text-amber-400" />
             Giải đấu được quyền truy cập
          </h1>
          <p className="text-blue-200 font-medium">Chọn giải đấu cần điều hành, nhập điểm hoặc quản trị theo phạm vi quyền tài khoản</p>
        </div>
        
        {canManageTournaments && (
        <div className="flex items-center gap-4 relative z-10">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 bg-white text-blue-900 hover:bg-blue-50 px-6 py-3 rounded-xl font-black text-sm transition-all shadow-md hover:shadow-xl transform hover:-translate-y-0.5"
          >
            <Plus size={18} /> TẠO GIẢI ĐẤU
          </button>
        </div>
        )}
      </header>

      <div className="grid gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-[1fr_220px_180px]">
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

      {isLoading ? (
        <div className="flex flex-col items-center justify-center p-24">
          <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600 mb-4"></div>
          <p className="text-zinc-500 font-medium animate-pulse">Đang nạp dữ liệu giải đấu...</p>
        </div>
      ) : error ? (
        <div className="p-6 bg-red-50 text-red-600 rounded-xl border border-red-200">
           Đã xảy ra lỗi khi tải danh sách giải đấu: {(error as any).message}
        </div>
      ) : (!filteredTournaments || filteredTournaments.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl border-dashed">
          <div className="bg-zinc-100 dark:bg-zinc-800 p-6 rounded-full mb-6">
             <Trophy className="w-16 h-16 text-zinc-400 dark:text-zinc-500" />
          </div>
          <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Chưa có giải đấu được phân quyền</h3>
          <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-center max-w-sm">
            Tài khoản này chưa có giải đấu hoặc nội dung thi đấu nào trong phạm vi được cấp quyền.
          </p>
          {canManageTournaments && (
            <button
               onClick={() => setIsCreateModalOpen(true)}
               className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-bold"
            >
               Khởi tạo ngay <ArrowRight size={16} />
            </button>
          )}
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

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {tenantTournaments.map(tour => (
                  <TournamentWorkspaceCard
                    key={tour.tournament_id}
                    tournament={tour}
                  />
                ))}
              </div>
            </section>
          ))}

          {hasNextPage && (
            <div className="flex justify-center pt-8 pb-4">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="flex items-center justify-center gap-2 px-6 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-full text-sm font-bold shadow-sm hover:shadow-md hover:bg-zinc-50 text-indigo-600 disabled:opacity-50 transition-all font-display"
              >
                {isFetchingNextPage ? (
                  <><Loader2 size={16} className="animate-spin" /> Đang tải...</>
                ) : (
                  'Tải thêm giải đấu'
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {isCreateModalOpen && (
        <CreateTournamentWorkspaceDialog onClose={() => setIsCreateModalOpen(false)} />
      )}
    </div>
  );
}
