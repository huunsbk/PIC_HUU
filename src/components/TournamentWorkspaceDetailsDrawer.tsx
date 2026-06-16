import React from 'react';
import { X, Calendar, MapPin, Tag } from 'lucide-react';
import { TournamentWorkspaceStat } from '../hooks/useTournamentWorkspaces';

interface TournamentWorkspaceDetailsDrawerProps {
  tournament: TournamentWorkspaceStat;
  onClose: () => void;
}

export default function TournamentWorkspaceDetailsDrawer({ tournament, onClose }: TournamentWorkspaceDetailsDrawerProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 h-full shadow-2xl flex flex-col animate-slide-in-right">
        
        <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Chi tiết Workspace</h2>
          <button onClick={onClose} className="p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          <div>
             <h3 className="text-2xl font-black text-zinc-900 dark:text-zinc-100">{tournament.name}</h3>
             <div className="inline-block px-3 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 text-xs font-bold rounded-full mt-2">
               Gói: {tournament.settings?.plan || 'Starter'}
             </div>
          </div>

          <div className="space-y-4">
             <div className="flex items-center gap-3 text-zinc-700 dark:text-zinc-300">
               <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                 <Tag size={18} />
               </div>
               <div>
                  <p className="text-xs text-zinc-500">Slug</p>
                  <p className="font-semibold">{tournament.slug}</p>
               </div>
             </div>

             <div className="flex items-center gap-3 text-zinc-700 dark:text-zinc-300">
               <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                 <Calendar size={18} />
               </div>
               <div>
                  <p className="text-xs text-zinc-500">Ngày tạo</p>
                  <p className="font-semibold">{new Date(tournament.created_at).toLocaleString('vi-VN')}</p>
               </div>
             </div>
          </div>

          <div className="pt-6 border-t border-zinc-200 dark:border-zinc-800">
             <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-4 uppercase tracking-wider">Owner</h4>
             <div className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700">
                {tournament.owner_name ? (
                   <p className="font-bold text-lg text-zinc-900 dark:text-zinc-100">{tournament.owner_name}</p>
                ) : (
                   <p className="text-zinc-500 italic">Chưa có Owner</p>
                )}
             </div>
          </div>

          <div className="pt-6 border-t border-zinc-200 dark:border-zinc-800">
             <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-4 uppercase tracking-wider">Thống kê</h4>
             <div className="grid grid-cols-3 gap-3">
                <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 p-3 rounded-xl text-center">
                   <p className="text-2xl font-black text-indigo-700 dark:text-indigo-400">{tournament.events_count}</p>
                   <p className="text-xs text-indigo-600/70 dark:text-indigo-400/70 font-bold uppercase mt-1">Events</p>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/50 p-3 rounded-xl text-center">
                   <p className="text-2xl font-black text-emerald-700 dark:text-emerald-400">{tournament.teams_count}</p>
                   <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70 font-bold uppercase mt-1">Teams</p>
                </div>
                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800/50 p-3 rounded-xl text-center">
                   <p className="text-2xl font-black text-orange-700 dark:text-orange-400">{tournament.matches_count}</p>
                   <p className="text-xs text-orange-600/70 dark:text-orange-400/70 font-bold uppercase mt-1">Matches</p>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
