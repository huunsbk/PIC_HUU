/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTournamentStore } from '../store';
import { 
  Plus, 
  Trash2, 
  Edit3, 
  Check, 
  X, 
  Award,
  Layers,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function EventBar() {
  const { 
    events, 
    currentEventId, 
    addEvent, 
    deleteEvent, 
    renameEvent, 
    setCurrentEvent,
    hasPermission,
    selectedTab
  } = useTournamentStore();

  const isReadOnlyTab = ['groups', 'matches', 'standings', 'knockout'].includes(selectedTab);
  const canEdit = hasPermission("manage_events") && !isReadOnlyTab;

  const [isAdding, setIsAdding] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newEventName.trim();
    if (name) {
      addEvent(name);
      setNewEventName('');
      setIsAdding(false);
    }
  };

  const startEditing = (id: string, name: string) => {
    setEditingEventId(id);
    setEditingName(name);
  };

  const handleSaveRename = (id: string) => {
    const name = editingName.trim();
    if (name) {
      renameEvent(id, name);
      setEditingEventId(null);
    }
  };

  const handleDeleteConfirm = () => {
    if (deletingId) {
      deleteEvent(deletingId);
      setDeletingId(null);
    }
  };

  const eventList = Object.values(events || {});

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 mb-4 shadow-xs" id="tournament-events-bar">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        {/* Tiêu đề & Giới thiệu */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-blue-50 dark:bg-blue-950/40 rounded-lg text-blue-600 dark:text-blue-400">
              <Award size={16} className="stroke-[2.5]" />
            </span>
            <span className="text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Nội dung thi đấu đang chọn
            </span>
          </div>
          <h3 className="text-sm font-extrabold text-zinc-950 dark:text-zinc-50 flex items-center gap-1.5">
            {events[currentEventId]?.name || 'Nội dung mặc định'}
            <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-850 text-zinc-650 dark:text-zinc-400 text-[10px] rounded font-bold uppercase tracking-wide">
              {Object.keys(events[currentEventId]?.teams || {}).length} Vận động viên / Cặp đấu
            </span>
          </h3>
        </div>

        {/* Danh sách các nội dung thi đấu & Thao tác */}
        <div className="flex flex-wrap items-center gap-2 select-none md:justify-end flex-1">
          <AnimatePresence mode="popLayout">
            {eventList.map((evt) => {
              const isActive = evt.id === currentEventId;
              const isEditing = evt.id === editingEventId;

              if (isEditing) {
                return (
                  <motion.div
                    key={`edit-${evt.id}`}
                    layoutId={`tab-${evt.id}`}
                    className="flex items-center gap-1 bg-blue-50 dark:bg-blue-950/20 px-2 py-1 rounded-lg border border-blue-200 dark:border-blue-900/40"
                  >
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(evt.id);
                        if (e.key === 'Escape') setEditingEventId(null);
                      }}
                      className="bg-white dark:bg-zinc-950 px-2 py-0.5 text-xs font-bold text-zinc-900 dark:text-zinc-100 outline-none border border-zinc-200 dark:border-zinc-800 rounded w-36 focus:ring-1 focus:ring-blue-500"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveRename(evt.id)}
                      className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 text-emerald-600 rounded cursor-pointer"
                      title="Lưu tên"
                    >
                      <Check size={14} className="stroke-[2.5]" />
                    </button>
                    <button
                      onClick={() => setEditingEventId(null)}
                      className="p-1 hover:bg-red-150 dark:hover:bg-red-950/50 text-red-600 rounded cursor-pointer"
                      title="Hủy"
                    >
                      <X size={14} className="stroke-[2.5]" />
                    </button>
                  </motion.div>
                );
              }

              return (
                <motion.div
                  key={`tab-${evt.id}`}
                  layoutId={`tab-${evt.id}`}
                  onClick={() => !isActive && setCurrentEvent(evt.id)}
                  className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                      : 'bg-zinc-50 dark:bg-zinc-850 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-650 dark:text-zinc-350 border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  <span className="truncate max-w-[120px]">{evt.name}</span>
                  
                  {/* Icon chỉnh sửa / xóa hiển thị khi hoever (hoặc luôn hiện trên di động) */}
                  {canEdit && (
                    <div className={`flex items-center gap-1 ${isActive ? 'opacity-90' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditing(evt.id, evt.name);
                        }}
                        className={`p-0.5 rounded transition-colors ${
                          isActive ? 'hover:bg-blue-500 text-white' : 'hover:bg-zinc-200 dark:hover:bg-zinc-750 text-zinc-500'
                        }`}
                        title="Đổi tên nội dung"
                      >
                        <Edit3 size={11} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingId(evt.id);
                        }}
                        className={`p-0.5 rounded transition-colors ${
                          isActive ? 'hover:bg-red-700 text-red-200' : 'hover:bg-red-50 dark:hover:bg-red-955/20 text-red-550'
                        }`}
                        title="Xóa nội dung"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </motion.div>
              );
            })}

            {canEdit && (isAdding ? (
              <motion.form
                key="add-form"
                layoutId="add-button"
                onSubmit={handleCreate}
                className="flex items-center gap-1 bg-zinc-50 dark:bg-zinc-855 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800"
              >
                <input
                  type="text"
                  placeholder="Tên nội dung ví dụ: Đôi Nam Nữ..."
                  value={newEventName}
                  onChange={(e) => setNewEventName(e.target.value)}
                  className="bg-white dark:bg-zinc-950 px-2 py-0.5 text-xs font-bold text-zinc-900 dark:text-zinc-100 outline-none border border-zinc-200 dark:border-zinc-800 rounded w-44 focus:ring-1 focus:ring-blue-500"
                  autoFocus
                />
                <button
                  type="submit"
                  className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 text-emerald-600 rounded cursor-pointer"
                  title="Thêm"
                >
                  <Check size={14} className="stroke-[2.5]" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="p-1 hover:bg-red-150 dark:hover:bg-red-955/50 text-red-650 rounded cursor-pointer"
                  title="Hủy"
                >
                  <X size={14} className="stroke-[2.5]" />
                </button>
              </motion.form>
            ) : (
              <motion.button
                key="add-btn"
                layoutId="add-button"
                onClick={() => setIsAdding(true)}
                className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 dark:bg-emerald-700 dark:hover:bg-emerald-650 text-white font-extrabold rounded-lg transition-all flex items-center gap-1 text-xs cursor-pointer shadow-xs uppercase tracking-wider"
              >
                <Plus size={13} className="stroke-[2.5]" /> Thêm nội dung
              </motion.button>
            ))}
          </AnimatePresence>
        </div>

      </div>

      {/* Modal xác nhận xóa nội dung thi đấu */}
      <AnimatePresence>
        {deletingId && (
          <div className="fixed inset-0 z-55 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4 text-left"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-xl text-red-650 shrink-0">
                  <AlertTriangle size={24} className="stroke-[2]" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-base font-extrabold text-zinc-900 dark:text-zinc-50 uppercase tracking-tight">
                    Xác nhận xóa nội dung?
                  </h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-semibold">
                    Bạn sắp xóa vĩnh viễn nội dung thi đấu <strong className="text-zinc-900 dark:text-white">"{events[deletingId]?.name}"</strong>. Hành động này sẽ xóa sạch danh sách tất cả các đội tuyển, phân chia bảng đấu, lịch thi đấu, tỉ số và bảng xếp hạng của riêng nội dung này.
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDeletingId(null)}
                  className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-750 text-zinc-700 dark:text-zinc-300 font-bold rounded-lg text-xs tracking-wider cursor-pointer transition-all uppercase"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={handleDeleteConfirm}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-black rounded-lg text-xs tracking-widest cursor-pointer shadow-md transition-all uppercase"
                >
                  Đồng ý xóa sạch
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
