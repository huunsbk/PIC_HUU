import React, { useState } from 'react';
import { Copy, ExternalLink, Info, Trash2, ShieldAlert } from 'lucide-react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import TournamentDetailsDrawer from './TournamentDetailsDrawer';
import ConfirmDialog from './ConfirmDialog';

interface TournamentCardProps {
  tournament: any;
}

export default function TournamentCard({ tournament }: TournamentCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const queryClient = useQueryClient();

  const getOwner = () => {
    try {
      const events = tournament.events || [];
      for (const ev of events) {
         const perms = ev.account_event_permissions || [];
         for (const perm of perms) {
            console.log(perm);
            if (perm.accounts?.roles?.name === 'EVENT_ADMIN') {
               return perm.accounts;
            }
         }
      }
    } catch(e) {}
    return null;
  };

  const owner = getOwner();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('tournament')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', tournament.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournaments'] });
    }
  });

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

  const openTournament = () => {
    window.open(getAppUrl(`/tournament/${tournament.slug}`), '_blank');
  };

  return (
    <>
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
        <div className="flex justify-between items-start mb-4">
          <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-100 line-clamp-2">{tournament.name}</h3>
        </div>

        <div className="flex-1 space-y-3 mb-6">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
             <span className="font-semibold">Owner:</span> {owner ? owner.display_name : 'N/A'}
          </div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
             <span className="font-semibold">Slug:</span> {tournament.slug}
          </div>
          <div className="flex items-center text-sm text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 p-2 rounded-md font-mono text-[11px] mt-2">
            <span className="truncate">/tournament/{tournament.slug}</span>
          </div>
        </div>

        <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 grid grid-cols-4 gap-1">
          <button onClick={copyPublicLink} className="p-2 flex flex-col justify-center items-center gap-1 text-zinc-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Copy Link">
            <Copy size={16} />
            <span className="text-[10px]">Copy Link</span>
          </button>
          <button onClick={openTournament} className="p-2 flex flex-col justify-center items-center gap-1 text-zinc-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Mở Giải">
            <ExternalLink size={16} />
            <span className="text-[10px]">Mở Giải</span>
          </button>
          <button onClick={() => setShowDetails(true)} className="p-2 flex flex-col justify-center items-center gap-1 text-zinc-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Chi Tiết">
            <Info size={16} />
            <span className="text-[10px]">Chi Tiết</span>
          </button>
          <button onClick={() => setIsConfirmOpen(true)} disabled={deleteMutation.isPending} className="p-2 flex flex-col justify-center items-center gap-1 text-zinc-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50" title="Xóa">
            <Trash2 size={16} />
            <span className="text-[10px]">Xóa</span>
          </button>
        </div>
      </div>

      {showDetails && (
        <TournamentDetailsDrawer tournament={tournament} owner={owner} onClose={() => setShowDetails(false)} />
      )}

      <ConfirmDialog
        isOpen={isConfirmOpen}
        title="Xóa giải đấu"
        message={`Bạn có chắc chắn muốn xóa giải đấu "${tournament.name}"? Tất cả thông tin giải đấu sẽ bị đưa vào trạng thái ẩn (Soft Delete).`}
        confirmText="Xóa vĩnh viễn"
        cancelText="Hủy bỏ"
        isDanger={true}
        onConfirm={() => {
          deleteMutation.mutate(undefined, {
            onSuccess: () => {
              setIsConfirmOpen(false);
            },
            onError: () => {
              setIsConfirmOpen(false);
            }
          });
        }}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </>
  );
}
