/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useTournamentStore } from '../store';
import { Trophy, PlayCircle, HelpCircle, AlertTriangle, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { getReadableTeamName, getReadableKoMatchName, calculateGroupStandings, calculateBestThirdPlaces } from '../utils/tournamentEngine';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

export default function KnockoutBracket() {
  const {
    tournament,
    matches,
    teams,
    groups,
    generateKnockoutBracket,
    clearKnockout,
    updateKnockoutScore,
    updateKnockoutParticipant,
    addLog,
    isAdmin,
  } = useTournamentStore();

  const [sz, setSz] = useState<4 | 8 | 16 | 32>(4);
  const [showClearConfirmModal, setShowClearConfirmModal] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [numBestThirds, setNumBestThirds] = useState<number>(3);

  // Lấy danh sách đội thi đấu để làm dropdown chọn đội đi tiếp
  const teamList = Object.values(teams);
  const teamNames = teamList.map((t) => t.name);

  // Lọc chỉ lấy các trận đấu Knockout
  const koMatches = matches.filter((m) => m.groupId === 'knockout');

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

  // Compute standings for qualified teams in edit mode
  const groupStandingsMap: Record<string, { standings: any[], isFinished: boolean }> = {};
  const groupNamesMap: Record<string, string> = {};

  Object.values(groups).forEach((g) => {
    const gMatchs = matches.filter((m) => m.groupId === g.id);
    const isFinished = gMatchs.length > 0 && gMatchs.every((m) => m.status === 'finished');
    if (gMatchs.length > 0) {
      const stds = calculateGroupStandings(g.id, g.teamIds, gMatchs, teams, tournament.settings);
      groupStandingsMap[g.id] = { standings: stds.ranking || stds, isFinished };
    } else {
      groupStandingsMap[g.id] = { standings: [], isFinished: false };
    }
    groupNamesMap[g.id] = g.name;
  });

  const allGroupsFinished = Object.values(groupStandingsMap).length > 0 && Object.values(groupStandingsMap).every(g => g.isFinished);
  
  const stdsOnlyMap = Object.fromEntries(Object.entries(groupStandingsMap).map(([k, v]) => [k, v.standings]));
  const calculatedBestThirds = calculateBestThirdPlaces(stdsOnlyMap as any, matches, tournament.settings, groupNamesMap);

  const sortedGroups = Object.values(groups).sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
  const firstPlaceSlots = sortedGroups.map(g => ({ key: `__1st_${g.id}`, label: `Nhất ${g.name.replace(/^Bảng\s+/i, '')}` }));
  const secondPlaceSlots = sortedGroups.map(g => ({ key: `__2nd_${g.id}`, label: `Nhì ${g.name.replace(/^Bảng\s+/i, '')}` }));
  const thirdPlaceSlots = Array.from({length: numBestThirds}).map((_, i) => ({ key: `__3rd_${i+1}`, label: `Ba XS ${i+1}` }));

  const usedParticipants = new Set<string>();
  koMatches.forEach(m => {
    if (m.teamAId) usedParticipants.add(m.teamAId);
    if (m.teamBId) usedParticipants.add(m.teamBId);
  });

  const finishedGroupTeamNames: string[] = [];
  Object.values(groups).forEach(g => {
    if (groupStandingsMap[g.id]?.isFinished) {
      finishedGroupTeamNames.push(...g.teamIds.map(tid => teams[tid]?.name));
    }
  });

  const resolveSlotName = (slotKey: string) => {
    if (!slotKey) return '';
    if (slotKey.startsWith('__1st_')) {
      const gid = slotKey.replace('__1st_', '');
      const groupInfo = groupStandingsMap[gid];
      if (groupInfo?.isFinished && groupInfo.standings[0]) {
        return groupInfo.standings[0].teamName;
      }
      return `Nhất ${groupNamesMap[gid]?.replace(/^Bảng\s+/i, '') || ''}`;
    }
    if (slotKey.startsWith('__2nd_')) {
      const gid = slotKey.replace('__2nd_', '');
      const groupInfo = groupStandingsMap[gid];
      if (groupInfo?.isFinished && groupInfo.standings[1]) {
        return groupInfo.standings[1].teamName;
      }
      return `Nhì ${groupNamesMap[gid]?.replace(/^Bảng\s+/i, '') || ''}`;
    }
    if (slotKey.startsWith('__3rd_')) {
      const rank = parseInt(slotKey.replace('__3rd_', ''), 10);
      if (allGroupsFinished && calculatedBestThirds[rank - 1]) {
        return calculatedBestThirds[rank - 1].teamName;
      }
      return `Ba XS ${rank}`;
    }
    if (teams[slotKey]) return teams[slotKey].name;
    const foundTeam = Object.values(teams).find(t => t.name === slotKey);
    if (foundTeam) return foundTeam.name;

    return getReadableTeamName(slotKey);
  };

  const handleGenerateBracket = () => {
    generateKnockoutBracket(sz);
  };

  const handleClearBracketConfirm = () => {
    clearKnockout();
    setShowClearConfirmModal(false);
  };

  // Local state for numeric inputs to avoid lags/cursor jumps and handle incomplete edits gracefully
  const [localScores, setLocalScores] = useState<Record<string, { scoreA: string; scoreB: string }>>({});

  // Sync state whenever matches change
  useEffect(() => {
    setLocalScores((prev) => {
      const nextMap = { ...prev };
      koMatches.forEach((m) => {
        const storeSA = m.scoreA !== null ? String(m.scoreA) : '';
        const storeSB = m.scoreB !== null ? String(m.scoreB) : '';

        // If the store has non-null elements, force sync
        if (m.scoreA !== null || m.scoreB !== null) {
          nextMap[m.id] = { scoreA: storeSA, scoreB: storeSB };
        } else {
          // If store is null/null, we only clear local state if the local state was also matching a non-null match before, 
          // or if we just want to align when they are both empty.
          const localSA = prev[m.id]?.scoreA || '';
          const localSB = prev[m.id]?.scoreB || '';
          if (localSA !== '' && localSB !== '') {
            // It was an external reset!
            nextMap[m.id] = { scoreA: '', scoreB: '' };
          } else {
            // User is actively typing, preserve their local scratchpad
            nextMap[m.id] = {
              scoreA: localSA,
              scoreB: localSB,
            };
          }
        }
      });
      return nextMap;
    });
  }, [matches]);

  const handleScoreInputChange = (matchId: string, team: 'A' | 'B', value: string) => {
    // Keep value clean: only digits or empty string
    const cleanVal = value.replace(/[^0-9]/g, '');

    const currentMatchLocal = localScores[matchId] || { scoreA: '', scoreB: '' };
    const updatedMatch = {
      ...currentMatchLocal,
      [team === 'A' ? 'scoreA' : 'scoreB']: cleanVal,
    };

    // Update local scratchpad state instantly
    setLocalScores((prev) => ({
      ...prev,
      [matchId]: updatedMatch,
    }));

    const scoreAStr = updatedMatch.scoreA;
    const scoreBStr = updatedMatch.scoreB;

    // Realtime auto-save & auto-calculate knockout winner / deuces
    if (scoreAStr !== '' && scoreBStr !== '') {
      const numA = Number(scoreAStr);
      const numB = Number(scoreBStr);

      if (numA !== numB) {
        updateKnockoutScore(matchId, numA, numB);
      } else {
        // Reset progression when scores are equalized
        updateKnockoutScore(matchId, null, null);
      }
    } else {
      // If either score is cleared, reset match score to pending
      const currentMatchInStore = matches.find((m) => m.id === matchId);
      if (
        currentMatchInStore &&
        (currentMatchInStore.scoreA !== null || currentMatchInStore.scoreB !== null)
      ) {
        updateKnockoutScore(matchId, null, null);
      }
    }
  };

  return (
    <div className="space-y-8" id="knockout-bracket-view">

      {!isAdmin && (
        <div className="bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 text-amber-800 dark:text-amber-400 text-xs p-3.5 rounded-xl flex items-start gap-2.5 shadow-xs transition-all duration-300 animate-pulse">
          <AlertTriangle size={16} className="text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5 animate-none">
            <p className="font-extrabold text-sm flex items-center gap-1.5">Trạng thái: Chỉ Xem (Khách vãng lai)</p>
            <p className="text-[11px] font-semibold opacity-90">Hãy nhấp vào nút <strong>🔒 Đăng nhập Admin</strong> ở góc trên bên phải để bắt đầu thiết lập sơ đồ trực tiếp, xóa nhánh hoặc nhập điểm số đấu loại loại trực tiếp.</p>
          </div>
        </div>
      )}
      
      {/* Thẻ điều khiển lập nhánh (To Rõ, Đầy Đủ Chức Năng) */}
      <div className="bg-white dark:bg-zinc-900 p-7 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-md">
        <div className="space-y-1">
          <h3 className="text-xl font-extrabold text-[#111c30] dark:text-zinc-100 flex items-center gap-2 uppercase tracking-tight">
            <Trophy size={22} className="text-amber-500 stroke-[2.5]" />
            Sơ Đồ Nhánh Knockout Loại Trực Tiếp
          </h3>
          <p className="text-xs text-zinc-400 font-semibold">
            Tình huống khi đổi điểm số sẽ tự động đồng bộ đẩy đội thắng vào vòng tiếp theo.
          </p>
        </div>

        {koMatches.length === 0 ? (
          <div className="flex items-center gap-4 shrink-0">
            <select
              value={sz}
              onChange={(e) => setSz(Number(e.target.value) as 4 | 8 | 16 | 32)}
              disabled={!isAdmin}
              className="px-4 py-2.5 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-black text-zinc-800 dark:text-zinc-100 bg-zinc-55 dark:bg-zinc-950 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value={4}>Nhánh 4 đội (Bán Kết - 2 bảng)</option>
              <option value={8}>Nhánh 8 đội (Tứ Kết)</option>
              <option value={16}>Nhánh 16 đội (Vòng 1/8)</option>
              <option value={32}>Nhánh 32 đội (Vòng 1/16)</option>
            </select>
            <button
              onClick={handleGenerateBracket}
              disabled={!isAdmin}
              className="px-5 py-3 hover:bg-blue-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 bg-blue-600 text-white font-black rounded-xl text-xs transition-all flex items-center gap-2 shadow-md uppercase tracking-wider cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              id="btn-generate-knockout"
            >
              <PlayCircle size={16} /> Khởi tạo sơ đồ nhánh
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {!isEditMode && (
              <button
                onClick={() => setIsEditMode(true)}
                disabled={!isAdmin}
                className="px-5 py-3 text-xs font-black bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-xl cursor-pointer border border-zinc-250 dark:border-zinc-700 transition-colors uppercase tracking-wider shadow-xs disabled:opacity-50"
              >
                Sửa Tên Các Đội Vào Nhánh
              </button>
            )}
            <button
              onClick={() => setShowClearConfirmModal(true)}
              disabled={!isAdmin || isEditMode}
              className="px-5 py-3 text-xs font-black bg-red-50 hover:bg-red-100 dark:bg-red-955/40 text-red-650 dark:text-red-400 rounded-xl cursor-pointer border border-red-250 transition-colors uppercase tracking-wider shadow-xs disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-55"
              id="btn-delete-knockout"
            >
              Hủy & Tạo Lại Sơ Đồ
            </button>
          </div>
        )}
      </div>

      {koMatches.length === 0 ? (
        <div className="py-24 text-center text-zinc-400 bg-white dark:bg-zinc-900 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl space-y-4 shadow-inner">
          <Trophy size={54} className="mx-auto text-zinc-300 dark:text-zinc-700 animate-bounce" />
          <p className="font-extrabold text-zinc-700 dark:text-zinc-300 text-lg">Sơ đồ đấu loại trực tiếp (Cúp vàng) chưa được lập.</p>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto font-semibold">Nhấn nút "Khởi tạo sơ đồ nhánh" ở trên để hệ thống tự động bốc thăm xếp lịch đấu loại trực tiếp.</p>
        </div>
      ) : (
        <div className={isEditMode ? "fixed inset-0 z-[100] bg-zinc-50 dark:bg-zinc-950 flex flex-row w-screen h-screen overflow-hidden" : "space-y-8"}>
          
          {isEditMode && (
            <div className="w-80 shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 p-5 flex flex-col h-full shadow-2xl z-50 overflow-y-auto">
              {/* Header */}
              <div className="flex flex-col gap-4 mb-6">
                <div className="flex justify-between items-center">
                  <h3 className="font-extrabold text-zinc-900 dark:text-zinc-100 text-sm uppercase tracking-wider">Đội Kéo-Thả</h3>
                  <button 
                    onClick={() => setIsEditMode(false)}
                    className="px-4 py-2 text-xs font-black bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-transform hover:scale-105 cursor-pointer shadow-md"
                  >
                    XONG
                  </button>
                </div>
                
                <div className="flex flex-col gap-2 p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-inner">
                  <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Số suất Hạng 3</span>
                  <input 
                    type="number" 
                    min="0" max="16" 
                    className="w-full px-3 py-2 text-sm font-bold border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    value={numBestThirds} 
                    onChange={(e) => setNumBestThirds(Number(e.target.value) || 0)} 
                  />
                </div>
              </div>

              {/* Lists */}
              <div className="flex-1 space-y-6">
                {/* Nhất Bảng */}
                <div className="space-y-3">
                  <div className="text-[11px] font-black uppercase text-amber-600 bg-amber-50 dark:bg-amber-950/40 text-center py-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 shadow-sm">Nhóm Nhất Bảng</div>
                  <div className="flex flex-col gap-2">
                    {firstPlaceSlots.filter(s => !usedParticipants.has(s.key)).map((slot) => (
                      <div 
                        key={slot.key}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', slot.key)}
                        className="px-4 py-3 bg-white dark:bg-zinc-800 rounded-xl text-xs font-bold cursor-move border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 hover:shadow-md hover:-translate-y-0.5 transition-all text-center"
                      >
                        {slot.label}
                      </div>
                    ))}
                    {firstPlaceSlots.filter(s => !usedParticipants.has(s.key)).length === 0 && <div className="text-xs text-zinc-400 text-center py-4 italic font-medium bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">Hết / Đã xếp xong</div>}
                  </div>
                </div>
                
                {/* Nhì Bảng */}
                <div className="space-y-3">
                  <div className="text-[11px] font-black uppercase text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/80 text-center py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">Nhóm Nhì Bảng</div>
                  <div className="flex flex-col gap-2">
                    {secondPlaceSlots.filter(s => !usedParticipants.has(s.key)).map((slot) => (
                      <div 
                        key={slot.key}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', slot.key)}
                        className="px-4 py-3 bg-white dark:bg-zinc-800 rounded-xl text-xs font-bold cursor-move border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 hover:shadow-md hover:-translate-y-0.5 transition-all text-center"
                      >
                        {slot.label}
                      </div>
                    ))}
                    {secondPlaceSlots.filter(s => !usedParticipants.has(s.key)).length === 0 && <div className="text-xs text-zinc-400 text-center py-4 italic font-medium bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">Hết / Đã xếp xong</div>}
                  </div>
                </div>

                {/* Ba Xuất Sắc */}
                <div className="space-y-3">
                  <div className="text-[11px] font-black uppercase text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-center py-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900/50 shadow-sm">Nhóm Ba Xuất Sắc</div>
                  <div className="flex flex-col gap-2">
                    {thirdPlaceSlots.filter(s => !usedParticipants.has(s.key)).map((slot) => (
                      <div 
                        key={slot.key}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', slot.key)}
                        className="px-4 py-3 bg-white dark:bg-zinc-800 rounded-xl text-xs font-bold cursor-move border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 hover:shadow-md hover:-translate-y-0.5 transition-all text-center"
                      >
                        {slot.label}
                      </div>
                    ))}
                    {thirdPlaceSlots.filter(s => !usedParticipants.has(s.key)).length === 0 && <div className="text-xs text-zinc-400 text-center py-4 italic font-medium bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">Hết / Đã xếp xong</div>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Bracket Tree Layout bằng CSS Flexbox Columns nối tiếp */}
          <div className={isEditMode ? "flex-1 h-full relative" : "relative bg-white dark:bg-zinc-900 rounded-3xl border border-solid border-zinc-200 dark:border-zinc-805 shadow-md overflow-hidden min-h-[700px] mt-4"} style={!isEditMode ? { borderStyle: 'solid' } : undefined} id="bracket-view-wrapper">
            <TransformWrapper
              initialScale={1}
              minScale={0.3}
              maxScale={2}
              centerOnInit={false}
              wheel={{ step: 0.1 }}
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
                  <TransformComponent wrapperClass="w-full h-full" wrapperStyle={{ width: '100%', height: isEditMode ? '100%' : '700px' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: '32px' }}>
                    <div className="flex gap-10 min-w-[900px] justify-between items-center relative py-10" style={{ marginTop: '-30px' }}>
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
                    <div className="flex flex-col justify-around gap-6 h-[600px] relative">
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
                              {/* Hàng Đội A (Hạt giống / Cho phép lựa chọn qua dropdown select) */}
                              <div className="flex items-center justify-between gap-3" style={(m.id === 'ko-QF1-ww7imxn' || m.id === 'ko-QF2-3f2hlbu') ? { marginBottom: '0px' } : undefined}>
                                <div className="flex items-center gap-1.5 truncate max-w-[210px] sm:max-w-[250px]">
                                  {!isFinished && m.round === 1 ? (
                                    isEditMode ? (
                                      <div
                                        onDragOver={(e) => { e.preventDefault(); }}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          const teamId = e.dataTransfer.getData('text/plain');
                                          if (teamId) updateKnockoutParticipant(m.id, 'A', teamId);
                                        }}
                                        className="font-black flex items-center justify-between rounded-lg border-2 border-dashed border-zinc-400 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-xs min-w-[200px]"
                                      >
                                        <span className="px-2 py-1.5">{m.teamAId ? resolveSlotName(m.teamAId) : 'Thả đội vào đây'}</span>
                                        {m.teamAId && (
                                          <button 
                                            title="Xoá khỏi nhánh"
                                            onClick={() => updateKnockoutParticipant(m.id, 'A', '')} 
                                            className="px-2 py-1.5 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-r-lg"
                                          >
                                            ✕
                                          </button>
                                        )}
                                      </div>
                                    ) : (
                                      <select
                                        value={m.teamAId || ''}
                                        onChange={(e) => updateKnockoutParticipant(m.id, 'A', e.target.value)}
                                        disabled={!isAdmin}
                                        className="px-2 py-1.5 font-black rounded-lg border border-zinc-250 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-xs focus:ring-1 focus:ring-blue-500 max-w-[190px] sm:max-w-[230px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                        style={m.id === 'ko-QF1-ww7imxn' ? { width: '300px', maxWidth: 'none' } : undefined}
                                      >
                                        {/* Thêm option placeholder nếu chưa nằm trong list đội giải */}
                                        {!teamNames.includes(m.teamAId) && (
                                          <option value={m.teamAId || ''}>{resolveSlotName(m.teamAId)}</option>
                                        )}
                                        {teamList.filter(t => finishedGroupTeamNames.includes(t.name) || m.teamAId === t.name).map((t) => (
                                          <option key={t.id} value={t.name}>
                                            {t.name}
                                          </option>
                                        ))}
                                      </select>
                                    )
                                  ) : (
                                    <span 
                                      className={`font-black text-xs sm:text-sm truncate block max-w-[190px] sm:max-w-[230px] ${
                                        isFinished && m.winnerId === m.teamAId 
                                          ? 'text-blue-600 dark:text-blue-400 underline decoration-2' 
                                          : 'text-zinc-800 dark:text-zinc-200'
                                      }`}
                                      title={resolveSlotName(m.teamAId)}
                                    >
                                      {resolveSlotName(m.teamAId)}
                                    </span>
                                  )}
                                </div>
                                
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  placeholder=""
                                  value={localScores[m.id]?.scoreA ?? ''}
                                  onChange={(e) => handleScoreInputChange(m.id, 'A', e.target.value)}
                                  disabled={!isAdmin}
                                  className="w-12 h-9 border border-zinc-250 dark:border-zinc-800 rounded-xl text-center font-bold text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                  id={`input-ko-match-${m.id}-scoreA`}
                                />
                              </div>

                              {/* Hàng Đội B */}
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-1.5 truncate max-w-[210px] sm:max-w-[250px]">
                                  {!isFinished && m.round === 1 ? (
                                    isEditMode ? (
                                      <div
                                        onDragOver={(e) => { e.preventDefault(); }}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          const teamId = e.dataTransfer.getData('text/plain');
                                          if (teamId) updateKnockoutParticipant(m.id, 'B', teamId);
                                        }}
                                        className="font-black flex items-center justify-between rounded-lg border-2 border-dashed border-zinc-400 bg-white dark:bg-zinc-900 text-[#111c30] dark:text-zinc-105 text-xs min-w-[200px]"
                                      >
                                        <span className="px-2 py-1.5">{m.teamBId ? resolveSlotName(m.teamBId) : 'Thả đội vào đây'}</span>
                                        {m.teamBId && (
                                          <button 
                                            title="Xoá khỏi nhánh"
                                            onClick={() => updateKnockoutParticipant(m.id, 'B', '')} 
                                            className="px-2 py-1.5 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-r-lg"
                                          >
                                            ✕
                                          </button>
                                        )}
                                      </div>
                                    ) : (
                                      <select
                                        value={m.teamBId || ''}
                                        onChange={(e) => updateKnockoutParticipant(m.id, 'B', e.target.value)}
                                        disabled={!isAdmin}
                                        className="px-2 py-1.5 font-black rounded-lg border border-zinc-250 bg-white dark:bg-zinc-900 text-[#111c30] dark:text-zinc-105 text-xs focus:ring-1 focus:ring-blue-500 max-w-[190px] sm:max-w-[230px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                        style={m.id === 'ko-QF1-ww7imxn' ? { width: '300px', maxWidth: 'none' } : undefined}
                                      >
                                        {!teamNames.includes(m.teamBId) && (
                                          <option value={m.teamBId || ''}>{resolveSlotName(m.teamBId)}</option>
                                        )}
                                        {teamList.filter(t => finishedGroupTeamNames.includes(t.name) || m.teamBId === t.name).map((t) => (
                                          <option key={t.id} value={t.name}>
                                            {t.name}
                                          </option>
                                        ))}
                                      </select>
                                    )
                                  ) : (
                                    <span 
                                      className={`font-black text-xs sm:text-sm truncate block max-w-[190px] sm:max-w-[230px] ${
                                        isFinished && m.winnerId === m.teamBId 
                                          ? 'text-blue-600 dark:text-blue-400 underline decoration-2' 
                                          : 'text-zinc-800 dark:text-zinc-200'
                                      }`}
                                      title={resolveSlotName(m.teamBId)}
                                    >
                                      {resolveSlotName(m.teamBId)}
                                    </span>
                                  )}
                                </div>

                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  placeholder=""
                                  value={localScores[m.id]?.scoreB ?? ''}
                                  onChange={(e) => handleScoreInputChange(m.id, 'B', e.target.value)}
                                  disabled={!isAdmin}
                                  className="w-12 h-9 border border-zinc-250 dark:border-zinc-800 rounded-xl text-center font-bold text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                  id={`input-ko-match-${m.id}-scoreB`}
                                />
                              </div>
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
                className="px-6 py-2.5 text-xs font-bold text-white bg-red-650 hover:bg-red-600 rounded-xl shadow-md cursor-pointer uppercase tracking-wider"
                id="btn-confirm-clear-bracket"
              >
                Xóa sơ đồ nhánh cũ
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
