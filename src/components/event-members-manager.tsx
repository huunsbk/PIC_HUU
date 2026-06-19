import React, { useMemo, useState } from 'react';
import { useEventMembersQuery } from './use-events-query';
import { X, UserPlus, Trash2, ShieldCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import ConfirmDialog from './ConfirmDialog';
import { normalizeRpcError, tournamentRpc, type EventAccessGrant } from '../lib/api/tournamentRpc';

export default function EventMembersManager({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { data: accessData, isLoading, error } = useEventMembersQuery(eventId);
  const queryClient = useQueryClient();
  const [selectedRefereeAccountId, setSelectedRefereeAccountId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [selectedGrant, setSelectedGrant] = useState<EventAccessGrant | null>(null);
  const permission = 'enter_scores';

  const grants = accessData?.grants || [];
  const eligibleAccounts = accessData?.eligible_accounts || [];
  const grantedAccountIds = useMemo(
    () => new Set(grants.filter((grant) => grant.permission === permission).map((grant) => grant.account_id)),
    [grants],
  );
  const availableAccounts = eligibleAccounts.filter((account) => !grantedAccountIds.has(account.account_id));

  const refreshMembers = async () => {
    await queryClient.invalidateQueries({ queryKey: ['event_members', eventId] });
    await queryClient.invalidateQueries({ queryKey: ['events'] });
  };

  const handleGrantAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRefereeAccountId) return;

    setIsSubmitting(true);
    try {
      await tournamentRpc.grantEventAccess(eventId, selectedRefereeAccountId, permission);
      setSelectedRefereeAccountId('');
      await refreshMembers();
    } catch (err) {
      alert('Lỗi cấp quyền: ' + normalizeRpcError(err).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const triggerRevokeAccess = (grant: EventAccessGrant) => {
    setSelectedGrant(grant);
    setIsConfirmOpen(true);
  };

  const handleConfirmRevokeAccess = async () => {
    if (!selectedGrant) return;

    setIsSubmitting(true);
    setIsConfirmOpen(false);
    try {
      await tournamentRpc.revokeEventAccess(eventId, selectedGrant.account_id, selectedGrant.permission || permission);
      await refreshMembers();
    } catch (err) {
      alert('Lỗi thu hồi quyền: ' + normalizeRpcError(err).message);
    } finally {
      setSelectedGrant(null);
      setIsSubmitting(false);
    }
  };

  const grantsByRole = grants.reduce<Record<string, EventAccessGrant[]>>((groups, grant) => {
    const roleName = grant.role_name || 'OTHER';
    groups[roleName] = groups[roleName] || [];
    groups[roleName].push(grant);
    return groups;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Cấp quyền trọng tài</h2>
            <p className="text-sm text-zinc-500">
              Nội dung: {accessData?.event?.name || eventId}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          <form onSubmit={handleGrantAccess} className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 mb-6">
            <label className="block">
              <span className="block text-xs font-bold uppercase text-zinc-500 mb-1">Tài khoản REFEREE / EVENT_ADMIN</span>
              <select
                value={selectedRefereeAccountId}
                onChange={(e) => setSelectedRefereeAccountId(e.target.value)}
                disabled={isSubmitting || availableAccounts.length === 0}
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              >
                <option value="">Chọn tài khoản...</option>
                {availableAccounts.map((account) => (
                  <option key={account.account_id} value={account.account_id}>
                    {account.display_name || account.username} (@{account.username}) - {account.role_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block text-xs font-bold uppercase text-zinc-500 mb-1">Quyền</span>
              <input
                value="enter_scores"
                readOnly
                className="w-full md:w-36 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-600"
              />
            </label>

            <button
              type="submit"
              disabled={!selectedRefereeAccountId || isSubmitting}
              className="self-end bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2"
            >
              <UserPlus size={16} /> Cấp quyền
            </button>
          </form>

          {availableAccounts.length === 0 && !isLoading && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Không còn tài khoản REFEREE hoặc EVENT_ADMIN active trong đơn vị này để cấp thêm quyền.
            </div>
          )}

          {error && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {normalizeRpcError(error).message}
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-8 text-zinc-500">Đang tải danh sách...</div>
          ) : grants.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
              Chưa có trọng tài hoặc quản trị nội dung nào được cấp quyền cho nội dung này.
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(grantsByRole).map(([role, list]) => (
                <div key={role}>
                  <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">{role}</h3>
                  <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700">
                    {list.map((grant) => (
                      <div key={`${grant.account_id}-${grant.permission}`} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">
                            {grant.display_name || grant.username}
                          </p>
                          <p className="text-xs text-zinc-500 truncate">
                            @{grant.username} · {grant.permission}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="hidden sm:inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                            <ShieldCheck size={13} /> Đã cấp
                          </span>
                          <button
                            onClick={() => triggerRevokeAccess(grant)}
                            disabled={isSubmitting}
                            className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded disabled:opacity-50"
                            title="Thu hồi quyền"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={isConfirmOpen}
        title="Thu hồi quyền trọng tài"
        message={`Bạn có chắc chắn muốn thu hồi quyền "${selectedGrant?.permission || permission}" của @${
          selectedGrant?.username || ''
        } khỏi nội dung thi đấu này không?`}
        confirmText="Thu hồi"
        cancelText="Hủy bỏ"
        isDanger={true}
        onConfirm={handleConfirmRevokeAccess}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </div>
  );
}
