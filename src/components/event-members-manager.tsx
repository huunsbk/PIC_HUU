import React, { useState } from 'react';
import { useEventMembersQuery } from './use-events-query';
import { X, UserPlus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';

export default function EventMembersManager({ eventId, onClose }: { eventId: string, onClose: () => void }) {
  const { data: members, isLoading } = useEventMembersQuery(eventId);
  const queryClient = useQueryClient();
  const [newUsername, setNewUsername] = useState('');
  
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) return;

    try {
      // 1. Find account by username in current tenant
      const activeTenantId = useTournamentStore.getState().activeTenantId;
      const { data: accountData, error: accountErr } = await supabase
        .from('accounts')
        .select('id')
        .eq('username', newUsername.trim())
        .eq('tenant_id', activeTenantId)
        .single();
        
      if (accountErr || !accountData) {
        alert('Không tìm thấy user này trong Tenant hiện tại.');
        return;
      }
      
      // 2. Insert account_event_permissions
      const { error: insertErr } = await supabase.from('account_event_permissions').insert({
        account_id: accountData.id,
        event_id: eventId
      });
      
      if (insertErr) {
        if (insertErr.code === '23505') alert('Người này đã được gán vào giải.');
        else throw insertErr;
      } else {
        setNewUsername('');
        queryClient.invalidateQueries({ queryKey: ['event_members', eventId] });
      }
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    }
  };

  const handleRemoveMember = async (accountId: string) => {
    if (!window.confirm('Gỡ người này khỏi giải đấu?')) return;
    try {
      await supabase.from('account_event_permissions')
        .delete()
        .eq('account_id', accountId)
        .eq('event_id', eventId);
      queryClient.invalidateQueries({ queryKey: ['event_members', eventId] });
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    }
  };

  const roleGroups: Record<string, any[]> = {
    EVENT_ADMIN: [],
    REFEREE: [],
    SCORER: [], // Hoặc role khác
    OTHER: []
  };

  if (members) {
    members.forEach((m: any) => {
      const roleName = m.accounts?.roles?.name || 'OTHER';
      if (roleGroups[roleName]) {
        roleGroups[roleName].push(m);
      } else {
        roleGroups['OTHER'].push(m);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Cán Bộ Sự Kiện (Members)</h2>
          <button onClick={onClose} className="p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          <form onSubmit={handleAddMember} className="flex gap-2 mb-6">
            <input 
              type="text" 
              placeholder="Nhập Username cần gán..." 
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            <button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2">
              <UserPlus size={16} /> Gán
            </button>
          </form>

          {isLoading ? (
            <div className="text-center py-8 text-zinc-500">Đang tải danh sách...</div>
          ) : (
            <div className="space-y-6">
              {Object.entries(roleGroups).map(([role, list]) => {
                if (list.length === 0) return null;
                return (
                  <div key={role}>
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">{role}</h3>
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700">
                      {list.map((m: any) => (
                        <div key={m.account_id} className="flex items-center justify-between p-3">
                          <div>
                            <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{m.accounts?.display_name}</p>
                            <p className="text-xs text-zinc-500">@{m.accounts?.username}</p>
                          </div>
                          <button 
                            onClick={() => handleRemoveMember(m.account_id)}
                            className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
