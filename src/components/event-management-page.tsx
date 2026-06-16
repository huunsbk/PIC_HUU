import React, { useState } from 'react';
import { Plus, Archive, ShieldAlert } from 'lucide-react';
import { useEventsQuery } from './use-events-query';
import EventCard from './event-card';
import CreateEventModal from './create-event-modal';
import { useTournamentStore } from '../store';

export default function EventManagementPage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  const { data: events, isLoading, error } = useEventsQuery();
  const currentEnterpriseUser = useTournamentStore(state => state.currentEnterpriseUser);
  const activeTenantId = useTournamentStore(state => state.activeTenantId);

  if (activeTenantId === 'default' && (!currentEnterpriseUser || currentEnterpriseUser.role_name !== 'SUPER_ADMIN')) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-zinc-900 rounded-xl border border-red-100 dark:border-red-900/30">
        <ShieldAlert className="w-12 h-12 text-red-500 mb-4" />
        <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Truy Cập Bị Từ Chối</h3>
        <p className="text-zinc-500 dark:text-zinc-400">Bạn đang ở Tenant mặc định (Local Prototype). Vui lòng đăng nhập bằng tài khoản SUPER ADMIN hoặc một Tenant cụ thể để thực hiện quản lý giải.</p>
      </div>
    );
  }

  const filteredEvents = (events || []).filter(e => {
    if (statusFilter === 'all') return true;
    return e.status === statusFilter;
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-zinc-900 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Event Management Center</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Quản lý toàn bộ giải đấu trong hệ thống (Enterprise)</p>
        </div>
        
        <div className="flex items-center gap-3">
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
          
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold text-sm transition-colors shadow-sm"
          >
            <Plus size={16} /> Tạo giải đấu
          </button>
        </div>
      </header>

      {isLoading ? (
        <div className="flex justify-center p-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : error ? (
        <div className="p-4 bg-red-50 text-red-600 rounded-lg border border-red-200">
           Đã xảy ra lỗi khi tải danh sách giải đấu.
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl border-dashed">
          <Archive className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-500 font-medium">Chưa có giải đấu nào.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredEvents.map(evt => (
            <EventCard key={evt.id} event={evt} />
          ))}
        </div>
      )}

      {isCreateModalOpen && (
        <CreateEventModal onClose={() => setIsCreateModalOpen(false)} />
      )}
    </div>
  );
}
