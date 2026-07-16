import React, { useState } from 'react';
import { Building2, LockKeyhole, Save, X } from 'lucide-react';
import { useCreateTournamentWorkspace } from '../hooks/useTournamentMutations';
import { useTournamentStore } from '../store';

interface CreateTournamentWorkspaceDialogProps {
  onClose: () => void;
  targetTenant?: TournamentTenantChoice | null;
  tenantOptions?: TournamentTenantChoice[];
}

export interface TournamentTenantChoice {
  tenantId: string;
  tenantName: string;
  tenantSlug?: string;
}

export default function CreateTournamentWorkspaceDialog({
  onClose,
  targetTenant = null,
  tenantOptions = [],
}: CreateTournamentWorkspaceDialogProps) {
  const [tournamentName, setTournamentName] = useState('');
  const [slug, setSlug] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [selectedTenantId, setSelectedTenantId] = useState(targetTenant?.tenantId || '');

  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const activeTenantName = useTournamentStore((state) => state.activeTenantName);
  const currentEnterpriseUser = useTournamentStore((state) => state.currentEnterpriseUser);
  const createMutation = useCreateTournamentWorkspace();
  const isSuperAdmin = currentEnterpriseUser?.role === 'SUPER_ADMIN';
  const selectedTenant = targetTenant
    || tenantOptions.find((tenant) => tenant.tenantId === selectedTenantId)
    || (!isSuperAdmin && activeTenantId && activeTenantId !== 'default'
      ? { tenantId: activeTenantId, tenantName: activeTenantName || 'Đơn vị hiện tại' }
      : null);

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
    if (!selectedTenant?.tenantId || selectedTenant.tenantId === 'default') {
      alert('Vui lòng chọn đúng đơn vị trước khi tạo giải đấu.');
      return;
    }

    createMutation.mutate(
      {
        tournamentName,
        slug,
        tenantId: selectedTenant.tenantId,
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
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Thiết lập giải đấu</p>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Tạo giải đấu mới</h2>
          </div>
          <button type="button" onClick={onClose} title="Đóng" aria-label="Đóng" className="p-2 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {targetTenant || !isSuperAdmin ? (
            <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-blue-950">
              <Building2 className="mt-0.5 shrink-0 text-blue-600" size={20} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-black uppercase text-blue-700">Đơn vị được chọn</p>
                  <LockKeyhole size={13} className="text-blue-500" />
                </div>
                <p className="truncate text-base font-black">{selectedTenant?.tenantName || 'Chưa chọn đơn vị'}</p>
                {selectedTenant?.tenantSlug ? (
                  <p className="text-xs font-semibold text-blue-700">{selectedTenant.tenantSlug}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Đơn vị quản lý
              </label>
              <select
                required
                value={selectedTenantId}
                onChange={(event) => setSelectedTenantId(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-bold focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="">Chọn đơn vị cần tạo giải</option>
                {tenantOptions.map((tenant) => (
                  <option key={tenant.tenantId} value={tenant.tenantId}>
                    {tenant.tenantName}{tenant.tenantSlug ? ` (${tenant.tenantSlug})` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-zinc-500">
                Chỉ hiển thị đơn vị doanh nghiệp đang hoạt động. Khách hàng tự đăng ký được hệ thống khởi tạo giải riêng.
              </p>
            </div>
          )}

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
            <button type="submit" disabled={createMutation.isPending || !selectedTenant} className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
              {createMutation.isPending ? 'Đang xử lý...' : <><Save size={18} /> Tạo giải</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
