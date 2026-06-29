import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, DatabaseZap, RefreshCcw, RotateCcw, Trash2 } from 'lucide-react';
import { useTournamentStore } from '../store';
import { normalizeRpcError, tournamentRpc } from '../lib/api/tournamentRpc';

type DeletedTab = 'tournaments' | 'events';

function formatDate(value?: string | null) {
  if (!value) return 'Chưa rõ';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CountBadge({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-black text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
      {label}: <strong>{value}</strong>
    </span>
  );
}

export default function DeletedItemsManager() {
  const [activeTab, setActiveTab] = useState<DeletedTab>('tournaments');
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const userRole = useTournamentStore((state) => state.userRole);
  const tenantParam = userRole === 'SUPER_ADMIN' || activeTenantId === 'default' ? null : activeTenantId;

  const activeRows = activeTab === 'tournaments' ? tournaments : events;

  const totals = useMemo(() => ({
    tournaments: tournaments.length,
    events: events.length,
  }), [tournaments.length, events.length]);

  const loadData = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const [archivedTournaments, archivedEvents] = await Promise.all([
        tournamentRpc.listArchivedTournaments(tenantParam),
        tournamentRpc.listArchivedEvents(tenantParam),
      ]);
      setTournaments(Array.isArray(archivedTournaments) ? archivedTournaments : []);
      setEvents(Array.isArray(archivedEvents) ? archivedEvents : []);
    } catch (error) {
      setErrorMsg(normalizeRpcError(error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenantId, userRole]);

  const runAction = async (actionId: string, action: () => Promise<any>, success: string) => {
    setActionLoading(actionId);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await action();
      setSuccessMsg(success);
      await loadData();
    } catch (error) {
      setErrorMsg(normalizeRpcError(error).message);
    } finally {
      setActionLoading('');
    }
  };

  const restoreTournament = (row: any) => {
    runAction(
      `restore-tournament-${row.tournament_id}`,
      () => tournamentRpc.restoreTournament(row.tournament_id),
      `Đã khôi phục giải "${row.name}".`,
    );
  };

  const hardDeleteTournament = (row: any) => {
    const ok = window.confirm(`Xóa cứng giải "${row.name}" và toàn bộ dữ liệu bên trong? Thao tác này không thể khôi phục.`);
    if (!ok) return;
    runAction(
      `delete-tournament-${row.tournament_id}`,
      () => tournamentRpc.hardDeleteTournament(row.tournament_id),
      `Đã xóa cứng giải "${row.name}".`,
    );
  };

  const restoreEvent = (row: any) => {
    runAction(
      `restore-event-${row.event_id}`,
      () => tournamentRpc.restoreEvent(row.event_id),
      `Đã khôi phục nội dung "${row.name}".`,
    );
  };

  const hardDeleteEvent = (row: any) => {
    const ok = window.confirm(`Xóa cứng nội dung "${row.name}" và toàn bộ đội, bảng, trận liên quan? Thao tác này không thể khôi phục.`);
    if (!ok) return;
    runAction(
      `delete-event-${row.event_id}`,
      () => tournamentRpc.hardDeleteEvent(row.event_id),
      `Đã xóa cứng nội dung "${row.name}".`,
    );
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-red-600">Vùng dữ liệu đã lưu trữ</p>
            <h2 className="text-xl font-black text-zinc-900 dark:text-zinc-100">Đã xóa</h2>
            <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              Quản lý dữ liệu archived: khôi phục để dùng lại hoặc xóa cứng khi chắc chắn không cần nữa.
            </p>
          </div>
          <button
            type="button"
            onClick={loadData}
            disabled={loading || !!actionLoading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-black text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
          >
            <RefreshCcw size={16} /> Tải lại
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>Xóa cứng chỉ khả dụng với dữ liệu đã archived. Hệ thống sẽ xóa ngược dữ liệu con trước khi xóa giải hoặc nội dung.</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveTab('tournaments')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-black ${
              activeTab === 'tournaments'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            <DatabaseZap size={16} /> Danh sách giải ({totals.tournaments})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('events')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-black ${
              activeTab === 'events'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            <CalendarDays size={16} /> Danh sách nội dung ({totals.events})
          </button>
        </div>

        {errorMsg && <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{errorMsg}</div>}
        {successMsg && <div className="m-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{successMsg}</div>}

        {loading ? (
          <div className="flex items-center justify-center p-16 text-sm font-bold text-zinc-500">Đang tải dữ liệu archived...</div>
        ) : activeRows.length === 0 ? (
          <div className="p-16 text-center">
            <Trash2 className="mx-auto mb-3 h-10 w-10 text-zinc-300 dark:text-zinc-700" />
            <p className="font-black text-zinc-700 dark:text-zinc-200">Không có dữ liệu archived.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
                  <th className="px-4 py-3">{activeTab === 'tournaments' ? 'Giải đấu' : 'Nội dung'}</th>
                  <th className="px-4 py-3">Đơn vị</th>
                  {activeTab === 'events' && <th className="px-4 py-3">Giải chứa</th>}
                  <th className="px-4 py-3">Thống kê</th>
                  <th className="px-4 py-3">Archived</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((row) => {
                  const rowId = activeTab === 'tournaments' ? row.tournament_id : row.event_id;
                  return (
                    <tr key={rowId} className="border-b border-zinc-100 hover:bg-zinc-50/70 dark:border-zinc-800 dark:hover:bg-zinc-950">
                      <td className="px-4 py-4">
                        <div className="font-black text-zinc-900 dark:text-zinc-100">{row.name}</div>
                        <div className="mt-1 font-mono text-[11px] font-bold text-zinc-400">{row.slug || rowId}</div>
                      </td>
                      <td className="px-4 py-4 font-bold text-zinc-700 dark:text-zinc-200">{row.tenant_name || row.tenant_id || 'Chưa rõ'}</td>
                      {activeTab === 'events' && (
                        <td className="px-4 py-4">
                          <div className="font-bold text-zinc-700 dark:text-zinc-200">{row.tournament_name || row.tournament_id}</div>
                          <div className="font-mono text-[11px] text-zinc-400">{row.tournament_slug || row.tournament_id}</div>
                        </td>
                      )}
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {activeTab === 'tournaments' ? (
                            <>
                              <CountBadge label="Nội dung" value={row.events_count || 0} />
                              <CountBadge label="Đội" value={row.teams_count || 0} />
                              <CountBadge label="Trận" value={row.matches_count || 0} />
                            </>
                          ) : (
                            <>
                              <CountBadge label="Đội" value={row.teams_count || 0} />
                              <CountBadge label="Bảng" value={row.groups_count || 0} />
                              <CountBadge label="Trận" value={row.matches_count || 0} />
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs font-bold text-zinc-500">{formatDate(row.archived_at || row.updated_at)}</td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={!!actionLoading}
                            onClick={() => activeTab === 'tournaments' ? restoreTournament(row) : restoreEvent(row)}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-950/30 dark:text-emerald-300"
                          >
                            <RotateCcw size={14} /> Khôi phục
                          </button>
                          <button
                            type="button"
                            disabled={!!actionLoading}
                            onClick={() => activeTab === 'tournaments' ? hardDeleteTournament(row) : hardDeleteEvent(row)}
                            className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100 disabled:opacity-50 dark:bg-red-950/30 dark:text-red-300"
                          >
                            <Trash2 size={14} /> Xóa cứng
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
