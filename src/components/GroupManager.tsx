/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTournamentStore } from '../store';
import { useTeams } from '../hooks/useTeams';
import { useGroups } from '../hooks/useGroups';
import { useGroupMutations } from '../hooks/useDataMutations';
import { Layers, Shuffle, Sparkles, AlertTriangle, Trash2, HelpCircle, AlertCircle } from 'lucide-react';

export default function GroupManager() {
  const {
    hasPermission,
  } = useTournamentStore();

  const { data: teamsData = [], isLoading: isLoadingTeams } = useTeams();
  const { data: groupsData = [], isLoading: isLoadingGroups } = useGroups();
  const { clearAllGroups, setupGroups, autoGroupTeams, moveTeamToGroup } = useGroupMutations();

  const teams: Record<string, any> = {};
  teamsData.forEach(t => { teams[t.id] = t; });
  const groups: Record<string, any> = {};
  groupsData.forEach(g => { groups[g.id] = g; });

  const [numGroups, setNumGroups] = useState(4);
  const [draggedTeamId, setDraggedTeamId] = useState<string | null>(null);
  const canManage = hasPermission('manage_groups');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string | null }>({
    type: 'success',
    message: null,
  });

  // Custom Confirmation Modal State to bypass iframe confirm dialog blocking
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const teamList = Object.values(teams);
  const groupList = Object.values(groups);
  const unassignedTeams = teamList.filter((t) => t.groupId === null);
  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification({ type: 'success', message: null }), 4500);
  };

  const handleCreateGroupsEmpty = async () => {
    try {
      const result = await setupGroups.mutateAsync(numGroups);
      showNotification('success', `Đã tạo ${result?.num_groups || numGroups} bảng đấu trống.`);
    } catch(err) {
      console.error(err);
      showNotification('error', err instanceof Error ? err.message : 'Không tạo được bảng đấu.');
    }
  };

  const handleAutoGroup = async (method: 'random' | 'seed') => {
    if (teamList.length === 0) {
      try {
        alert('Vui lòng đăng ký đội bóng trước khi thực hiện chia bảng để tránh bảng đấu trống.');
      } catch (e) {
        console.warn('Alert blocked by browser sandboking:', e);
      }
      return;
    }
    try {
      const result = await autoGroupTeams.mutateAsync({ method, numGroups });
      const assignedTeams = result?.assigned_teams ?? teamList.length;
      const modeLabel = method === 'seed' ? 'theo hạt giống và phong trào' : 'ngẫu nhiên';
      showNotification('success', `Đã chia ${assignedTeams} đội ${modeLabel} vào ${result?.num_groups || numGroups} bảng.`);
    } catch (err) {
      console.error(err);
      showNotification('error', err instanceof Error ? err.message : 'Không chia bảng được.');
    }
  };

  // Drag & Drop HTML5 Handler cực kỳ nhịp nhàng, tối ưu
  const handleDragStart = (e: React.DragEvent, teamId: string) => {
    setDraggedTeamId(teamId);
    e.dataTransfer.setData('text/plain', teamId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Cho phép thả
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetGroupId: string | null) => {
    e.preventDefault();
    const teamId = e.dataTransfer.getData('text/plain') || draggedTeamId;
    if (teamId) {
      moveTeamToGroup.mutate({
        teamId,
        toGroupId: targetGroupId,
      });
    }
    setDraggedTeamId(null);
  };

  const handleClearGroupsConfirm = async () => {
    try {
      await clearAllGroups.mutateAsync();
      setShowClearConfirm(false);
      showNotification('success', 'Đã giải tán bảng đấu.');
    } catch(err) {
      console.error(err);
      showNotification('error', err instanceof Error ? err.message : 'Không giải tán được bảng đấu.');
    }
  };

  const isGroupingBusy = setupGroups.isPending || autoGroupTeams.isPending || clearAllGroups.isPending || moveTeamToGroup.isPending;

  return (
    <div className="space-y-4.5" id="group-manager-view">
      {notification.message && (
        <div
          className={`fixed bottom-4 right-4 p-3.5 rounded-xl shadow-2xl border text-xs flex items-center gap-2.5 z-50 ${
            notification.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-250 dark:bg-emerald-950/90 dark:text-emerald-300 dark:border-emerald-800'
              : 'bg-red-50 text-red-850 border-red-250 dark:bg-red-950/90 dark:text-red-300 dark:border-red-800'
          }`}
          id="group-toast-notification"
        >
          <AlertCircle size={15} />
          <span className="font-extrabold">{notification.message}</span>
        </div>
      )}

      {!canManage && (
        <div className="bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 text-amber-800 dark:text-amber-400 text-xs p-3.5 rounded-xl flex items-start gap-2.5 shadow-xs transition-all duration-300 animate-pulse">
          <AlertCircle size={16} className="text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-extrabold text-sm flex items-center gap-1.5">Trạng thái: Chỉ Xem (Khách vãng lai)</p>
            <p className="text-[11px] font-semibold opacity-90">Hãy nhấp vào nút <strong>🔒 Đăng nhập Admin</strong> ở góc trên bên phải để kích hoạt chức năng chia bảng tự động, kéo thả và giải tán bảng đấu.</p>
          </div>
        </div>
      )}
      
      {/* Thanh cấu hình (Bự, Dễ Đọc, Tương Phản) */}
      <div className="bg-white dark:bg-zinc-900 p-4.5 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-4 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 uppercase tracking-tight">
              <Layers size={17} className="text-blue-600 stroke-[2.5]" />
              Phân Chia Bảng Đấu Vòng Tròn
            </h3>
            <p className="text-xs text-zinc-400 font-semibold">
              Quản lý chia đấu thủ vào các bảng (tối đa 32 bảng). Chia hạt giống công bằng hoặc bốc thăm ngẫu nhiên.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-zinc-50 dark:bg-zinc-950 p-2 rounded-xl border border-zinc-200/50 dark:border-zinc-800/50 shrink-0">
            <span className="text-xs font-bold text-zinc-550 dark:text-zinc-400 uppercase tracking-wider">Số lượng bảng đấu:</span>
            <select
              value={numGroups}
              onChange={(e) => setNumGroups(Number(e.target.value))}
              className="px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs font-extrabold text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 focus:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              id="select-num-groups"
              disabled={!canManage}
            >
              {Array.from({ length: 32 }, (_, index) => index + 1).map((n) => {
                const getAlphabetLabel = (index: number) => {
                  let name = '';
                  let temp = index;
                  while (temp >= 0) {
                    name = String.fromCharCode((temp % 26) + 65) + name;
                    temp = Math.floor(temp / 26) - 1;
                  }
                  return name;
                };
                const labelSuffix = n === 1 ? 'A' : `A - ${getAlphabetLabel(n - 1)}`;
                return (
                  <option key={n} value={n}>
                    {n} Bảng đấu (Bảng {labelSuffix})
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {/* Nút hành động khơi mốc */}
        <div className="flex flex-wrap gap-2 pt-1 border-t border-zinc-100 dark:border-zinc-800/40">
          <button
            onClick={() => handleAutoGroup('seed')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-lg transition-all flex items-center gap-1.5 text-xs cursor-pointer shadow-sm uppercase tracking-wider hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-blue-600"
            id="btn-group-seed"
            disabled={!canManage || isGroupingBusy}
          >
            <Sparkles size={14} className="stroke-[2]" /> Tự Động Chia Bảng (Hạt Giống)
          </button>
          
          <button
            onClick={() => handleAutoGroup('random')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 dark:bg-emerald-750 dark:text-white dark:hover:bg-emerald-650 text-white font-black rounded-lg transition-all flex items-center gap-1.5 text-xs cursor-pointer shadow-sm uppercase tracking-wider hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-emerald-600"
            id="btn-group-random"
            disabled={!canManage || isGroupingBusy}
          >
            <Shuffle size={14} /> Chia Ngẫu Nhiên
          </button>

          <button
            onClick={handleCreateGroupsEmpty}
            className="px-4 py-2 bg-zinc-105 hover:bg-zinc-200 dark:bg-zinc-805 dark:text-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 font-extrabold rounded-lg transition-all text-xs cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
            id="btn-group-empty"
            disabled={!canManage || isGroupingBusy}
          >
            Tạo Bảng Đấu Trống
          </button>

          <button
            onClick={() => setShowClearConfirm(true)}
            className="px-4 py-2 hover:bg-red-50 dark:hover:bg-red-955/15 text-red-650 font-black rounded-lg transition-all text-xs cursor-pointer ml-auto border border-red-200/50 dark:border-red-900/30 uppercase tracking-widest flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            id="btn-clear-groups"
            disabled={!canManage || isGroupingBusy}
          >
            <Trash2 size={14} /> Giải Tán Bảng
          </button>
        </div>

        {/* Cảnh báo đồng bộ */}
        <div className="flex items-start gap-2.5 p-3 bg-amber-50 dark:bg-amber-955/20 border border-amber-200/50 dark:border-amber-900/40 rounded-lg text-yellow-850 dark:text-yellow-400">
          <AlertCircle size={15} className="shrink-0 mt-0.5 text-amber-500" />
          <p className="text-[11px] leading-relaxed font-semibold">
            LƯU Ý ĐỒNG BỘ: Việc phân chia bảng, đổi hạt giống hoặc kéo thả chuyển bảng sẽ tự động xóa sạch lịch thi đấu và điểm số cũ của bảng đấu đó để bốc thăm và xếp lịch thi đấu vòng mới.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Đội chưa chia bảng */}
        <div
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, null)}
          className="lg:col-span-1 bg-zinc-100/65 dark:bg-zinc-950 p-4 rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-855 space-y-2.5 min-h-[250px] shadow-inner"
          id="unassigned-teams-panel"
        >
          <div>
            <h4 className="text-xs font-black text-zinc-900 dark:text-zinc-100 flex items-center justify-between uppercase">
              <span>Chờ Chia Bảng</span>
              <span className="py-0.5 px-1.5 bg-blue-105 text-blue-800 dark:bg-blue-955/60 dark:text-blue-300 rounded-full text-[10px] font-black">
                {unassignedTeams.length} đội
              </span>
            </h4>
            <p className="text-[10px] text-zinc-430 mt-0.5 font-bold">Kéo thả đấu thủ vào bảng bên phải (hoặc dùng menu thả nhanh).</p>
          </div>

          <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1">
            {unassignedTeams.length === 0 ? (
              <div className="py-8 text-center text-zinc-400 text-xs border border-dashed border-zinc-200 dark:border-zinc-850 rounded-xl font-bold">
                Tất cả các đội đã được xếp bảng!
              </div>
            ) : (
              unassignedTeams.map((team) => (
                <div
                  key={team.id}
                  draggable={canManage}
                  onDragStart={(e) => handleDragStart(e, team.id)}
                  className={`p-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-805 rounded-lg shadow-xs hover:border-blue-500 hover:ring-1 hover:ring-blue-500/20 dark:hover:border-blue-500 transition-all flex items-center justify-between font-semibold ${canManage ? "cursor-grab" : "cursor-default opacity-85"}`}
                >
                  <div className="truncate pr-1.5">
                    <p className="text-xs font-black text-zinc-850 dark:text-zinc-100 truncate">{team.name}</p>
                    {team.seed !== 'none' && (
                      <span className="inline-block mt-0.5 text-[9px] bg-amber-50 text-amber-700 dark:bg-amber-955/40 dark:text-amber-400 font-extrabold px-1.5 py-0.5 rounded border border-amber-200/50">
                        Seed {team.seed}
                      </span>
                    )}
                  </div>
                  
                  {/* Selector di chuyển nhanh dạng menu (Dành cho Mobile, màn cảm ứng để mượt mà) */}
                  <select
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) {
                        moveTeamToGroup.mutate({
                          teamId: team.id,
                          toGroupId: val,
                        });
                      }
                    }}
                    value=""
                    className="p-1 px-1.5 text-[10px] font-bold border border-zinc-200 dark:border-zinc-800 rounded bg-zinc-50 dark:bg-zinc-950 text-zinc-650 dark:text-zinc-400 cursor-pointer focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={!canManage || isGroupingBusy}
                  >
                    <option value="" disabled>Gán...</option>
                    {groupList.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Hiển thị các bảng đấu thực tế rộng lớn hơn */}
        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-6" id="groups-grid-panel">
          {groupList.length === 0 ? (
            <div className="col-span-full py-20 text-center text-zinc-400 text-sm space-y-4 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
              <Layers size={54} className="mx-auto text-zinc-350 dark:text-zinc-700" />
              <p className="font-extrabold text-zinc-700 dark:text-zinc-300 text-base">Chưa có bảng đấu nào được thiết lập.</p>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto font-medium">Bấm "Tự động phân bổ" hoặc lựa chọn số bảng rồi ghim "Tạo bảng trống" ở trên để bắt đầu sắp xếp các bảng tròn đấu.</p>
            </div>
          ) : (
            groupList.map((group) => {
              const groupTeams = group.teamIds.map((tId) => teams[tId]).filter(Boolean);
              
              return (
                <div
                  key={group.id}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, group.id)}
                  className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 hover:border-blue-400 dark:hover:border-indigo-805 transition-all shadow-md space-y-5 flex flex-col justify-between"
                  id={`panel-group-${group.id}`}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
                      <span className="text-sm font-black text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-955/60 py-1 px-3 rounded-lg border border-blue-100 dark:border-blue-900/30">
                        {group.name}
                      </span>
                      <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">
                        {groupTeams.length} Đội Đã Xếp
                      </span>
                    </div>

                    <div className="space-y-2.5 min-h-[160px] max-h-[350px] overflow-y-auto pr-1">
                      {groupTeams.length === 0 ? (
                        <div className="py-12 text-center text-xs text-zinc-400 border border-dashed border-zinc-150 dark:border-zinc-805 rounded-xl font-semibold leading-relaxed">
                          Chưa có đấu thủ.<br />Thả đội vào đây hoặc dùng menu "Rời bảng" để tinh chỉnh.
                        </div>
                      ) : (
                        groupTeams.map((team) => (
                          <div
                            key={team.id}
                            draggable={canManage}
                            onDragStart={(e) => handleDragStart(e, team.id)}
                            className="p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-850 rounded-xl hover:border-blue-500 dark:hover:border-blue-500 transition-all flex items-center justify-between pointer-events-auto cursor-grab"
                          >
                            <div className="truncate pr-2">
                              <p className="text-xs font-black text-zinc-900 dark:text-zinc-100 truncate">{team.name}</p>
                              {team.seed !== 'none' && (
                                <span className="inline-block mt-1 text-[9px] bg-amber-50 text-amber-700 dark:bg-amber-955/40 dark:text-amber-400 font-extrabold px-1.5 py-0.5 rounded border border-amber-200/50">
                                  Hạt Giống {team.seed}
                                </span>
                              )}
                            </div>

                            {/* Menu di chuyển nhanh fallback */}
                            <select
                              onChange={(e) => {
                                const val = e.target.value;
                                moveTeamToGroup.mutate({
                                  teamId: team.id,
                                  toGroupId: val === "unassigned" ? null : val,
                                });
                              }}
                              value={group.id}
                              disabled={!canManage}
                              className="p-0.5 text-[9px] font-black border border-zinc-200 dark:border-zinc-800 rounded bg-white dark:bg-zinc-900 text-zinc-550 dark:text-zinc-400 cursor-pointer focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <option value="unassigned">Rời nhóm</option>
                              {groupList.map((g) => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                              ))}
                            </select>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="text-[10px] text-zinc-400 flex items-center justify-end gap-1.5 border-t border-zinc-50 dark:border-zinc-800/40 pt-3 font-semibold">
                    <HelpCircle size={13} className="text-zinc-300 dark:text-zinc-600" /> Hệ thống hỗ trợ thả đè chồng để đảo bảng cực nhanh
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* POPUP XÁC NHẬN GIẢI TÁN BẢNG ĐẤU CUSTOM SIÊU KHỦNG - AN TOÀN TRÊN MỌI KHUNG iFRAME */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-51 animate-fade-in" id="clear-groups-popup">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-md w-full p-6.5 shadow-2xl space-y-4">
            
            <div className="flex items-center gap-3.5 text-red-650">
              <div className="p-3 bg-red-50 dark:bg-red-955/40 rounded-2xl">
                <Trash2 size={24} className="stroke-[2.5]" />
              </div>
              <div>
                <h4 className="text-lg font-black text-zinc-900 dark:text-zinc-100 leading-tight">Yêu Cầu Giải Tán Bảng Đấu</h4>
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Cảnh báo vận hành</p>
              </div>
            </div>

            <p className="text-sm font-semibold text-zinc-650 dark:text-zinc-400 leading-relaxed pt-2">
              Bạn có thực sự muốn <strong className="text-red-600 dark:text-red-400 font-extrabold">GIẢI TÁN TOÀN BỘ CẤU HÌNH BẢNG ĐẤU</strong> hiện tại không?
              Thao tác này đồng thời sẽ xóa bỏ vĩnh viễn toàn bộ Lịch thi đấu vòng bảng và Điểm số kết quả đã ghi từ trước đến nay.
            </p>

            <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-805">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-5 py-2.5 text-xs font-bold text-zinc-605 hover:text-zinc-850 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-805 dark:text-zinc-300 rounded-xl cursor-pointer"
              >
                Hủy bỏ
              </button>
              
              <button
                onClick={handleClearGroupsConfirm}
                className="px-6 py-2.5 text-xs font-bold text-white bg-red-650 hover:bg-red-500 rounded-xl shadow-md cursor-pointer uppercase tracking-wider"
                id="btn-confirm-clear"
              >
                Giải Tán Sạch Bảng Đấu
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
