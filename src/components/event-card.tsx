import React, { useState } from 'react';
import { Copy, ExternalLink, Users, Archive, Trash2 } from 'lucide-react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import EventMembersManager from './event-members-manager';
import ConfirmDialog from './ConfirmDialog';
import { tournamentRpc } from '../lib/api/tournamentRpc';

interface EventCardProps {
  event: any;
}

export default function EventCard({ event }: EventCardProps) {
  const [showMembers, setShowMembers] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const queryClient = useQueryClient();

  // Basic Mutation example for soft locking/archiving
  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      if (newStatus === 'archived') {
        return tournamentRpc.archiveEvent(event.id);
      }
      if (newStatus === 'active') {
        return tournamentRpc.restoreEvent(event.id);
      }
      return tournamentRpc.updateEventStatus(event, newStatus);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
    }
  });

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'active': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200';
      case 'draft': return 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-200';
      case 'completed': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200';
      case 'archived': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200';
      default: return 'bg-zinc-100 text-zinc-800';
    }
  };

  const getAppUrl = (path: string) => {
    const basePath = import.meta.env.BASE_URL || '/';
    const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
    return `${window.location.origin}${normalizedBase}${path.replace(/^\//, '')}`;
  };

  const copyPublicLink = () => {
    const url = getAppUrl(`/e/${event.slug || event.id}`);
    navigator.clipboard.writeText(url);
    alert('Đã copy link public!');
  };

  const handleDeleteConfirm = () => {
    tournamentRpc.archiveEvent(event.id)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['events'] });
        setIsConfirmOpen(false);
      });
  };

  return (
    <>
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
        <div className="flex justify-between items-start mb-4">
          <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-100 line-clamp-2">{event.name}</h3>
          <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded-md border ${getStatusColor(event.status)}`}>
            {event.status}
          </span>
        </div>

        <div className="flex-1 space-y-3 mb-6">
          <div className="flex items-center text-sm text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 p-2 rounded-md font-mono text-[11px]">
            <span className="truncate">/e/{event.slug || event.id}</span>
          </div>
        </div>

        <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 grid grid-cols-5 gap-1">
          <button onClick={copyPublicLink} className="p-2 flex justify-center items-center text-zinc-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Copy Link">
            <Copy size={16} />
          </button>
          <button onClick={() => window.open(getAppUrl(`/dashboard/event/${event.id}`), '_blank')} className="p-2 flex justify-center items-center text-zinc-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Open Dashboard">
            <ExternalLink size={16} />
          </button>
          <button onClick={() => setShowMembers(true)} className="p-2 flex justify-center items-center text-zinc-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Cấp quyền trọng tài">
            <Users size={16} />
          </button>
          <button onClick={() => updateStatusMutation.mutate(event.status === 'archived' ? 'active' : 'archived')} className="p-2 flex justify-center items-center text-zinc-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title={event.status === 'archived' ? 'Unarchive' : 'Archive'}>
            <Archive size={16} />
          </button>
          <button onClick={() => setIsConfirmOpen(true)} className="p-2 flex justify-center items-center text-zinc-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {showMembers && (
        <EventMembersManager eventId={event.id} onClose={() => setShowMembers(false)} />
      )}

      <ConfirmDialog
        isOpen={isConfirmOpen}
        title="Lưu trữ nội dung thi đấu"
        message={`Bạn có chắc chắn muốn lưu trữ nội dung "${event.name}" không?`}
        confirmText="Lưu trữ"
        cancelText="Hủy bỏ"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </>
  );
}
