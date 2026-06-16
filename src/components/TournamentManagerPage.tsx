import React, { useState } from 'react';
import { Plus, Trophy, ShieldAlert, ArrowRight } from 'lucide-react';
import { useTournaments } from '../hooks/useTournaments';
import { useTournamentStore } from '../store';
import TournamentCard from './TournamentCard';
import CreateTournamentDialog from './CreateTournamentDialog';

export default function TournamentManagerPage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  
  const { data: tournaments, isLoading, error } = useTournaments();
  const currentEnterpriseUser = useTournamentStore(state => state.currentEnterpriseUser);

  if (!currentEnterpriseUser || (currentEnterpriseUser.role !== 'SUPER_ADMIN' && currentEnterpriseUser.role !== 'TENANT_ADMIN')) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-red-100 dark:border-red-900/30 min-h-[400px]">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-6 animate-pulse" />
        <h3 className="text-2xl font-black text-zinc-900 dark:text-zinc-100 mb-2">Truy Cập Bị Từ Chối</h3>
        <p className="text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">Bạn phải đăng nhập bằng tài khoản SUPER_ADMIN hoặc TENANT_ADMIN để quản lý nền tảng giải đấu tổ hợp.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 bg-gradient-to-r from-blue-900 to-indigo-900 p-8 rounded-2xl shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
           <Trophy size={120} />
        </div>
        <div className="relative z-10">
          <h1 className="text-3xl font-black text-white mb-2 flex items-center gap-3">
             <Trophy className="text-amber-400" />
             Tournament Manager
          </h1>
          <p className="text-blue-200 font-medium">Quản lý toàn bộ hệ sinh thái giải đấu hệ thống (Enterprise V5)</p>
        </div>
        
        <div className="flex items-center gap-4 relative z-10">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 bg-white text-blue-900 hover:bg-blue-50 px-6 py-3 rounded-xl font-black text-sm transition-all shadow-md hover:shadow-xl transform hover:-translate-y-0.5"
          >
            <Plus size={18} /> TẠO GIẢI ĐẤU (TOURNAMENT)
          </button>
        </div>
      </header>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center p-24">
          <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600 mb-4"></div>
          <p className="text-zinc-500 font-medium animate-pulse">Đang nạp dữ liệu nền tảng...</p>
        </div>
      ) : error ? (
        <div className="p-6 bg-red-50 text-red-600 rounded-xl border border-red-200">
           Đã xảy ra lỗi khi tải danh sách giải đấu: {(error as any).message}
        </div>
      ) : (!tournaments || tournaments.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl border-dashed">
          <div className="bg-zinc-100 dark:bg-zinc-800 p-6 rounded-full mb-6">
             <Trophy className="w-16 h-16 text-zinc-400 dark:text-zinc-500" />
          </div>
          <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Chưa có giải đấu nào</h3>
          <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-center max-w-sm">Hệ thống chưa có tournament nào được khởi tạo. Bấm tạo mới để cấp phát giải đấu và account Event Admin.</p>
          <button
             onClick={() => setIsCreateModalOpen(true)}
             className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-bold"
          >
             Khởi tạo ngay <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {tournaments.map(tour => (
            <TournamentCard key={tour.id} tournament={tour} />
          ))}
        </div>
      )}

      {isCreateModalOpen && (
        <CreateTournamentDialog onClose={() => setIsCreateModalOpen(false)} />
      )}
    </div>
  );
}
