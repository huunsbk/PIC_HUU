/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import ExcelJS from 'exceljs';
import { useTournamentStore } from '../store';
import { calculateGroupStandings, balanceMatchesRestTime } from '../utils/tournamentEngine';
import { supabase } from '../supabaseClient';
import { 
  Printer, 
  RefreshCw, 
  RotateCcw, 
  Check, 
  AlertTriangle, 
  ListTodo, 
  Award,
  Sparkles,
  ChevronRight,
  FileSpreadsheet
} from 'lucide-react';

export default function SchedulerAndScoreKeeper() {
  const {
    teams,
    groups,
    matches,
    tournament,
    generateMatchesForGroup,
    generateAllSchedules,
    updateMatchScore,
    resetMatchScore,
    activeGroupId,
    setActiveGroupId,
    addLog,
    events,
    currentEventId,
    isAdmin,
  } = useTournamentStore();

  const groupList = Object.values(groups);
  const activeGroup = activeGroupId ? groups[activeGroupId] : groupList[0];

  // Set default active group on mount if not set
  useEffect(() => {
    if (groupList.length > 0 && !activeGroupId) {
      setActiveGroupId(groupList[0].id);
    }
  }, [groupList, activeGroupId, setActiveGroupId]);

  // Local state for numeric inputs to avoid lags / cursor jumps and handle incomplete edits gracefully
  const [localScores, setLocalScores] = useState<Record<string, { scoreA: string; scoreB: string }>>({});

  // Confirmations dialogs
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [showResetScoresConfirm, setShowResetScoresConfirm] = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);

  // Sync state whenever activeGroup or score values change
  useEffect(() => {
    if (!activeGroup) return;
    const groupMatches = matches.filter((m) => m.groupId === activeGroup.id);
    const scoresMap: Record<string, { scoreA: string; scoreB: string }> = {};
    
    groupMatches.forEach((m) => {
      scoresMap[m.id] = {
        scoreA: m.scoreA !== null ? String(m.scoreA) : '',
        scoreB: m.scoreB !== null ? String(m.scoreB) : '',
      };
    });
    setLocalScores(scoresMap);
  }, [activeGroupId, matches]); // Sync when active table changes or background matches update

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

    // Realtime auto-save & auto-calculate standings
    if (scoreAStr !== '' && scoreBStr !== '') {
      const numA = Number(scoreAStr);
      const numB = Number(scoreBStr);
      updateMatchScore(matchId, numA, numB);
    } else {
      // Only reset/clears the match score if there's an actual score populated in the store
      const currentMatchInStore = matches.find((m) => m.id === matchId);
      if (
        currentMatchInStore &&
        (currentMatchInStore.scoreA !== null || currentMatchInStore.scoreB !== null)
      ) {
        updateMatchScore(matchId, null, null);
      }
    }
  };

  // Perform whole group regeneration via Store Action
  const handleRegenSubmit = async () => {
    if (!activeGroup) return;
    
    setRegenLoading(true);
    try {
      generateMatchesForGroup(activeGroup.id);
      addLog('Thiết Lập Lịch', `Tái tạo toàn bộ lịch đấu cho bảng [${activeGroup.name}] thành công.`);
    } catch (err: any) {
      console.error(err);
      try {
        alert(`Gặp vấn đề khi tạo lịch đấu: ${err.message || err}`);
      } catch (ae) {}
    } finally {
      setRegenLoading(false);
      setShowRegenConfirm(false);
    }
  };

  // Reset scores for active group matches only
  const handleResetScoresSubmit = () => {
    if (!activeGroup) return;
    const groupMatches = matches.filter((m) => m.groupId === activeGroup.id);
    groupMatches.forEach((m) => {
      resetMatchScore(m.id);
    });

    // Clear local text inputs
    setLocalScores((prev) => {
      const next = { ...prev };
      groupMatches.forEach((m) => {
        next[m.id] = { scoreA: '', scoreB: '' };
      });
      return next;
    });

    setShowResetScoresConfirm(false);
    addLog('Đặt Lại Điểm', `Đã đặt toàn bộ tỉ số và điểm số bảng [${activeGroup.name}] về rỗng.`);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportExcel = async () => {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Lịch thi đấu & Kết quả');

      // Bật hiển thị lưới trong Excel
      worksheet.views = [{ showGridLines: true }];

      // Định nghĩa kích thước các cột dữ liệu
      worksheet.columns = [
        { key: 'stt', width: 8 },
        { key: 'groupOrStage', width: 22 },
        { key: 'roundOrMatch', width: 20 },
        { key: 'teamA', width: 35 },
        { key: 'score', width: 18 },
        { key: 'teamB', width: 35 },
        { key: 'status', width: 20 }
      ];

      const currentEventName = events[currentEventId]?.name || 'Nội dung đấu';
      const tournamentName = tournament.name || 'GIẢI PICKLEBALL ĐÔI NAM TOÀN TỈNH';

      // 1. Dòng Tiêu đề: in đậm, cỡ chữ 16, căn giữa
      worksheet.mergeCells('A1:G1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = `LỊCH THI ĐẤU VÀ KẾT QUẢ - ${String(currentEventName).toUpperCase()}`;
      titleCell.font = { name: 'Times New Roman', size: 16, bold: true };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(1).height = 40;

      // Dòng phụ đề
      worksheet.mergeCells('A2:G2');
      const subtitleCell = worksheet.getCell('A2');
      subtitleCell.value = `${tournamentName} | Địa điểm: ${tournament.location || 'Sân vận động'} | Ngày: ${tournament.date || ''}`;
      subtitleCell.font = { name: 'Times New Roman', size: 12, italic: true };
      subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(2).height = 25;

      // Dòng trống
      worksheet.addRow([]);
      worksheet.getRow(3).height = 15;

      // 2. Dòng Đầu Bảng (Headers): Cỡ chữ 14, in đậm, căn giữa
      const headerRow = worksheet.addRow([
        'STT', 
        'Nội dung / Bảng', 
        'Vòng đấu', 
        'Đội thứ nhất (A)', 
        'Tỷ số', 
        'Đội thứ hai (B)', 
        'Trạng thái'
      ]);
      worksheet.getRow(4).height = 30;

      headerRow.eachCell((cell) => {
        cell.font = { name: 'Times New Roman', size: 14, bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE6F0FA' } // Nền xanh nhạt thanh lịch
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'medium' },
          right: { style: 'thin' }
        };
      });

      // 3. Chuẩn bị danh sách Trận đấu để xuất
      const allMatches = [...matches];
      const groupStageMatches = allMatches.filter(m => m.groupId !== 'knockout');
      const knockoutStageMatches = allMatches.filter(m => m.groupId === 'knockout');

      // Sắp xếp vòng bảng tối ưu khoảng nghỉ (trận 1 bảng A, trận 1 bảng B, trận 1 bảng C...)
      const balancedGroupMatches = balanceMatchesRestTime(groupStageMatches);

      const exportList = [...balancedGroupMatches, ...knockoutStageMatches];

      if (exportList.length === 0) {
        worksheet.mergeCells('A5:G5');
        const emptyCell = worksheet.getCell('A5');
        emptyCell.value = 'Chưa có lịch thi đấu được thiết lập';
        emptyCell.font = { name: 'Times New Roman', size: 14 };
        emptyCell.alignment = { horizontal: 'center', vertical: 'middle' };
        emptyCell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        worksheet.getRow(5).height = 30;
      } else {
        exportList.forEach((m, idx) => {
          const teamAName = teams[m.teamAId]?.name || m.teamAId || 'Trống';
          const teamBName = teams[m.teamBId]?.name || m.teamBId || 'Trống';
          
          let boardName = 'Vòng loại trực tiếp';
          if (m.groupId !== 'knockout') {
            const gName = groups[m.groupId]?.name || `Bảng ${m.groupId}`;
            boardName = gName;
          }

          let roundText = '';
          if (m.groupId !== 'knockout') {
            roundText = `Vòng ${m.round}`;
          } else {
            roundText = m.knockoutRoundName || 'Vòng trực tiếp';
            if (m.knockoutMatchId) {
              roundText += ` (${m.knockoutMatchId})`;
            }
          }

          const scoreA = m.scoreA !== null ? m.scoreA : '-';
          const scoreB = m.scoreB !== null ? m.scoreB : '-';
          const scoreText = m.status === 'finished' ? `${scoreA} - ${scoreB}` : 'Chưa đấu';

          let statusText = 'Lên lịch';
          if (m.status === 'finished') {
            statusText = scoreA > scoreB ? 'A thắng' : scoreB > scoreA ? 'B thắng' : 'Hòa';
          }

          const dataRow = worksheet.addRow([
            idx + 1,
            boardName,
            roundText,
            teamAName,
            scoreText,
            teamBName,
            statusText
          ]);

          worksheet.getRow(worksheet.lastRow!.number).height = 28;

          // 4. Định dạng ô nội dung: Cỡ chữ thường 14, căn giữa, kẻ khung
          dataRow.eachCell((cell) => {
            cell.font = { name: 'Times New Roman', size: 14 };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
          });
        });
      }

      // Tạo tệp nhị phân và kích hoạt tải về trên trình duyệt
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const sanitizedEventName = currentEventName.trim().toLowerCase()
        .replace(/[^a-z0-9]/gi, '_')
        .replace(/_+/g, '_');
      link.download = `lich_thi_dau_${sanitizedEventName}_${Date.now()}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);

      addLog('Xuất Excel', `Đã xuất lịch thi đấu & kết quả nội dung [${currentEventName}] thành công ra tệp Excel.`);
    } catch (error) {
      console.error('Lỗi khi xuất tệp Excel:', error);
    }
  };

  // Standings calculation for the right column table
  const groupMatches = activeGroup ? matches.filter((m) => m.groupId === activeGroup.id) : [];
  const standings = activeGroup
    ? calculateGroupStandings(activeGroup.id, activeGroup.teamIds, groupMatches, teams, tournament.settings)
    : [];

  // Group matches sorted by round
  const roundsMap: Record<number, typeof groupMatches> = {};
  groupMatches.forEach((m) => {
    if (!roundsMap[m.round]) {
      roundsMap[m.round] = [];
    }
    roundsMap[m.round].push(m);
  });

  const roundNumbers = Object.keys(roundsMap)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div className="space-y-6" id="scheduler-and-scorekeeper-unified">

      {!isAdmin && (
        <div className="bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/20 text-amber-800 dark:text-amber-400 text-xs p-3.5 rounded-xl flex items-start gap-2.5 shadow-xs transition-all duration-300 animate-pulse">
          <AlertTriangle size={16} className="text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-extrabold text-sm flex items-center gap-1.5">Trạng thái: Chỉ Xem (Khách vãng lai)</p>
            <p className="text-[11px] font-semibold opacity-90">Hãy đăng nhập quyền <strong>🔒 Đăng nhập Admin</strong> ở góc trên bên phải để bắt đầu xếp lịch thi đấu toàn giải, nhập tỉ số, cập nhật điểm hoặc đặt lại kết quả bảng tròn.</p>
          </div>
        </div>
      )}
      
      {/* HEADER SECTION: "Lịch & Kết quả" & "In dữ liệu / PDF" */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 print:hidden" id="match-scoring-header-main">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            Lịch & Kết quả
          </h2>
          <p className="text-xs text-zinc-500 font-medium mt-0.5">
            Nhập kết quả trực tiếp tại ô điểm số. Hệ thống sẽ tự động lưu và cập nhật bảng xếp hạng trong tức khắc.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleExportExcel}
            className="px-4.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 hover:scale-[1.01] active:scale-95 text-white font-extrabold rounded-xl text-xs flex items-center gap-2 shadow-md cursor-pointer transition-all uppercase tracking-wider"
            id="btn-export-excel-schedules"
          >
            <FileSpreadsheet size={15} />
            <span>Xuất Excel Lịch & Kết quả</span>
          </button>
          <button
            onClick={handlePrint}
            className="px-4.5 py-2.5 bg-white hover:bg-zinc-55 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 font-extrabold rounded-xl text-xs flex items-center gap-2 shadow-sm border border-zinc-200 dark:border-zinc-800 cursor-pointer transition-all"
            id="btn-print-pdf-main"
          >
            <Printer size={15} />
            <span>In dữ liệu / PDF</span>
          </button>
        </div>
      </div>

      {/* TABS ROW AND REGEN BUTTON */}
      {groupList.length > 0 && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-px print:hidden" id="match-scoring-tabs-container">
          {/* Main Select Tabs */}
          <div className="flex flex-wrap gap-1">
            {groupList.map((g) => {
              const isActive = activeGroup?.id === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => setActiveGroupId(g.id)}
                  className={`px-5 py-4 text-sm font-bold border-b-2 cursor-pointer transition-all uppercase tracking-wide flex items-center gap-2 ${
                    isActive
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-extrabold'
                      : 'border-transparent text-zinc-550 dark:text-zinc-450 hover:text-zinc-800 dark:hover:text-zinc-200 hover:border-zinc-300'
                  }`}
                  id={`btn-group-tab-select-${g.id}`}
                >
                  <span>{g.name}</span>
                </button>
              );
            })}
          </div>

          {/* Regenerate schedule buttons on the right */}
          <div className="pb-2 md:pb-0 flex flex-wrap gap-2">
            <button
              onClick={() => {
                generateAllSchedules();
                addLog('Lập Lịch', 'Khởi tạo nhanh lịch đấu toàn giải cho tất cả các bảng và nội dung.');
              }}
              disabled={!isAdmin}
              className="px-4.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-xl text-xs flex items-center gap-2 cursor-pointer transition-all shadow-md uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-emerald-600"
              id="btn-quick-schedule-all"
            >
              <Sparkles size={14} />
              <span>Khởi tạo nhanh lịch toàn giải</span>
            </button>
            <button
              onClick={() => setShowRegenConfirm(true)}
              disabled={!isAdmin}
              className="px-4.5 py-2.5 bg-white hover:bg-zinc-55 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 font-bold rounded-xl text-xs flex items-center gap-2 border border-zinc-250 dark:border-zinc-800 cursor-pointer transition-all shadow-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
              id="btn-trigger-regen-schedule"
            >
              <RefreshCw size={14} className="text-zinc-500" />
              <span>Khởi tạo lại lịch bảng này</span>
            </button>
          </div>
        </div>
      )}

      {/* CHECK EMPTY GROUP STATE */}
      {groupList.length === 0 ? (
        <div className="py-24 text-center text-zinc-400 text-sm bg-white dark:bg-zinc-900 rounded-3xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 space-y-4 shadow-sm">
          <ListTodo size={52} className="mx-auto text-zinc-300 dark:text-zinc-700 animate-pulse" />
          <p className="font-extrabold text-zinc-750 dark:text-zinc-350 text-base">HỆ THỐNG CHƯA ĐƯỢC CHIA BẢNG</p>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto font-semibold">Vui lòng chuyển qua tab "Chia bảng" để thiết lập bảng đấu xếp hạng trước khi phân bổ lịch thi đấu.</p>
        </div>
      ) : !activeGroup ? (
        <div className="text-center text-zinc-500 font-bold py-10">Vui lòng lựa chọn một bảng đấu để bắt đầu.</div>
      ) : (
        /* TWO COLUMNS WORKSPACE */
        <div className="grid grid-cols-12 gap-8 items-start">
          
          {/* COLUMN 1: MATCH CARDS LIST (COL-SPAN 12, LG 7) */}
          <div className="col-span-12 lg:col-span-7 space-y-5" id="group-matches-scoring-column">
            
            {/* Header Column Block */}
            <div className="flex items-center justify-between pb-2" id="group-matches-column-bar">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-4.5 bg-blue-600 rounded-full"></span>
                <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wide flex items-center gap-1.5">
                  <ListTodo size={16} className="text-blue-600" />
                  Danh sách lượt đấu ({activeGroup.name})
                </span>
              </div>
              
              <button
                onClick={() => setShowResetScoresConfirm(true)}
                disabled={!isAdmin}
                className="px-3.5 py-1.5 text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-955/30 border border-blue-200/50 dark:border-blue-900/40 rounded-lg cursor-pointer transition-colors disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                id="btn-reset-current-group-scores"
              >
                Đặt lại điểm bảng này
              </button>
            </div>

            {/* List Round-by-Round or direct matches list */}
            {groupMatches.length === 0 ? (
              <div className="py-20 text-center text-zinc-400 bg-white dark:bg-zinc-900 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800 space-y-4 shadow-sm">
                <Sparkles size={48} className="mx-auto text-zinc-300 dark:text-zinc-700 block" />
                <p className="font-extrabold text-zinc-750 dark:text-zinc-300">CHƯA KHỞI TẠO LỊCH THI ĐẤU</p>
                <p className="text-xs text-zinc-500 font-medium max-w-xs mx-auto">Nhấp vào nút để tự động thiết lập trận đấu vòng tròn cho {activeGroup.name} ngay lập tức.</p>
                <button
                  onClick={handleRegenSubmit}
                  disabled={!isAdmin}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs cursor-pointer shadow-sm uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Nhấp Tạo Lịch Ngay!
                </button>
              </div>
            ) : (
              <div className="space-y-4" id="scoring-board-rounds-list">
                {roundNumbers.map((roundNum) => {
                  const roundMatches = roundsMap[roundNum];

                  return (
                    <div key={roundNum} className="space-y-3" id={`scoring-round-section-${roundNum}`}>
                      <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest pl-1" style={{ color: '#d72488' }}>
                        Vòng {roundNum}
                      </h4>

                      <div className="space-y-1.5">
                        {roundMatches.map((match) => {
                          const teamA = teams[match.teamAId];
                          const teamB = teams[match.teamBId];

                          const scoreAVal = localScores[match.id]?.scoreA ?? '';
                          const scoreBVal = localScores[match.id]?.scoreB ?? '';

                          const isFinished = match.status === 'finished';

                          return (
                            <div
                              key={match.id}
                              className={`bg-white dark:bg-zinc-900 px-3 py-2 rounded-2xl border transition-all ${
                                isFinished
                                  ? 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300'
                                  : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300'
                              }`}
                              style={{
                                borderRadius: '16px',
                                width: '100%',
                                maxWidth: '607.25px',
                              }}
                              id={`score-card-match-${match.id}`}
                            >
                              <div className="flex items-center justify-between gap-4 w-full">
                                
                                {/* TEAM A (LEFT SIDE - Text aligned to the right) */}
                                <div className="flex-1 text-right min-w-0 pr-4">
                                  <span 
                                    className={`text-sm font-semibold block truncate ${
                                      isFinished && match.winnerId === match.teamAId
                                        ? 'text-blue-600 dark:text-blue-400 font-bold'
                                        : 'text-zinc-700 dark:text-zinc-200'
                                    }`}
                                    style={{ color: '#0b22ff' }}
                                    title={teamA ? teamA.name : `Đội đã xóa (${match.teamAId})`}
                                  >
                                    {teamA ? teamA.name : `Đội đã xóa`}
                                  </span>
                                </div>

                                {/* CENTER CONTROL: INPUT A - HYPHEN - INPUT B */}
                                <div className="flex items-center gap-2 h-8 shrink-0">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    placeholder=""
                                    value={scoreAVal}
                                    onChange={(e) => handleScoreInputChange(match.id, 'A', e.target.value)}
                                    disabled={!isAdmin}
                                    className="w-13 h-8 border border-zinc-250 dark:border-zinc-800 rounded-lg text-center font-bold text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
                                    id={`input-match-${match.id}-scoreA`}
                                  />
                                  
                                  <span className="text-zinc-300 dark:text-zinc-700 select-none font-bold text-xs">
                                    -
                                  </span>
                                  
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    placeholder=""
                                    value={scoreBVal}
                                    onChange={(e) => handleScoreInputChange(match.id, 'B', e.target.value)}
                                    disabled={!isAdmin}
                                    className="w-13 h-8 border border-zinc-250 dark:border-zinc-800 rounded-lg text-center font-bold text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
                                    id={`input-match-${match.id}-scoreB`}
                                  />
                                </div>

                                {/* TEAM B (RIGHT SIDE - Text aligned to the left) */}
                                <div className="flex-1 text-left min-w-0 pl-4">
                                  <span 
                                    className={`text-sm font-semibold block truncate ${
                                      isFinished && match.winnerId === match.teamBId
                                        ? 'text-blue-600 dark:text-blue-400 font-bold'
                                        : 'text-zinc-700 dark:text-zinc-200'
                                    }`}
                                    title={teamB ? teamB.name : `Đội đã xóa (${match.teamBId})`}
                                  >
                                    {teamB ? teamB.name : `Đội đã xóa`}
                                  </span>
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
            )}

          </div>

          {/* COLUMN 2: STANDINGS TABLE (COL-SPAN 12, LG 5) */}
          <div className="col-span-12 lg:col-span-5" id="group-standings-card-column">
            
            {/* Table Board Container */}
            <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-805 overflow-hidden shadow-sm" id="standings-box-wrapper">
              
              {/* Header Bar - Solid Blue color exactly like the screenshot */}
              <div className="bg-blue-600 text-white p-4 flex items-center justify-between" id="standings-box-header">
                <span className="text-sm font-extrabold flex items-center gap-2 tracking-tight uppercase">
                  <Award size={17} />
                  Bảng xếp hạng hiện tại - {activeGroup.name}
                </span>
                
                <span className="text-[10px] font-bold bg-white/20 px-2.5 py-1 rounded-full border border-white/20 select-none">
                  Bảng {activeGroup.teamIds.length} đội
                </span>
              </div>

              {/* Table Data Content */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 font-bold">
                      <th className="py-3 px-3 text-center w-12 font-bold">Hạng</th>
                      <th className="py-3 px-3 text-left font-bold">Đội tuyển</th>
                      <th className="py-3 px-2.5 text-center font-bold">Trận</th>
                      <th className="py-3 px-2.5 text-center text-emerald-600 dark:text-emerald-450 font-bold">T</th>
                      <th className="py-3 px-2.5 text-center text-red-500 font-bold">B</th>
                      <th className="py-3 px-2.5 text-center text-zinc-500 font-bold">H/S</th>
                      <th className="py-3 px-3 text-center text-blue-600 dark:text-blue-400 font-bold">Điểm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((s, index) => {
                      // Custom Circle Background for Rank 1 & 2
                      let rankBadge = null;
                      if (s.rank === 1) {
                        rankBadge = (
                          <span className="w-6 h-6 rounded-full inline-flex items-center justify-center font-bold text-xs bg-amber-100 text-amber-800 dark:bg-amber-955/50 dark:text-amber-300 border border-amber-200/40">
                            1
                          </span>
                        );
                      } else if (s.rank === 2) {
                        rankBadge = (
                          <span className="w-6 h-6 rounded-full inline-flex items-center justify-center font-bold text-xs bg-zinc-150 text-zinc-700 dark:bg-zinc-850 dark:text-zinc-350 border border-zinc-200/40">
                            2
                          </span>
                        );
                      } else {
                        rankBadge = <span className="text-zinc-400 font-bold text-center w-6 block">{s.rank}</span>;
                      }

                      return (
                        <tr 
                          key={s.teamId}
                          className="border-b border-zinc-100 dark:border-zinc-850/60 hover:bg-zinc-50/50 dark:hover:bg-zinc-850/10 transition-colors"
                        >
                          {/* Rank Circle placement */}
                          <td className="py-3.5 px-3 text-center font-bold">
                            <span className="flex justify-center items-center">{rankBadge}</span>
                          </td>

                          {/* Team Name */}
                          <td className="py-3.5 px-3 font-semibold text-zinc-750 dark:text-zinc-200">
                            <div className="truncate max-w-[120px] sm:max-w-none text-sm" title={s.teamName}>
                              {s.teamName}
                            </div>
                          </td>

                          {/* Played Matches */}
                          <td className="py-3.5 px-2.5 text-center text-zinc-500 dark:text-zinc-400 font-medium">
                            {s.matchesPlayed}
                          </td>

                          {/* Wins count */}
                          <td className="py-3.5 px-2.5 text-center text-emerald-600 font-bold">
                            {s.matchesWon}
                          </td>

                          {/* Losses count */}
                          <td className="py-3.5 px-2.5 text-center text-red-500 font-bold">
                            {s.matchesLost}
                          </td>

                          {/* Point Difference (slash / slash deuce or slash symbol) */}
                          <td className="py-3.5 px-2.5 text-center text-zinc-500 dark:text-zinc-400 font-mono font-medium">
                            {s.pointDiff === 0 ? 'Ø' : s.pointDiff > 0 ? `+${s.pointDiff}` : s.pointDiff}
                          </td>

                          {/* Total Score Points */}
                          <td className="py-3.5 px-3 text-center text-blue-600 dark:text-blue-400 font-black text-sm">
                            {s.points}
                          </td>
                        </tr>
                      );
                    })}

                    {standings.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-zinc-400 dark:text-zinc-600 font-medium font-sans">
                          Chưa có kết quả xếp hạng.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

            </div>

          </div>

        </div>
      )}

      {/* MODAL 1: CONFIRM RE-GENERATE SCHEDULE */}
      {showRegenConfirm && activeGroup && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="regen-schedule-confirm-popup">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-zinc-900 dark:text-zinc-100">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-2xl text-blue-600">
                <RefreshCw size={24} className="stroke-[2.5]" />
              </div>
              <div>
                <h4 className="text-lg font-bold leading-tight">Khởi tạo lại lịch thi đấu?</h4>
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Cảnh báo hệ thống</p>
              </div>
            </div>

            <p className="text-sm font-medium text-zinc-650 dark:text-zinc-450 leading-relaxed">
              Thao tác này sẽ <strong className="text-zinc-800 dark:text-zinc-200">XÓA BỎ HOÀN TOÀN</strong> các cặp đấu & tỉ số hiện tại của <span className="underline font-bold">"{activeGroup.name}"</span> và thiết lập lịch đấu hoàn toàn mới.
              Bạn có chắc chắn muốn tiếp tục không?
            </p>

            <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <button
                onClick={() => setShowRegenConfirm(false)}
                className="px-5 py-2.5 text-xs font-semibold text-zinc-600 hover:text-zinc-850 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/80 rounded-xl cursor-pointer"
              >
                Giữ lịch cũ
              </button>
              
              <button
                onClick={handleRegenSubmit}
                disabled={regenLoading}
                className="px-6 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-md cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
                id="btn-confirm-regen-submit"
              >
                {regenLoading ? 'Đang tạo...' : 'Đồng ý khởi tạo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: CONFIRM RESET SCORES FOR CURRENT TAB */}
      {showResetScoresConfirm && activeGroup && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="reset-scores-confirm-popup">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-md w-full p-6 shadow-xl space-y-4">
            
            <div className="flex items-center gap-3 text-red-600">
              <div className="p-3 bg-red-50 dark:bg-red-955/40 rounded-2xl">
                <AlertTriangle size={24} className="stroke-[2.5]" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-tight">Xóa điểm bảng này?</h4>
                <p className="text-[10px] text-zinc-405 font-bold uppercase tracking-wider">Cảnh báo đồng bộ hóa</p>
              </div>
            </div>

            <p className="text-sm font-medium text-zinc-650 dark:text-zinc-450 leading-relaxed">
              Bạn có thực sự chắc chắn muốn <strong className="text-red-600 dark:text-red-400 uppercase">XÓA SẠCH ĐIỂM SỐ</strong> của mọi cặp đấu thuộc <span className="underline font-bold text-zinc-800 dark:text-zinc-200">"{activeGroup.name}"</span> không?
              Lịch thi đấu vẫn giữ nguyên, nhưng kết quả ghi nhận sẽ biến mất.
            </p>

            <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <button
                onClick={() => setShowResetScoresConfirm(false)}
                className="px-5 py-2.5 text-xs font-semibold text-zinc-600 hover:text-zinc-850 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/80 rounded-xl cursor-pointer"
              >
                Giữ điểm lại
              </button>
              
              <button
                onClick={handleResetScoresSubmit}
                className="px-6 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-xl shadow-md cursor-pointer uppercase tracking-wider"
                id="btn-confirm-reset-scores-submit"
              >
                Đặt lại điểm số
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
