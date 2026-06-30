/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTournamentStore } from '../store';
import { useMatches } from '../hooks/useMatches';
import { useGroups } from '../hooks/useGroups';
import { useTournamentRpcMutations } from '../hooks/useTournamentRpcMutations';
import { isUsableEventId, useEvents } from '../hooks/useEvents';
import { Trophy, AlertTriangle, ZoomIn, ZoomOut, Maximize, Trash2 } from 'lucide-react';
import { getReadableKoMatchName } from '../utils/tournamentEngine';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

type BracketSize = 4 | 8 | 16 | 32;
type SlotCode = 'A' | 'B';
type SlotSourceType = 'group_rank' | 'best_third';

interface RankSourceCard {
  id: string;
  label: string;
  source_type: SlotSourceType;
  group_id?: string;
  group_name?: string;
  group_rank?: number;
  best_third_index?: number;
}

const getRoundCount = (size: BracketSize) => {
  switch (size) {
    case 4: return 2;
    case 8: return 3;
    case 16: return 4;
    case 32: return 5;
  }
};

const getRoundName = (size: BracketSize, round: number) => {
  const roundCount = getRoundCount(size);
  if (round === roundCount) return 'Chung Kết';
  if (round === roundCount - 1) return 'Bán Kết';
  if (round === roundCount - 2) return 'Tứ Kết';
  if (size === 16 && round === 1) return 'Vòng 16 Đội';
  if (size === 32 && round === 1) return 'Vòng 32 Đội';
  if (size === 32 && round === 2) return 'Vòng 16 Đội';
  return 'Vòng Knockout';
};

const getKoId = (roundName: string, matchIndex: number, round: number) => {
  if (roundName === 'Chung Kết') return 'F';
  if (roundName === 'Bán Kết') return `SF${matchIndex}`;
  if (roundName === 'Tứ Kết') return `QF${matchIndex}`;
  if (roundName === 'Vòng 16 Đội') return `R16${matchIndex}`;
  if (roundName === 'Vòng 32 Đội') return `R32${matchIndex}`;
  return `KO${round}-${matchIndex}`;
};

const shortKoLabel = (koId?: string | null) => {
  if (!koId) return 'trận trước';
  if (koId === 'F') return 'Chung Kết';
  if (koId.startsWith('SF')) return `Bán Kết ${koId.replace('SF', '')}`;
  if (koId.startsWith('QF')) return `Tứ Kết ${koId.replace('QF', '')}`;
  if (koId.startsWith('R16')) return `Vòng 16 Đội ${koId.replace('R16', '')}`;
  if (koId.startsWith('R32')) return `Vòng 32 Đội ${koId.replace('R32', '')}`;
  return koId;
};

const createManualDraftMatches = (size: BracketSize) => {
  const roundCount = getRoundCount(size);
  const created: any[] = [];
  const idByRoundIndex = new Map<string, { id: string; koId: string }>();

  for (let round = 1; round <= roundCount; round += 1) {
    const matchesInRound = size / (2 ** round);
    const roundName = getRoundName(size, round);
    for (let matchIndex = 1; matchIndex <= matchesInRound; matchIndex += 1) {
      const id = `manual-${round}-${matchIndex}`;
      const koId = getKoId(roundName, matchIndex, round);
      idByRoundIndex.set(`${round}:${matchIndex}`, { id, koId });
    }
  }

  for (let round = 1; round <= roundCount; round += 1) {
    const matchesInRound = size / (2 ** round);
    const roundName = getRoundName(size, round);
    for (let matchIndex = 1; matchIndex <= matchesInRound; matchIndex += 1) {
      const current = idByRoundIndex.get(`${round}:${matchIndex}`)!;
      const next = round < roundCount ? idByRoundIndex.get(`${round + 1}:${Math.ceil(matchIndex / 2)}`) : null;
      const prevA = round > 1 ? idByRoundIndex.get(`${round - 1}:${matchIndex * 2 - 1}`) : null;
      const prevB = round > 1 ? idByRoundIndex.get(`${round - 1}:${matchIndex * 2}`) : null;

      created.push({
        id: current.id,
        groupId: 'knockout',
        teamAId: null,
        teamBId: null,
        placeholderA: round === 1 ? '' : `Thắng ${shortKoLabel(prevA?.koId)}`,
        placeholderB: round === 1 ? '' : `Thắng ${shortKoLabel(prevB?.koId)}`,
        slotSourceA: null,
        slotSourceB: null,
        scoreA: null,
        scoreB: null,
        winnerId: null,
        status: 'pending',
        round,
        knockoutRoundName: roundName,
        knockoutMatchId: current.koId,
        nextMatchId: next?.id || null,
        nextMatchSlot: round < roundCount ? (matchIndex % 2 === 1 ? 'A' : 'B') : null,
      });
    }
  }

  return created;
};

