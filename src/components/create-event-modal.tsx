import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useQueryClient } from '@tanstack/react-query';
import { useTournamentStore } from '../store';

export default function CreateEventModal({ onClose }: { onClose: () => void }) {
  const [eventName, setEventName] = useState('');
  const [slug, setSlug] = useState('');
  const [createAdmin, setCreateAdmin] = useState(false);
  
  // Admin form
  const [adminUser, setAdminUser] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [adminName, setAdminName] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();
  const tenantId = useTournamentStore(state => state.activeTenantId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      if (createAdmin) {
        // Use RPC
        const { data, error } = await supabase.rpc('create_event_admin', {
          p_tenant_id: tenantId,
          p_event_name: eventName,
          p_slug: slug,
          p_username: adminUser,
          p_password: adminPass,
          p_display_name: adminName
        });
        
        if (error) throw error;
      } else {
        // Direct insert if no admin to create
        const eventId = `evt_${Math.random().toString(36).substring(2, 10)}`;
        const { error } = await supabase.from('events').insert({
          id: eventId,
          tenant_id: tenantId,
          name: eventName,
          slug: slug,
          status: 'draft',
          settings: {}
        });
        if (error) throw error;
      }
      
      queryClient.invalidateQueries({ queryKey: ['events'] });
      onClose();
    } catch (err: any) {
      alert(`Lỗi tạo giải: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Tạo giải đấu mới</h2>
          <button onClick={onClose} className="p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto flex-1 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Tên giải đấu</label>
            <input required type="text" value={eventName} onChange={e => {
              setEventName(e.target.value);
              if (!slug) {
                // simple auto slug
                setSlug(e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-'));
              }
            }} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Slug (URL)</label>
            <input required type="text" value={slug} onChange={e => setSlug(e.target.value)} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm" />
          </div>

          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={createAdmin} onChange={e => setCreateAdmin(e.target.checked)} className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500" />
              ☑ Tạo EVENT_ADMIN đồng thời
            </label>
          </div>

          {createAdmin && (
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 mb-1">Username (Email prefix)</label>
                <input required={createAdmin} type="text" value={adminUser} onChange={e => setAdminUser(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 mb-1">Password</label>
                <input required={createAdmin} type="password" value={adminPass} onChange={e => setAdminPass(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 mb-1">Hiển thị (Display Name)</label>
                <input required={createAdmin} type="text" value={adminName} onChange={e => setAdminName(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
              </div>
            </div>
          )}

          <div className="pt-2">
            <p className="text-xs text-zinc-500">Preview URL: <span className="font-mono text-blue-600">/e/{slug || '...'}</span></p>
          </div>

          <div className="pt-4 flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg font-bold">Hủy</button>
            <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center justify-center gap-2">
              <Save size={16} /> Tạo
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
