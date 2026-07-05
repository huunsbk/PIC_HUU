import React, { useState } from 'react';
import { Copy, ExternalLink, Archive, Pencil, RotateCcw } from 'lucide-react';
import { TournamentWorkspaceStat } from '../hooks/useTournamentWorkspaces';
import { useArchiveTournamentWorkspace, useRestoreTournamentWorkspace, useUpdateTournamentWorkspace } from '../hooks/useTournamentMutations';
import TournamentWorkspaceDetailsDrawer from './TournamentWorkspaceDetailsDrawer';
import ConfirmDialog from './ConfirmDialog';
import { useTournamentStore } from '../store';

interface TournamentWorkspaceCardProps {
  tournament: TournamentWorkspaceStat;
}

export default function TournamentWorkspaceCard({ tournament }: TournamentWorkspaceCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [isArchiveConfirmOpen, setIsArchiveConfirmOpen] = useState(false);
  const archiveMutation = useArchiveTournamentWorkspace();
  const restoreMutation = useRestoreTournamentWorkspace();
  const updateMutation = useUpdateTournamentWorkspace();
  const hasPermission = useTournamentStore((state) => state.hasPermission);
  const canManageTournaments = hasPermission('*') || hasPermission('manage_tournaments');

  const handleArchive = () => {
    setIsArchiveConfirmOpen(true);
  };

  const handleEdit = () => {
    const name = window.prompt('Tên giải đấu', tournament.name);
    if (!name || name.trim() === tournament.name) return;
    updateMutation.mutate({
      tournamentId: tournament.tournament_id,
      name: name.trim(),
      slug: tournament.slug,
      location: tournament.location || null,
      startDate: tournament.start_date || null,
      status: tournament.status || null,
    }, {
      onSuccess: () => alert('Đã cập nhật giải đấu.'),
      onError: (err: any) => alert(`Lỗi: ${err.message}`),
    });
  };

  const handleConfirmArchive = () => {
    archiveMutation.mutate(tournament.tournament_id, {
      onSuccess: () => {
        setIsArchiveConfirmOpen(false);
        alert('Đã lưu trữ giải đấu.');
      },
      onError: (err: any) => {
        setIsArchiveConfirmOpen(false);
        alert(`Lỗi: ${err.message}`);
      }
    });
  };

  const getAppUrl = (path: string) => {
    const basePath = import.meta.env.BASE_URL || '/';
    const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
    return `${window.location.origin}${normalizedBase}${path.replace(/^\//, '')}`;
  };

  const copyPublicLink = () => {
    const url = getAppUrl(`/tournament/${tournament.slug}`);
    navigator.clipboard.writeText(url);
    alert('Đã sao chép liên kết');
  };

  const openAdminWorkspace = () => {
    window.open(getAppUrl(`/admin/workspace/${tournament.slug}`), '_blank');
  };

  const publicUrl = getAppUrl(`/tournament/${tournament.slug}`);
  const tenantDisplayName = tournament.tenant_name || tournament.tenant_id || 'Chưa rõ';

  return (
    <>
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full relative">
        <div className="flex justify-between items-start mb-3">
          <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-100 line-clamp-2 pr-12">{tournament.name}</h3>
          <span className={`absolute top-5 right-5 text-[10px] font-bold px-2 py-0.5 rounded-full ${tournament.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>
            {tournament.status.toUpperCase()}
          </span>
        </div>

        <div className="flex-1 space-y-2 mb-5">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
             <span className="font-semibold">Đơn vị:</span> {tenantDisplayName}
          </div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
             <span className="font-semibold">Ngày tạo:</span> {new Date(tournament.created_at).toLocaleDateString('vi-VN')}
          </div>
          
          <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
             <div className="text-center">
                <p className="text-lg font-black text-indigo-600">{tournament.events_count}</p>
                <p className="text-[10px] uppercase font-bold text-zinc-500">Nội dung</p>
             </div>
             <div className="text-center">
                <p className="text-lg font-black text-emerald-600">{tournament.teams_count}</p>
                <p className="text-[10px] uppercase font-bold text-zinc-500">Đội</p>
             </div>
             <div className="text-center">
                <p className="text-lg font-black text-orange-600">{tournament.matches_count}</p>
                <p className="text-[10px] uppercase font-bold text-zinc-500">Trận</p>
             </div>
          </div>
          
          <div className="mt-3 bg-zinc-50 dark:bg-zinc-800/50 p-2 rounded-lg text-xs font-mono text-zinc-500 break-all flex items-center justify-between group">
             <span className="truncate flex-1">{publicUrl}</span>
             <button onClick={copyPublicLink} className="ml-2 text-zinc-400 hover:text-blue-600 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Copy size={14} />
             </button>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button onClick={openAdminWorkspace} className="flex-1 py-2 flex items-center justify-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
            <ExternalLink size={14} /> Mở giải
          </button>
          {canManageTournaments && (
            <div className="flex gap-2">
              <button onClick={handleEdit} disabled={updateMutation.isPending} className="py-2 px-2 flex items-center justify-center text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50" title="Sửa giải">
                <Pencil size={14} />
              </button>
              {tournament.status === 'archived' ? (
                <button onClick={() => restoreMutation.mutate(tournament.tournament_id)} disabled={restoreMutation.isPending} className="py-2 px-2 flex items-center justify-center text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors disabled:opacity-50" title="Khôi phục">
                  <RotateCcw size={14} />
                </button>
              ) : (
                <button onClick={handleArchive} disabled={archiveMutation.isPending} className="py-2 px-2 flex items-center justify-center text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50" title="Lưu trữ">
                  <Archive size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showDetails && (
        <TournamentWorkspaceDetailsDrawer tournament={tournament} onClose={() => setShowDetails(false)} />
      )}

      <ConfirmDialog
        isOpen={isArchiveConfirmOpen}
        title="Lưu trữ giải đấu"
        message={`Bạn có chắc chắn muốn lưu trữ giải đấu "${tournament.name}"? Tất cả dữ liệu liên quan sẽ bị ẩn.`}
        confirmText="Lưu trữ"
        cancelText="Hủy bỏ"
        isDanger={true}
        onConfirm={handleConfirmArchive}
        onCancel={() => setIsArchiveConfirmOpen(false)}
      />
    </>
  );
}
