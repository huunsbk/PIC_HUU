import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import { useCreateTournamentWorkspace } from '../hooks/useTournamentMutations';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';

interface CreateTournamentWorkspaceDialogProps {
  onClose: () => void;
}

export default function CreateTournamentWorkspaceDialog({ onClose }: CreateTournamentWorkspaceDialogProps) {
  const [tournamentName, setTournamentName] = useState('');
  const [slug, setSlug] = useState('');
  const [plan, setPlan] = useState('Starter');
  const [accountId, setAccountId] = useState('');

  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const createMutation = useCreateTournamentWorkspace();

  // Fetch Event Admins for selection (assuming they already have EVENT_ADMIN role)
  // Real world: Might need edge function or Supabase Admin UI to create users. 
  // Here we just pick from existing accounts.
  const { data: accounts, isLoading: loadingAccounts } = useQuery({
     queryKey: ['available_accounts', activeTenantId],
     queryFn: async () => {
        const { data, error } = await supabase
           .from('accounts')
           .select('id, username, display_name, roles(name)')
           .eq('tenant_id', activeTenantId);
        if (error) throw error;
        // Filter those who can be admins. Let's just show all active accounts for now or EVENT_ADMINs.
        return data || [];
     },
     enabled: !!activeTenantId
  });

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
    if (!accountId) {
       alert('Vui lòng chọn một Owner/Admin cho Workspace.');
       return;
    }
    createMutation.mutate(
      { tournamentName, slug, plan, ownerAccountId: accountId },
      {
         onSuccess: () => {
            alert('Tạo workspace thành công!');
            onClose();
         },
         onError: (err: any) => {
            alert(`Lỗi khi tạo workspace: ${err.message}`);
         }
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Khởi tạo Workspace Mới</h2>
          <button onClick={onClose} className="p-2 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-4">
             <h3 className="text-sm font-bold text-blue-600 uppercase tracking-wider">Thông tin chung</h3>
             
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Tên Tournament Workspace</label>
                  <input 
                    required 
                    type="text" 
                    value={tournamentName} 
                    onChange={e => {
                       setTournamentName(e.target.value);
                       if (!slug || slug === generateSlug(tournamentName)) {
                          setSlug(generateSlug(e.target.value));
                       }
                    }} 
                     className="w-full px-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-sm" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Đường dẫn (Slug)</label>
                  <input 
                    required 
                    type="text" 
                    value={slug} 
                    onChange={e => setSlug(e.target.value)} 
                    className="w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 transition-all font-mono text-sm" 
                  />
                </div>
             </div>

             <div>
                <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Gói dịch vụ</label>
                <select 
                   value={plan}
                   onChange={e => setPlan(e.target.value)}
                   className="w-full px-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-sm"
                >
                   <option value="Starter">Starter (Lên tới 20 đội)</option>
                   <option value="Pro">Pro (Lên tới 100 đội)</option>
                   <option value="Business">Business (Không giới hạn)</option>
                   <option value="Enterprise">Enterprise (Full features)</option>
                </select>
             </div>
          </div>

          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6 space-y-4">
             <h3 className="text-sm font-bold text-emerald-600 uppercase tracking-wider">Chỉ định Owner</h3>
             <p className="text-xs text-zinc-500 mb-3">Chọn tài khoản sẽ sở hữu và quản lý Workspace này.</p>
             <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Tài khoản</label>
                  {loadingAccounts ? (
                     <p className="text-sm text-zinc-500">Đang tải...</p>
                  ) : (
                     <select 
                       required
                       value={accountId}
                       onChange={(e) => setAccountId(e.target.value)}
                       className="w-full px-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-sm"
                     >
                       <option value="" disabled>-- Chọn tài khoản --</option>
                       {accounts?.map(acc => (
                         <option key={acc.id} value={acc.id}>{acc.display_name} (@{acc.username}) - Role: {acc.roles?.name}</option>
                       ))}
                     </select>
                  )}
                </div>
             </div>
          </div>

          <div className="pt-4 flex gap-3 border-t border-zinc-200 dark:border-zinc-800">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-3 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl font-bold transition-colors">Hủy</button>
            <button type="submit" disabled={createMutation.isPending} className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
              {createMutation.isPending ? 'Đang xử lý...' : <><Save size={18} /> Tạo Workspace</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
