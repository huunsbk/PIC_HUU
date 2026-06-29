import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Copy, ExternalLink, Plus, Settings, ShieldAlert, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useEventsQuery, useEventMembersQuery } from './use-events-query';
import EventMembersManager from './event-members-manager';
import CreateEventModal from './create-event-modal';
import EventConfigModal from './EventConfigModal';
import ConfirmDialog from './ConfirmDialog';
import { useTournamentStore } from '../store';
import { tournamentRpc } from '../lib/api/tournamentRpc';

function EventRefereeSummary({ eventId }: { eventId: string }) {
  const { data, isLoading } = useEventMembersQuery(eventId);
  const grants = data?.grants || [];

  if (isLoading) {
    return <span className="text-[11px] font-bold text-zinc-400">Đang tải...</span>;
  }

  if (grants.length === 0) {
    return <span className="text-[11px] font-bold text-amber-600">Chưa cấp quyền</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {grants.slice(0, 3).map((grant) => (
        <span
          key={`${grant.account_id}-${grant.permission}`}
          className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
        >
          <ShieldCheck size={12} />
          {grant.display_name || grant.username}
        </span>
      ))}
      {grants.length > 3 && (
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          +{grants.length - 3}
        </span>
      )}
    </div>
  );
}

export default function EventManagementPage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [membersEventId, setMembersEventId] = useState<string | null>(null);
  const [archiveEvent, setArchiveEvent] = useState<any | null>(null);
  const [configEvent, setConfigEvent] = useState<any | null>(null);

  const { data: events, isLoading, error } = useEventsQuery();
  const queryClient = useQueryClient();
  const currentEnterpriseUser = useTournamentStore((state) => state.currentEnterpriseUser);
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const activeTenantName = useTournamentStore((state) => state.activeTenantName);
  const tournament = useTournamentStore((state) => state.tournament);
  const activeTournamentId = useTournamentStore((state) => state.activeTournamentId);
  const hasPermission = useTournamentStore((state) => state.hasPermission);
  const canCreateEvents = hasPermission('create_events');

  const updateStatusMutation = useMutation({
    mutationFn: async ({ event, status }: { event: any; status: string }) => {
      if (status === 'archived') return tournamentRpc.archiveEvent(event.id);
      if (status === 'active') return tournamentRpc.restoreEvent(event.id);
      return tournamentRpc.updateEventStatus(event, status);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['events'] });
      setArchiveEvent(null);
    },
  });

  if (activeTenantId === 'default' && (!currentEnterpriseUser || currentEnterpriseUser.role_name !== 'SUPER_ADMIN')) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-red-100 bg-white p-12 text-center dark:border-red-900/30 dark:bg-zinc-900">
        <ShieldAlert className="mb-4 h-12 w-12 text-red-500" />
        <h3 className="mb-2 text-xl font-bold text-zinc-900 dark:text-zinc-100">Truy Cập Bị Từ Chối</h3>
        <p className="text-zinc-500 dark:text-zinc-400">Bạn đang ở Tenant mặc định. Vui lòng mở đúng đơn vị/giải đấu để quản lý nội dung thi đấu.</p>
      </div>
    );
  }

  const filteredEvents = (events || []).filter((event: any) => {
    if ((event.status || 'active') === 'archived') return false;
    if (statusFilter === 'all') return true;
    return event.status === statusFilter;
  });

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900';
      case 'completed':
        return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900';
      case 'archived':
        return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900';
      default:
        return 'bg-zinc-50 text-zinc-600 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800';
    }
  };

  const getAppUrl = (path: string) => {
    const basePath = import.meta.env.BASE_URL || '/';
    const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
    return `${window.location.origin}${normalizedBase}${path.replace(/^\//, '')}`;
  };

  const copyPublicLink = async (event: any) => {
    await navigator.clipboard.writeText(getAppUrl(`/e/${event.slug || event.id}`));
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Quản lý theo cây</p>
          <h1 className="text-xl font-black text-zinc-900 dark:text-zinc-100">Nội dung thi đấu</h1>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Đơn vị &gt; Giải đấu &gt; Nội dung &gt; Trọng tài</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
          {canCreateEvents && (
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-blue-700"
            >
              <Plus size={16} /> Tạo nội dung
            </button>
          )}
        </div>
      </header>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-wrap items-center gap-2 text-xs font-black text-zinc-700 dark:text-zinc-200">
            <span className="rounded-md bg-blue-600 px-2 py-1 text-white">Đơn vị</span>
            <span>{activeTenantName || currentEnterpriseUser?.tenant?.name || activeTenantId || 'Chưa chọn'}</span>
            <span className="text-zinc-300">/</span>
            <span className="rounded-md bg-indigo-600 px-2 py-1 text-white">Giải</span>
            <span>{tournament.name || activeTournamentId || 'Chưa chọn'}</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center p-12">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
          </div>
        ) : error ? (
          <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-600">
            Đã xảy ra lỗi khi tải danh sách nội dung thi đấu.
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="py-16 text-center">
            <CalendarDays className="mx-auto mb-3 h-12 w-12 text-zinc-300 dark:text-zinc-600" />
            <p className="font-bold text-zinc-500">Chưa có nội dung thi đấu phù hợp.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1080px] w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
                  <th className="px-4 py-3">STT</th>
                  <th className="px-4 py-3">Đơn vị quản lý / Tenant Admin</th>
                  <th className="px-4 py-3">Giải đấu / Event Admin</th>
                  <th className="px-4 py-3">Nội dung thi đấu</th>
                  <th className="px-4 py-3">Trạng thái</th>
                  <th className="px-4 py-3">Trọng tài / Event Admin</th>
                  <th className="px-4 py-3 text-right">Chức năng</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event: any, index: number) => (
                  <tr key={event.id} className="border-b border-zinc-100 hover:bg-zinc-50/70 dark:border-zinc-850 dark:hover:bg-zinc-950/60">
                    <td className="px-4 py-4 font-black text-zinc-500 dark:text-zinc-400">
                      {index + 1}
                    </td>
                    <td className="px-4 py-4 font-bold text-zinc-700 dark:text-zinc-200">
                      {activeTenantName || currentEnterpriseUser?.tenant?.name || activeTenantId}
                    </td>
                    <td className="px-4 py-4 font-bold text-zinc-700 dark:text-zinc-200">
                      {tournament.name || activeTournamentId}
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-black text-zinc-900 dark:text-zinc-100">{event.name}</div>
                      <div className="mt-1 font-mono text-[10px] font-bold text-zinc-400">{event.id}</div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-md border px-2 py-1 text-[10px] font-black uppercase ${getStatusClass(event.status)}`}>
                        {event.status || 'draft'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <EventRefereeSummary eventId={event.id} />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setConfigEvent(event)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-indigo-50 hover:text-indigo-600"
                          title="Chỉnh cấu hình nội dung"
                        >
                          <Settings size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => copyPublicLink(event)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-blue-50 hover:text-blue-600"
                          title="Copy link"
                        >
                          <Copy size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => window.open(getAppUrl(`/dashboard/event/${event.id}`), '_blank')}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-blue-50 hover:text-blue-600"
                          title="Mở dashboard"
                        >
                          <ExternalLink size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setMembersEventId(event.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-emerald-50 hover:text-emerald-600"
                          title="Cấp quyền trọng tài"
                        >
                          <Users size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setArchiveEvent(event)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-red-50 hover:text-red-600"
                          title="Lưu trữ nội dung"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isCreateModalOpen && <CreateEventModal onClose={() => setIsCreateModalOpen(false)} />}
      {configEvent && <EventConfigModal event={configEvent} onClose={() => setConfigEvent(null)} />}
      {membersEventId && <EventMembersManager eventId={membersEventId} onClose={() => setMembersEventId(null)} />}

      <ConfirmDialog
        isOpen={!!archiveEvent}
        title="Lưu trữ nội dung thi đấu"
        message={`Bạn có chắc chắn muốn lưu trữ nội dung "${archiveEvent?.name || ''}" không?`}
        confirmText="Lưu trữ"
        cancelText="Hủy bỏ"
        isDanger
        onConfirm={() => archiveEvent && updateStatusMutation.mutate({ event: archiveEvent, status: 'archived' })}
        onCancel={() => setArchiveEvent(null)}
      />
    </div>
  );
}
