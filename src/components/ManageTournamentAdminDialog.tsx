import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import { useTransferTournamentAdmin } from '../hooks/useTournamentMutations';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';
import { TournamentWorkspaceStat } from '../hooks/useTournamentWorkspaces';

interface ManageTournamentAdminDialogProps {
  tournament: TournamentWorkspaceStat;
  onClose: () => void;
}

export default function ManageTournamentAdminDialog({ tournament, onClose }: ManageTournamentAdminDialogProps) {
  const [newAccountId, setNewAccountId] = useState('');
  
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const transferMutation = useTransferTournamentAdmin();

  const { data: accounts, isLoading: loadingAccounts } = useQuery({
     queryKey: ['available_accounts', activeTenantId],
     queryFn: async () => {
        const { data, error } = await supabase
           .from('accounts')
           .select('id, username, display_name, roles(name)')
           .eq('tenant_id', activeTenantId);
        if (error) throw error;
        return data || [];
     },
     enabled: !!activeTenantId
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccountId) {
       alert('Vui lòng chọn tài khoản mới.');
       return;
    }
    
    if (window.confirm(`Chuyển quyền sở hữu Workspace "${tournament.name}" sang tài khoản này?`)) {
       transferMutation.mutate({ tournamentId: tournament.tournament_id, newAccountId }, {
          onSuccess: () => {
             alert('Chuyển quyền sở hữu thành công!');
             onClose();
          },
          onError: (err: any) => {
             alert(`Lỗi: ${err.message}`);
          }
       });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Quản lý Owner</h2>
          <button onClick={onClose} className="p-2 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
             <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">Workspace</p>
             <p className="text-lg font-bold text-blue-600">{tournament.name}</p>
             <p className="text-xs text-zinc-500 mt-1">Owner hiện tại: {tournament.owner_name || 'Không có'}</p>
          </div>

          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6">
             <h3 className="text-sm font-bold text-amber-600 uppercase tracking-wider mb-4">Chuyển quyền sở hữu mới</h3>
             <div>
                {loadingAccounts ? (
                   <p className="text-sm text-zinc-500">Đang tải...</p>
                ) : (
                   <select 
                     required
                     value={newAccountId}
                     onChange={(e) => setNewAccountId(e.target.value)}
                     className="w-full px-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all text-sm"
                   >
                     <option value="" disabled>-- Chọn tài khoản mới --</option>
                     {accounts?.map(acc => (
                       <option key={acc.id} value={acc.id}>{acc.display_name} (@{acc.username})</option>
                     ))}
                   </select>
                )}
             </div>
          </div>

          <div className="pt-4 flex gap-3 border-t border-zinc-200 dark:border-zinc-800">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-3 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl font-bold transition-colors">Hủy</button>
            <button type="submit" disabled={transferMutation.isPending} className="flex-1 px-4 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
              {transferMutation.isPending ? 'Đang xử lý...' : <><Save size={18} /> Chuyển quyền</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
