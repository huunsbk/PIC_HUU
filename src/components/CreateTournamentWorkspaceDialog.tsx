import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import { useCreateTournamentWorkspace } from '../hooks/useTournamentMutations';
import { useTournamentStore } from '../store';

interface CreateTournamentWorkspaceDialogProps {
  onClose: () => void;
}

export default function CreateTournamentWorkspaceDialog({ onClose }: CreateTournamentWorkspaceDialogProps) {
  const [tournamentName, setTournamentName] = useState('');
  const [slug, setSlug] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');

  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const activeTenantName = useTournamentStore((state) => state.activeTenantName);
  const createMutation = useCreateTournamentWorkspace();

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTenantId || activeTenantId === 'default') {
      alert('Vui lòng chọn đơn vị thật trước khi tạo giải đấu.');
      return;
    }

    createMutation.mutate(
      {
        tournamentName,
        slug,
        tenantId: activeTenantId,
        location: location || null,
        startDate: startDate || null,
      },
      {
        onSuccess: () => {
          alert('Tạo giải đấu thành công.');
          onClose();
        },
        onError: (err: any) => {
          alert(`Lỗi khi tạo giải đấu: ${err.message}`);
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Tạo giải đấu mới</h2>
          <button onClick={onClose} className="p-2 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
            Đơn vị hiện tại: {activeTenantName || activeTenantId || 'Chưa chọn'}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Tên giải đấu</label>
              <input
                required
                type="text"
                value={tournamentName}
                onChange={(e) => {
                  setTournamentName(e.target.value);
                  if (!slug || slug === generateSlug(tournamentName)) {
                    setSlug(generateSlug(e.target.value));
                  }
                }}
                className="w-full px-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Đường dẫn</label>
              <input
                required
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 transition-all font-mono text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Địa điểm</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full px-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Ngày khai mạc</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-sm"
              />
            </div>
          </div>

          <div className="pt-4 flex gap-3 border-t border-zinc-200 dark:border-zinc-800">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-3 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl font-bold transition-colors">
              Hủy
            </button>
            <button type="submit" disabled={createMutation.isPending} className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
              {createMutation.isPending ? 'Đang xử lý...' : <><Save size={18} /> Tạo giải</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
