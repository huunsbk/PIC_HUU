import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import { useCreateTournament } from '../hooks/useCreateTournament';

interface CreateTournamentDialogProps {
  onClose: () => void;
}

export default function CreateTournamentDialog({ onClose }: CreateTournamentDialogProps) {
  const [tournamentName, setTournamentName] = useState('');
  const [slug, setSlug] = useState('');
  
  const [adminName, setAdminName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [plan, setPlan] = useState('Starter');

  const createMutation = useCreateTournament();

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
    createMutation.mutate(
      { tournamentName, slug, adminName, username, password, plan },
      {
         onSuccess: () => {
            alert('Tạo giải đấu thành công!');
            onClose();
         },
         onError: (err: any) => {
            alert(`Lỗi khi tạo giải: ${err.message}`);
         }
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Khởi tạo Giải đấu Mới</h2>
          <button onClick={onClose} className="p-2 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-4">
             <h3 className="text-sm font-bold text-blue-600 uppercase tracking-wider">Thông tin chung</h3>
             
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Tên giải đấu</label>
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
             <h3 className="text-sm font-bold text-emerald-600 uppercase tracking-wider">Tài khoản Quản trị viên (EVENT_ADMIN)</h3>
             
             <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Tên hiển thị</label>
                  <input 
                    required 
                    type="text" 
                    value={adminName} 
                    onChange={e => setAdminName(e.target.value)} 
                    placeholder="VD: Ban tổ chức Đồng Nai"
                    className="w-full px-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-sm" 
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div>
                     <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Tên đăng nhập (Username)</label>
                     <input 
                       required 
                       type="text" 
                       value={username} 
                       onChange={e => setUsername(e.target.value)} 
                       className="w-full px-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all font-mono text-sm" 
                     />
                     <p className="text-xs text-zinc-500 mt-1">Đăng nhập bằng username này.</p>
                   </div>
                   <div>
                     <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Mật khẩu tạm</label>
                     <input 
                       required 
                       type="password" 
                       value={password} 
                       onChange={e => setPassword(e.target.value)} 
                       className="w-full px-4 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all font-mono text-sm" 
                     />
                   </div>
                </div>
             </div>
          </div>

          <div className="pt-4 flex gap-3 border-t border-zinc-200 dark:border-zinc-800">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-3 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl font-bold transition-colors">Hủy</button>
            <button type="submit" disabled={createMutation.isPending} className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
              {createMutation.isPending ? 'Đang tạo...' : <><Save size={18} /> Tạo Giải Đấu & Admin</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
