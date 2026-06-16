/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { useTournamentStore } from '../store';
import { useTeams } from '../hooks/useTeams';
import { useGroups } from '../hooks/useGroups';
import { useTeamMutations } from '../hooks/useDataMutations';
import { Trash2, Edit2, Plus, Upload, FileType, Check, AlertCircle, Sparkles, HelpCircle, FileSpreadsheet } from 'lucide-react';
import { SeedType } from '../types';

export default function TeamManager() {
  const { addLog, hasPermission } = useTournamentStore();
  const { data: teamsData = [], isLoading: isLoadingTeams } = useTeams();
  const { data: groupsData = [] } = useGroups();
  const { addTeam, deleteTeam, updateTeam, importTeams } = useTeamMutations();
  const canManage = hasPermission('manage_teams');
  
  const groups: Record<string, any> = {};
  groupsData.forEach(g => { groups[g.id] = g; });
  const teamList = teamsData;
  const [newTeamName, setNewTeamName] = useState('');
  const [newSeed, setNewSeed] = useState<SeedType>('none');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSeed, setEditSeed] = useState<SeedType>('none');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Custom Confirmation Modal State to replace iframe-blocking confirm()
  const [teamToDelete, setTeamToDelete] = useState<{ id: string; name: string } | null>(null);

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string | null }>({
    type: 'success',
    message: null,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [excelPasteText, setExcelPasteText] = useState('');

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification({ type: 'success', message: null });
    }, 4000);
  };

  const handleImportFromExcelText = async () => {
    const text = excelPasteText.trim();
    if (!text) {
      showNotification('error', 'Vui lòng dán danh sách đội đấu trước.');
      return;
    }

    try {
      const added = await importTeams.mutateAsync(text);
      if (added > 0) {
        showNotification('success', `Đã thêm thành công ${added} đội từ Excel.`);
        setExcelPasteText('');
      } else {
        showNotification('error', 'Không thêm được đội nào.');
      }
    } catch (err: any) {
      showNotification('error', err.message || 'Lỗi khi nhập danh sách đội');
    }
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addTeam.mutateAsync({ name: newTeamName, seed: newSeed });
      showNotification('success', 'Thêm đội thành công.');
      setNewTeamName('');
      setNewSeed('none');
    } catch(err: any) {
      showNotification('error', err.message || 'Lỗi khi thêm đội');
    }
  };

  const handleStartEdit = (id: string, name: string, seed: SeedType) => {
    setEditingId(id);
    setEditName(name);
    setEditSeed(seed);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    try {
      await updateTeam.mutateAsync({ id: editingId, name: editName, seed: editSeed });
      showNotification('success', 'Sửa thông tin đội thành công.');
      setEditingId(null);
    } catch(err: any) {
      showNotification('error', err.message || 'Lỗi khi sửa đội');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!teamToDelete) return;
    try {
      await deleteTeam.mutateAsync(teamToDelete.id);
      showNotification('success', `Đã xóa đội "${teamToDelete.name}" thành công.`);
      setTeamToDelete(null);
    } catch(err: any) {
      showNotification('error', err.message || 'Lỗi khi xóa đội');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (text) {
        try {
          const count = await importTeams.mutateAsync(text);
          showNotification('success', `Tập tin xử lý thành công! Đã thêm ${count} đội.`);
          addLog('Danh Sách Đội', `Nhập loạt ${count} đội bằng file CSV thành công.`);
        } catch (error: any) {
          showNotification('error', error.message || 'Lỗi xử lý file.');
        }
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDownloadTemplate = () => {
    const csvContent = "data:text/csv;charset=utf-8,STT,Tên Đội,Hạt Giống (1-4 hoặc để trống)\n1,CLB Ba Đình,1\n2,Đội Hoàn Kiếm Đỏ,1\n3,Tập Đoàn Dầu Khí,2\n4,Pickleball Sông Đà,none\n5,Cầu Giấy Club,3\n6,Đống Đa Star,4";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "mau_danh_sach_doi_pickleball.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addLog('Mẫu Excel', 'Khởi tạo và tải xuống tập tin CSV danh sách đội mẫu thành công.');
  };

  const filteredTeams = teamList.filter((team) =>
    team.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4" id="team-manager-view">

      {!canManage && (
        <div className="bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 text-amber-800 dark:text-amber-400 text-xs p-3.5 rounded-xl flex items-start gap-2.5 shadow-xs transition-all duration-300 animate-pulse">
          <AlertCircle size={16} className="text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-extrabold text-sm flex items-center gap-1.5">Trạng thái: Chỉ Xem (Khách vãng lai)</p>
            <p className="text-[11px] font-semibold opacity-90">Vui lòng nhấp vào nút <strong>🔒 Đăng nhập Admin</strong> ở góc trên bên phải để bắt đầu thêm đội, sửa đổi, xếp bảng và nhập điểm số.</p>
          </div>
        </div>
      )}
      
      {/* Toast thông báo siêu sắc nét */}
      {notification.message && (
        <div
          className={`fixed bottom-4 right-4 p-3.5 rounded-xl shadow-2xl border text-xs flex items-center gap-2.5 z-50 animate-bounce duration-500 ${
            notification.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-250 dark:bg-emerald-950/90 dark:text-emerald-300 dark:border-emerald-800'
              : 'bg-red-50 text-red-850 border-red-250 dark:bg-red-950/90 dark:text-red-300 dark:border-red-800'
          }`}
          id="toast-notification"
        >
          {notification.type === 'success' ? <Check className="stroke-[3]" size={15} /> : <AlertCircle size={15} />}
          <span className="font-extrabold">{notification.message}</span>
        </div>
      )}

      {/* Grid Layout: Trái Thêm Mới, Phải Danh Sách */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* Cột Trái: Đăng ký & Nhập CSV */}
        <div className="lg:col-span-4 space-y-4">
          
          <div className="bg-white dark:bg-zinc-900 p-4.5 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-3">
            <h3 className="text-sm font-extrabold text-[#111c30] dark:text-zinc-100 flex items-center gap-1.5 border-b border-zinc-100 dark:border-zinc-800 pb-2 uppercase tracking-tight">
              <Plus size={16} className="text-blue-600 stroke-[2.5]" />
              Đăng Ký Đội Mới
            </h3>
            
            <form onSubmit={handleCreateTeam} className="space-y-3">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Tên Đội / Đấu Thủ</label>
                <input
                  type="text"
                  placeholder={canManage ? "Nhập tên CLB hoặc tên cặp đấu..." : "Yêu cầu quyền Admin..."}
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white text-xs font-semibold transition-all focus:shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  required
                  disabled={!canManage}
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Hạt Giống</label>
                <select
                  value={newSeed}
                  onChange={(e) => setNewSeed(e.target.value as SeedType)}
                  className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white text-xs font-black cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!canManage}
                >
                  <option value="none">Không hạt giống (Unseeded)</option>
                  <option value="1">Hạt giống số 1 (Seed 1)</option>
                  <option value="2">Hạt giống số 2 (Seed 2)</option>
                  <option value="3">Hạt giống số 3 (Seed 3)</option>
                  <option value="4">Hạt giống số 4 (Seed 4)</option>
                </select>
                <p className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 leading-normal">
                  Chỉ số hạt giống giúp chia đều các đối thủ qua các bảng đấu, tránh chạm trán nhau ở lượt vòng ngoài.
                </p>
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-blue-600 hover:bg-blue-500 hover:scale-[1.01] active:scale-[0.99] text-white font-black rounded-lg transition-all shadow-md text-xs flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600 disabled:scale-100"
                id="btn-add-team"
                disabled={!canManage}
              >
                <Plus size={15} className="stroke-[2.5]" /> 
                Thêm Vào Danh Sách
              </button>
            </form>
          </div>

          {/* Cột Đọc từ File và Mẫu excel */}
          <div className="bg-white dark:bg-zinc-900 p-4.5 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-2.5">
            <h3 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 uppercase tracking-tight">
              <Upload size={16} className="text-emerald-600 stroke-[2.5]" />
              Nhập Hàng Loạt
            </h3>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed font-semibold">
              Tải mẫu Excel/CSV xuống, điền nhanh danh mục rồi tải ngược lên đây để đồng bộ ngay tức thì.
            </p>

            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={handleDownloadTemplate}
                className="w-full py-2 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-805 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg transition-all font-bold flex items-center justify-center gap-1.5 text-xs cursor-pointer"
                id="btn-download-template"
              >
                <FileType size={14} className="text-blue-500" /> Tải File Excel Mẫu (.csv)
              </button>

              {canManage ? (
                <label className="w-full py-2 bg-emerald-50 hover:bg-emerald-100/80 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 border border-emerald-250 dark:border-emerald-800 rounded-lg transition-all font-extrabold flex items-center justify-center gap-1.5 text-xs cursor-pointer shadow-xs uppercase tracking-wider">
                  <Upload size={14} /> Nhập Danh Sách Có Sẵn
                  <input
                    type="file"
                    accept=".csv,.txt"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="w-full py-2 bg-zinc-100 text-zinc-400 dark:bg-zinc-800/50 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-800 rounded-lg font-extrabold flex items-center justify-center gap-1.5 text-xs cursor-not-allowed uppercase tracking-wider">
                  <Upload size={14} /> Khóa tính năng nhập File
                </div>
              )}
            </div>
          </div>

          {/* Sao chép nhanh từ Excel */}
          <div className="bg-white dark:bg-zinc-900 p-4.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800 shadow-xs space-y-2.5">
            <h3 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 uppercase tracking-tight">
              <FileSpreadsheet size={16} className="text-blue-500 stroke-[2.5]" />
              Sao Chép Từ Excel
            </h3>
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed font-semibold">
              Copy trực tiếp cột Tên Đội trong Excel/Sheets rồi dán vào khung dưới (mỗi đội một dòng):
            </p>
            <div className="space-y-2">
              <textarea
                placeholder={canManage ? "Dán các hàng tên đội tại đây..." : "Yêu cầu quyền Admin để dán..."}
                rows={3}
                value={excelPasteText}
                onChange={(e) => setExcelPasteText(e.target.value)}
                className="w-full p-2.5 border border-zinc-200 dark:border-zinc-805 rounded-lg text-xs font-semibold text-zinc-800 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                id="textarea-excel-paste"
                disabled={!canManage}
              />
              <button
                onClick={handleImportFromExcelText}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-lg transition-all flex items-center justify-center gap-1.5 text-xs cursor-pointer shadow-sm uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
                id="btn-import-excel-paste"
                disabled={!canManage}
              >
                Nhập danh sách dán vào
              </button>
            </div>
          </div>

        </div>

        {/* Cột Phải: Danh Sách Đăng Ký Ghi Nhận */}
        <div className="lg:col-span-8">
          <div className="bg-white dark:bg-zinc-900 p-4.5 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-3.5">
            
            {/* Header Danh Sách */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-808 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  Danh Sách Đấu Thủ Đã Đăng Ký
                  <span className="text-[10px] font-black py-0.5 px-2 bg-blue-50 text-blue-700 dark:bg-blue-955/60 dark:text-blue-300 rounded-full border border-blue-200/50">
                    {teamList.length} đội
                  </span>
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5 font-semibold">Tất cả vận động viên được duyệt tư cách thi đấu hợp lệ.</p>
              </div>

              {/* Bộ tìm kiếm to hơn */}
              <input
                type="text"
                placeholder="Tìm kiếm đội, vận động viên..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs font-semibold text-zinc-800 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-sm w-full shadow-xs"
              />
            </div>

            {/* Bảng Danh Sách */}
            {filteredTeams.length === 0 ? (
              <div className="py-14 text-center text-zinc-400 text-xs space-y-3">
                <Sparkles size={36} className="mx-auto text-zinc-300 dark:text-zinc-700" />
                <p className="text-zinc-650 dark:text-zinc-400 font-bold text-sm">Chưa tìm thấy đội thi đấu nào khớp.</p>
                <p className="text-[11px] text-zinc-500">Bấm nạp dữ liệu mô phỏng nhanh ở Trang chủ hoặc thêm thủ công bên trái.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-zinc-100 dark:border-zinc-805">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-55/70 dark:bg-zinc-850/60 border-b border-zinc-200 dark:border-zinc-800">
                      <th className="py-2 px-4 text-[10px] font-extrabold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">STT</th>
                      <th className="py-2 px-4 text-[10px] font-extrabold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Tên Đội Đấu</th>
                      <th className="py-2 px-4 text-[10px] font-extrabold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Hạt Giống</th>
                      <th className="py-2 px-4 text-[10px] font-extrabold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Vòng Bảng</th>
                      {canManage && <th className="py-2 px-4 text-[10px] font-extrabold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-right">Thao Tác</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-850">
                    {filteredTeams.map((team, index) => {
                      const isEditing = editingId === team.id;
                      return (
                        <tr
                          key={team.id}
                          className="hover:bg-zinc-50/50 dark:hover:bg-zinc-850/10 transition-all font-semibold"
                        >
                          <td className="py-2 px-4 text-xs text-zinc-450 dark:text-zinc-500 font-bold">{index + 1}</td>
                          
                          {/* Tên Đội */}
                          <td className="py-2 px-4">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="px-2.5 py-1 border border-blue-500 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 rounded-md text-xs w-full font-bold focus:outline-none"
                                required
                              />
                            ) : (
                              <span className="text-xs font-black text-zinc-900 dark:text-zinc-100">{team.name}</span>
                            )}
                          </td>

                          {/* Nhãn Hạt Giống */}
                          <td className="py-2 px-4">
                            {isEditing ? (
                              <select
                                value={editSeed}
                                onChange={(e) => setEditSeed(e.target.value as SeedType)}
                                className="px-1.5 py-1 border border-zinc-350 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 rounded-md text-[11px] font-bold"
                              >
                                <option value="none">Không</option>
                                <option value="1">Hạt giống 1</option>
                                <option value="2">Hạt giống 2</option>
                                <option value="3">Hạt giống 3</option>
                                <option value="4">Hạt giống 4</option>
                              </select>
                            ) : (
                              team.seed !== 'none' ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-amber-50 text-amber-700 dark:bg-amber-955/65 dark:text-amber-400 border border-amber-200">
                                  Hạt Giống {team.seed}
                                </span>
                              ) : (
                                <span className="text-[10px] text-zinc-430 font-medium">Phong trào</span>
                              )
                            )}
                          </td>

                          {/* Trạng Thái Chia Bảng */}
                          <td className="py-2 px-4">
                            {team.groupId ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-extrabold bg-blue-50 dark:bg-blue-955/40 text-blue-700 dark:text-blue-300 border border-blue-200/50">
                                Đã xếp {groups[team.groupId]?.name || `Bảng ${team.groupId.replace('group-', '').split('-')[0].toUpperCase()}`}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-zinc-100 text-zinc-400 dark:bg-zinc-805 dark:text-zinc-500 border border-transparent">
                                Chờ bốc thăm
                              </span>
                            )}
                          </td>

                          {/* Thao Tác */}
                          {canManage && (
                            <td className="py-2 px-4 text-right">
                              {isEditing ? (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={handleSaveEdit}
                                    className="p-1 px-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-black rounded-md cursor-pointer transition-all shadow-xs"
                                    id={`btn-save-edit-${team.id}`}
                                  >
                                    Lưu
                                  </button>
                                  <button
                                    onClick={() => setEditingId(null)}
                                    className="p-1 px-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-305 text-zinc-700 rounded-md text-[11px] font-bold cursor-pointer"
                                  >
                                    Hủy
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-end gap-3 text-zinc-400">
                                  <button
                                    onClick={() => handleStartEdit(team.id, team.name, team.seed)}
                                    className="hover:text-blue-500 transition-colors p-0.5 cursor-pointer"
                                    title="Sửa thông tin"
                                    id={`btn-edit-${team.id}`}
                                  >
                                    <Edit2 size={14} className="stroke-[2.5]" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setTeamToDelete({ id: team.id, name: team.name });
                                    }}
                                    className="hover:text-red-500 transition-colors p-0.5 cursor-pointer"
                                    title="Xóa ngay đấu thủ"
                                    id={`btn-delete-${team.id}`}
                                  >
                                    <Trash2 size={14} className="stroke-[2.5]" />
                                  </button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        </div>

      </div>

      {/* MODAL XÁC NHẬN XÓA TỰ CHẾ SIÊU PREMIUM (Xử lý dứt điểm rào cản iFrame và cho phép xóa ngay lập tức) */}
      {teamToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-51 animate-fade-in" id="delete-team-popup">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-md w-full p-6.5 shadow-2xl space-y-4">
            
            <div className="flex items-center gap-3.5 text-red-600">
              <div className="p-3 bg-red-50 dark:bg-red-950/50 rounded-2xl">
                <Trash2 size={24} className="stroke-[2.5]" />
              </div>
              <div>
                <h4 className="text-lg font-black text-zinc-900 dark:text-zinc-100 leading-tight">Yêu Cầu Xác Nhận Xóa</h4>
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Hành động nguy hiểm không thể phục hồi</p>
              </div>
            </div>

            <p className="text-sm font-semibold text-zinc-650 dark:text-zinc-400 leading-relaxed pt-2">
              Bạn có chắc chắn muốn xóa đấu thủ <strong className="text-red-600 dark:text-red-400 text-base">"{teamToDelete.name}"</strong> khỏi giải đấu? 
              Hệ thống sẽ thực hiện dọn sạch mọi lịch thi đấu và bảng xếp hạng liên quan đến đội này.
            </p>

            <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <button
                onClick={() => setTeamToDelete(null)}
                className="px-5 py-2.5 text-xs font-bold text-zinc-605 hover:text-zinc-800 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-805 dark:text-zinc-300 rounded-xl cursor-pointer"
                id="btn-close-delete-modal"
              >
                Giữ đấu thủ lại
              </button>
              
              <button
                onClick={handleDeleteConfirm}
                className="px-6 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-xl shadow-md cursor-pointer uppercase tracking-wider"
                id="btn-confirm-delete-submit"
              >
                Xác Nhận Xóa Đội
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