export default function KnockoutBracket() {
  const {
    hasPermission,
    currentEventId,
  } = useTournamentStore();

  const { data: matchesData = [] } = useMatches();
  const { data: groupsData = [] } = useGroups();
  const { data: eventsData = [] } = useEvents();
  const selectedEventId = isUsableEventId(currentEventId) && eventsData.some((event) => event.id === currentEventId)
    ? currentEventId
    : eventsData[0]?.id;
  const {
    save_manual_knockout_bracket_v1,
    clear_knockout_bracket_v1,
  } = useTournamentRpcMutations();
  const matches = matchesData as any[];

  const canManage = hasPermission("manage_knockout");

  const [sz, setSz] = useState<BracketSize>(4);
  const [showClearConfirmModal, setShowClearConfirmModal] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [bestThirdCount, setBestThirdCount] = useState(0);

  // States nâng cấp cho chế độ chỉnh sửa thủ công và hiển thị thông báo
  const [draftMatches, setDraftMatches] = useState<any[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Lọc lấy các trận đấu Knockout hoặc dùng draftMatches khi đang sửa
  const koMatches = isEditMode ? draftMatches : matches.filter((m) => m.groupId === 'knockout');

  // Đếm các trận thi đấu knockout theo vòng
  const roundsMap: Record<number, typeof koMatches> = {};
  koMatches.forEach((m) => {
    if (!roundsMap[m.round]) {
      roundsMap[m.round] = [];
    }
    roundsMap[m.round].push(m);
  });

  const roundsKeys = Object.keys(roundsMap)
    .map(Number)
    .sort((a, b) => a - b);

  const getKoParticipantLines = (m: any, slot: 'A' | 'B') => {
    const placeholder = slot === 'A' ? m.placeholderA : m.placeholderB;
    return { primary: placeholder || 'Chưa xác định', secondary: '' };
  };

  const sortedGroups = [...groupsData].sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true }));
  const rankCards: RankSourceCard[] = [
    ...sortedGroups.map((group: any) => {
      const groupLabel = String(group.name || '').replace(/^Bảng\s+/i, '').trim() || group.id;
      return {
        id: `group_rank:${group.id}:1`,
        label: `Hạng 1 bảng ${groupLabel}`,
        source_type: 'group_rank' as const,
        group_id: group.id,
        group_name: group.name,
        group_rank: 1,
      };
    }),
    ...sortedGroups.map((group: any) => {
      const groupLabel = String(group.name || '').replace(/^Bảng\s+/i, '').trim() || group.id;
      return {
        id: `group_rank:${group.id}:2`,
        label: `Hạng 2 bảng ${groupLabel}`,
        source_type: 'group_rank' as const,
        group_id: group.id,
        group_name: group.name,
        group_rank: 2,
      };
    }),
    ...Array.from({ length: bestThirdCount }).map((_, index) => ({
      id: `best_third:${index + 1}`,
      label: `Hạng 3 xuất sắc ${index + 1}`,
      source_type: 'best_third' as const,
      best_third_index: index + 1,
    })),
  ];

  const usedCardIds = new Set<string>();
  draftMatches.forEach((match) => {
    if (match.slotSourceA?.id) usedCardIds.add(match.slotSourceA.id);
    if (match.slotSourceB?.id) usedCardIds.add(match.slotSourceB.id);
  });

  const validateDraftMatches = (items: any[]) => {
    const round1Matches = items.filter(m => m.round === 1);
    let hasEmpty = false;

    for (const m of round1Matches) {
      if (!m.slotSourceA || !m.slotSourceB) {
        hasEmpty = true;
      }
    }

    return { hasEmpty };
  };

  const handleSlotDrop = (matchId: string, slot: SlotCode, card: RankSourceCard) => {
    setDraftMatches((prev) => prev.map((m) => {
      if (m.id !== matchId) return m;
      const sourceKey = slot === 'A' ? 'slotSourceA' : 'slotSourceB';
      const placeholderKey = slot === 'A' ? 'placeholderA' : 'placeholderB';
      return slot === 'A'
        ? { ...m, [sourceKey]: card, [placeholderKey]: card.label, teamAId: null, scoreA: null, scoreB: null, winnerId: null, status: 'pending' }
        : { ...m, [sourceKey]: card, [placeholderKey]: card.label, teamBId: null, scoreA: null, scoreB: null, winnerId: null, status: 'pending' };
    }));
  };

  const handleClearSlot = (matchId: string, slot: SlotCode) => {
    setDraftMatches((prev) => prev.map((m) => {
      if (m.id !== matchId) return m;
      return slot === 'A'
        ? { ...m, slotSourceA: null, placeholderA: '', teamAId: null, scoreA: null, scoreB: null, winnerId: null, status: 'pending' }
        : { ...m, slotSourceB: null, placeholderB: '', teamBId: null, scoreA: null, scoreB: null, winnerId: null, status: 'pending' };
    }));
  };

  const handleToggleEditMode = () => {
    if (!canManage) return;
    if (!isEditMode) {
      const existingMatches = matches.filter((m) => m.groupId === 'knockout');
      if (existingMatches.length > 0) {
        setErrorMessage('Sơ đồ KO đã khóa. Hãy xóa sơ đồ trước khi tạo lại.');
        return;
      }
      setErrorMessage(null);
      setDraftMatches(createManualDraftMatches(sz));
      setIsEditMode(true);
    } else {
      handleCancelEditMode();
    }
  };

  const handleCancelEditMode = () => {
    setIsEditMode(false);
    setDraftMatches([]);
    setErrorMessage(null);
  };

  const handleConfirmSaveBracket = async () => {
    if (!selectedEventId) return;
    const { hasEmpty } = validateDraftMatches(draftMatches);
    if (hasEmpty) {
      setErrorMessage("Còn vị trí placeholder chưa được nhập.");
      return;
    }

    setErrorMessage(null);

    try {
      const firstRoundSlots = draftMatches
        .filter((m) => m.round === 1)
        .sort((a, b) => (a.knockoutMatchId || '').localeCompare(b.knockoutMatchId || '', undefined, { numeric: true }))
        .map((m, index) => ({
          match_index: index + 1,
          slot_a: m.slotSourceA,
          slot_b: m.slotSourceB,
        }));

      const result = await save_manual_knockout_bracket_v1.mutateAsync({
        eventId: selectedEventId,
        bracketSize: sz,
        slots: firstRoundSlots,
      });
      setSuccessMessage(`Đã lưu sơ đồ knockout thủ công (${result.created_matches || 0} trận).`);
      setTimeout(() => setSuccessMessage(null), 4500);
      setIsEditMode(false);
      setDraftMatches([]);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Không lưu được sơ đồ knockout thủ công.');
    }
  };

  const handleClearBracketConfirm = async () => {
    if (!selectedEventId) return;
    try {
      const result = await clear_knockout_bracket_v1.mutateAsync(selectedEventId);
      setSuccessMessage(`Đã xóa sơ đồ knockout (${result.deleted_matches || 0} trận).`);
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Không xóa được sơ đồ knockout.');
    } finally {
      setShowClearConfirmModal(false);
    }
  };


  return (
    <div className="space-y-8" id="knockout-bracket-view">

      {successMessage && (
        <div className="bg-emerald-500/15 border-2 border-emerald-500/35 text-emerald-800 dark:text-emerald-400 text-xs p-4 rounded-xl shadow-lg transition-all duration-300 flex items-start gap-3">
          <span className="text-xl shrink-0">✨</span>
          <div className="space-y-1 font-bold whitespace-pre-line text-sm leading-relaxed">
            {successMessage}
          </div>
        </div>
      )}

      {!canManage && (
        <div className="bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 text-amber-800 dark:text-amber-400 text-xs p-3.5 rounded-xl flex items-start gap-2.5 shadow-xs transition-all duration-300 animate-pulse">
          <AlertTriangle size={16} className="text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5 animate-none">
            <p className="font-extrabold text-sm flex items-center gap-1.5">Trạng thái: Chỉ Xem (Khách vãng lai)</p>
            <p className="text-[11px] font-semibold opacity-90">Hãy nhấp vào nút <strong>🔒 Đăng nhập Admin</strong> ở góc trên bên phải để bắt đầu thiết lập sơ đồ trực tiếp, xóa nhánh hoặc nhập điểm số đấu loại loại trực tiếp.</p>
          </div>
        </div>
      )}
      
      {/* Thẻ điều khiển lập nhánh (To Rõ, Đầy Đủ Chức Năng, Tách Biệt 2 Chế Độ) */}
      <div className="bg-white dark:bg-zinc-900 p-7 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-md">
        <div className="space-y-1">
          <h3 className="text-xl font-extrabold text-[#111c30] dark:text-zinc-100 flex items-center gap-2 uppercase tracking-tight">
            <Trophy size={22} className="text-amber-500 stroke-[2.5]" />
            Sơ Đồ Nhánh Knockout Loại Trực Tiếp
          </h3>
          <p className="text-xs text-zinc-400 font-semibold">
            {isEditMode 
              ? "Kéo thẻ hạng bảng hoặc hạng 3 xuất sắc vào từng slot vòng đầu."
              : "Sơ đồ knockout chỉ hiển thị placeholder nguồn hạng. Đội thật được xử lý ở lịch thi đấu/trình chiếu."}
          </p>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-3">
            {/* Chọn số đội (Quy mô nhánh đấu) - Chỉ hiện khi ở chế độ khoá */}
            {!isEditMode && koMatches.length === 0 && (
              <div className="flex items-center gap-2 bg-zinc-55 dark:bg-zinc-950 p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase px-2 select-none">Quy mô:</span>
                <select
                  value={sz}
                  onChange={(e) => setSz(Number(e.target.value) as BracketSize)}
                  className="px-2 py-1 border-none rounded-lg text-xs font-black text-zinc-800 dark:text-zinc-100 bg-transparent cursor-pointer outline-none focus:ring-0"
                >
                  <option value={4}>4 đội (Bán Kết - 2 bảng)</option>
                  <option value={8}>8 đội (Tứ Kết)</option>
                  <option value={16}>16 đội (Vòng 1/8)</option>
                  <option value={32}>32 đội (Vòng 1/16)</option>
                </select>
              </div>
            )}

            {!isEditMode && koMatches.length > 0 && (
              <button
                onClick={() => setShowClearConfirmModal(true)}
                className="px-5 py-3 bg-red-600 hover:bg-red-500 text-white font-black rounded-xl text-xs transition-all flex items-center gap-2 shadow-md uppercase tracking-wider cursor-pointer"
                id="btn-clear-knockout"
              >
                <Trash2 size={16} /> Xóa sơ đồ
              </button>
            )}

            {/* Nút 2: Sửa thủ công / Hoàn tất */}
            {!isEditMode && koMatches.length === 0 && (
              <button
                onClick={handleToggleEditMode}
                className="px-5 py-3 text-xs font-black rounded-xl cursor-pointer border transition-all uppercase tracking-wider shadow-xs bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 border-zinc-250 dark:border-zinc-700 shadow-sm"
              >
                Chỉnh sửa thủ công
              </button>
            )}
          </div>
        )}
      </div>

      {koMatches.length === 0 ? (
        <div className="py-24 text-center text-zinc-400 bg-white dark:bg-zinc-900 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl space-y-4 shadow-inner">
          <Trophy size={54} className="mx-auto text-zinc-300 dark:text-zinc-700 animate-bounce" />
          <p className="font-extrabold text-zinc-700 dark:text-zinc-300 text-lg">Sơ đồ đấu loại trực tiếp (Cúp vàng) chưa được lập.</p>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto font-semibold">Chọn quy mô, sau đó nhấn "Chỉnh sửa thủ công" để kéo thẻ hạng bảng vào sơ đồ.</p>
        </div>
      ) : (
        <div className={isEditMode ? "fixed inset-0 z-[100] bg-zinc-50 dark:bg-zinc-950 flex flex-row w-screen h-screen overflow-hidden" : "space-y-8"}>
          
          {isEditMode && (
            <div className="w-80 shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 p-5 flex flex-col h-full shadow-2xl z-50 overflow-y-auto">
              {/* Header */}
              <div className="flex flex-col gap-4 mb-6">
                <div className="flex flex-col gap-2">
                  <h3 className="font-extrabold text-zinc-900 dark:text-zinc-100 text-xs uppercase tracking-wider text-center bg-zinc-100 dark:bg-zinc-800 py-1.5 rounded-lg">
                    Chế độ chỉnh sửa thủ công
                  </h3>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={handleCancelEditMode}
                      className="px-3 py-2 text-[11px] font-black bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-lg transition-transform active:scale-95 cursor-pointer text-center uppercase tracking-wider"
                    >
                      Hủy bỏ
                    </button>
                    <button 
                      onClick={handleConfirmSaveBracket}
                      className="px-3 py-2 text-[11px] font-black bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-transform active:scale-95 cursor-pointer text-center uppercase tracking-wider shadow-md"
                      id="btn-confirm-save-bracket"
                    >
                      Xác nhận tạo sơ đồ
                    </button>
                  </div>
                </div>

                {errorMessage && (
                  <div className="bg-red-500/10 border border-red-500/25 text-red-605 dark:text-red-400 text-[11px] p-3 rounded-lg font-bold animate-pulse text-center" id="bracket-edit-error">
                    ⚠️ {errorMessage}
                  </div>
                )}
                
                <div className="flex flex-col gap-2 p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-inner">
                    <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest text-center">Quy mô sơ đồ</span>
                    <select
                      value={sz}
                      onChange={(e) => {
                        const nextSize = Number(e.target.value) as BracketSize;
                        setSz(nextSize);
                        setDraftMatches(createManualDraftMatches(nextSize));
                      }}
                      className="w-full px-3 py-2 text-sm font-bold border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-center"
                    >
                      <option value={4}>4 đội - Bán kết</option>
                      <option value={8}>8 đội - Tứ kết</option>
                      <option value={16}>16 đội - Vòng 16</option>
                      <option value={32}>32 đội - Vòng 32</option>
                    </select>
                  </div>

                <div className="flex flex-col gap-2 p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-inner">
                  <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest text-center">Số thẻ hạng 3 xuất sắc</span>
                  <input
                    type="number"
                    min={0}
                    max={32}
                    value={bestThirdCount}
                    onChange={(e) => setBestThirdCount(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full px-3 py-2 text-sm font-bold border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-center"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 leading-relaxed bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
                  Kéo mỗi thẻ vào một slot vòng đầu. Sau khi lưu, sơ đồ KO bị khóa và chỉ còn thao tác xóa để tạo lại.
                  <div className="mt-3 text-[11px] font-black text-zinc-700 dark:text-zinc-200">
                    Slot cần điền: {draftMatches.filter((m) => m.round === 1).length * 2} · Thẻ còn lại: {rankCards.filter((card) => !usedCardIds.has(card.id)).length}
                  </div>
                  {rankCards.length < draftMatches.filter((m) => m.round === 1).length * 2 && (
                    <div className="mt-2 text-[11px] font-black text-red-600 dark:text-red-400">
                      Số thẻ nguồn chưa đủ slot. Tăng số hạng 3 xuất sắc hoặc giảm quy mô sơ đồ.
                    </div>
                  )}
                </div>

                {[
                  { title: 'Hạng 1 bảng', cards: rankCards.filter((card) => card.source_type === 'group_rank' && card.group_rank === 1) },
                  { title: 'Hạng 2 bảng', cards: rankCards.filter((card) => card.source_type === 'group_rank' && card.group_rank === 2) },
                  { title: 'Hạng 3 xuất sắc', cards: rankCards.filter((card) => card.source_type === 'best_third') },
                ].map((section) => (
                  <div key={section.title} className="space-y-2">
                    <div className="text-[11px] font-black uppercase text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 text-center py-2 rounded-lg">
                      {section.title}
                    </div>
                    <div className="flex flex-col gap-2">
                      {section.cards.filter((card) => !usedCardIds.has(card.id)).map((card) => (
                        <div
                          key={card.id}
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify(card))}
                          className="px-4 py-3 bg-white dark:bg-zinc-800 rounded-xl text-xs font-black cursor-move border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 hover:shadow-md hover:-translate-y-0.5 transition-all text-center"
                        >
                          {card.label}
                        </div>
                      ))}
                      {section.cards.filter((card) => !usedCardIds.has(card.id)).length === 0 && (
                        <div className="text-xs text-zinc-400 text-center py-3 italic font-medium bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
                          Không còn thẻ khả dụng
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bracket Tree Layout bằng CSS Flexbox Columns nối tiếp */}
          <div className={isEditMode ? "flex-1 h-full relative" : "relative bg-white dark:bg-zinc-900 rounded-3xl border border-solid border-zinc-200 dark:border-zinc-805 shadow-md overflow-hidden min-h-[78vh] mt-4"} style={!isEditMode ? { borderStyle: 'solid' } : undefined} id="bracket-view-wrapper">
            <TransformWrapper
              initialScale={1}
              minScale={0.2}
              maxScale={2.5}
              centerOnInit={false}
              limitToBounds={false}
              wheel={{ step: 0.035 }}
              panning={{ disabled: false }}
            >
              {({ zoomIn, zoomOut, resetTransform, setTransform, state }) => (
                <React.Fragment>
                  <div className="hidden md:flex absolute top-4 right-4 z-50 items-center gap-2 bg-zinc-100 dark:bg-zinc-800 p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm">
                    <button onClick={() => zoomOut()} className="p-2 hover:bg-white dark:hover:bg-zinc-700 rounded-lg text-zinc-600 dark:text-zinc-300 transition-colors pointer-events-auto" title="Thu nhỏ">
                      <ZoomOut size={18} />
                    </button>
                    <input 
                      type="range" 
                      min="0.3" max="2" step="0.05"
                      value={state.scale}
                      onChange={(e) => setTransform(state.positionX, state.positionY, parseFloat(e.target.value))}
                      className="w-24 mx-1 accent-blue-500 cursor-pointer pointer-events-auto"
                    />
                    <button onClick={() => zoomIn()} className="p-2 hover:bg-white dark:hover:bg-zinc-700 rounded-lg text-zinc-600 dark:text-zinc-300 transition-colors pointer-events-auto" title="Phóng to">
                      <ZoomIn size={18} />
                    </button>
                    <div className="w-px h-6 bg-zinc-300 dark:bg-zinc-700 mx-1"></div>
                    <button onClick={() => resetTransform()} className="p-2 hover:bg-white dark:hover:bg-zinc-700 rounded-lg text-zinc-600 dark:text-zinc-300 transition-colors pointer-events-auto" title="Vừa màn hình">
                      <Maximize size={18} />
                    </button>
                  </div>
                  <TransformComponent wrapperClass="w-full h-full" wrapperStyle={{ width: '100%', height: isEditMode ? '100%' : '78vh' }} contentStyle={{ minWidth: '100%', minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: '120px 160px 180px 80px' }}>
                    <div className="flex gap-10 min-w-[1100px] justify-between items-center relative py-10">
                      {roundsKeys.map((roundIdx) => {
                const roundMatches = roundsMap[roundIdx];
                const roundName = roundMatches[0]?.knockoutRoundName || `Vòng đấu ${roundIdx}`;

                return (
                  <div
                    key={roundIdx}
                    className="flex-1 flex flex-col gap-14"
                    id={`bracket-column-round-${roundIdx}`}
                    style={roundIdx === 1 ? {
                      height: '693.333px',
                      paddingLeft: '0px',
                      paddingRight: '0px',
                      marginLeft: '0px',
                      marginTop: '0px',
                      width: '630px'
                    } : undefined}
                  >
                    {/* Tên vòng đấu cột bự và sáng láng */}
                    <div className="text-center font-black text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-955/40 py-2.5 px-3 rounded-xl uppercase tracking-widest border border-blue-105 dark:border-blue-900/30">
                      {roundName}
                    </div>

                    {/* Danh sách trận đấu dọc */}
                    <div className="flex flex-col justify-around gap-6 min-h-[680px] relative">
                      {roundMatches.map((m) => {
                        const isFinished = m.status === 'finished';
                        
                        return (
                          <div
                            key={m.id}
                            className={`p-4.5 rounded-2xl border text-sm shadow-md transition-all duration-200 bg-zinc-50 dark:bg-zinc-950 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent w-76 md:w-88 ${
                              isFinished
                                ? 'border-zinc-250 dark:border-zinc-800'
                                : 'border-zinc-200 dark:border-zinc-805'
                            }`}
                            id={`bracket-match-node-${m.id}`}
                            style={m.id === 'ko-QF1-ww7imxn' ? {
                              paddingLeft: '3px',
                              paddingTop: '3px',
                              paddingRight: '3px',
                              paddingBottom: '3px'
                            } : undefined}
                          >
                             <div 
                              className="flex items-center justify-between text-[10px] text-zinc-400 font-extrabold mb-3 pb-2 border-b border-zinc-200/55 dark:border-zinc-850/60 uppercase"
                              style={m.id === 'ko-QF2-3f2hlbu' ? { marginBottom: '0px' } : undefined}
                            >
                              <span style={{ fontSize: '14px', color: '#dd13c8' }}>{getReadableKoMatchName(m.knockoutMatchId || '')}</span>
                              {isFinished && <span className="text-emerald-600 dark:text-emerald-400 font-bold">HOÀN TẤT</span>}
                            </div>

                            <div className="space-y-4">
                              {(['A', 'B'] as const).map((slot) => {
                                const lines = getKoParticipantLines(m, slot);
                                const value = slot === 'A' ? m.placeholderA : m.placeholderB;
                                return (
                                  <div key={slot} className="flex items-center justify-between gap-3">
                                    {isEditMode && m.round === 1 ? (
                                      <div
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          const raw = e.dataTransfer.getData('application/json');
                                          if (!raw) return;
                                          const card = JSON.parse(raw) as RankSourceCard;
                                          handleSlotDrop(m.id, slot, card);
                                        }}
                                        className={`relative w-full min-h-10 px-3 py-2 rounded-lg border-2 border-dashed text-xs font-black transition-all ${
                                          value
                                            ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-100'
                                            : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-400'
                                        }`}
                                        id={`drop-ko-match-${m.id}-slot-${slot}`}
                                      >
                                        <span className="block truncate pr-6">
                                          {value || 'Thả thẻ vào đây'}
                                        </span>
                                        {value && (
                                          <button
                                            type="button"
                                            onClick={() => handleClearSlot(m.id, slot)}
                                            className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-black leading-5 text-center hover:bg-red-600"
                                            title="Gỡ thẻ khỏi slot"
                                          >
                                            x
                                          </button>
                                        )}
                                      </div>
                                    ) : (
                                      <div
                                        className="max-w-[240px] text-zinc-800 dark:text-zinc-200"
                                        title={lines.primary}
                                      >
                                        <span className="font-black text-xs sm:text-sm truncate block">
                                          {lines.primary}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
                    </div>
                  </TransformComponent>
                </React.Fragment>
              )}
            </TransformWrapper>
          </div>
        </div>
      )}

      {/* POPUP XÁC NHẬN HỦY SƠ ĐỒ LOẠI TRỰC TIẾP TRONG iFRAME AN TOÀN TUYỆT ĐỐI */}
      {showClearConfirmModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-51 animate-fade-in" id="clear-bracket-popup">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-md w-full p-6.5 shadow-2xl space-y-4">
            
            <div className="flex items-center gap-3.5 text-red-650">
              <div className="p-3 bg-red-50 dark:bg-red-955/40 rounded-2xl">
                <AlertTriangle size={24} className="stroke-[2.5] text-red-550" />
              </div>
              <div>
                <h4 className="text-lg font-black leading-tight text-zinc-900 dark:text-zinc-100">Yêu Cầu Hủy Sơ Đồ Nhánh</h4>
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Hành động nhạy cảm nguy hiểm</p>
              </div>
            </div>

            <p className="text-sm font-semibold text-zinc-650 dark:text-zinc-400 leading-relaxed pt-2">
              <strong>CẢNH BÁO:</strong> Thao tác này sẽ <strong className="text-red-600 dark:text-red-400 font-black underline uppercase">XÓA BỎ VĨNH VIỄN</strong> toàn bộ sơ đồ phân nhánh và lịch đấu loại trực tiếp đang diễn ra (bao gồm các trận đã thi đấu có kết quả). 
              Bạn có thực sự chắc chắn muốn thực hiện lại quy trình bốc thăm không?
            </p>

            <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <button
                onClick={() => setShowClearConfirmModal(false)}
                className="px-5 py-2.5 text-xs font-bold text-zinc-600 hover:text-zinc-700 bg-zinc-105 hover:bg-zinc-200 dark:bg-zinc-805 dark:text-zinc-300 rounded-xl cursor-pointer"
              >
                Hủy bỏ
              </button>
              
              <button
                onClick={handleClearBracketConfirm}
                disabled={clear_knockout_bracket_v1.isPending}
                className="px-6 py-2.5 text-xs font-bold text-white bg-red-650 hover:bg-red-600 rounded-xl shadow-md cursor-pointer uppercase tracking-wider"
                id="btn-confirm-clear-bracket"
              >
                {clear_knockout_bracket_v1.isPending ? 'Đang xóa...' : 'Xóa sơ đồ nhánh cũ'}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
