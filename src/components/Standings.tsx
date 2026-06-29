/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useTournamentStore } from '../store';
import { useTeams } from '../hooks/useTeams';
import { useGroups } from '../hooks/useGroups';
import { useMatches } from '../hooks/useMatches';
import { useMatchSets } from '../hooks/useMatchSets';
import { useEvents } from '../hooks/useEvents';
import { supabase } from '../supabaseClient';
import { calculateGroupStandings, calculateBestThirdPlaces } from '../utils/tournamentEngine';
import { attachMatchSets } from '../utils/scoreDisplay';
import { getEffectiveTournamentSettings } from '../lib/eventSettings';
import { BarChart3, Star, Download, Printer, ShieldAlert, Award } from 'lucide-react';

export default function Standings() {
  const { data: matchesData = [] } = useMatches();
  const { data: matchSetsData = [] } = useMatchSets();
  const { data: teamsData = [] } = useTeams();
  const { data: groupsData = [] } = useGroups();
  const { data: eventsData = [] } = useEvents();
  const matches = React.useMemo(() => attachMatchSets(matchesData as any[], matchSetsData), [matchesData, matchSetsData]);
  const teams = React.useMemo(() => {
    const record: Record<string, any> = {};
    teamsData.forEach(t => { record[t.id] = t; });
    return record;
  }, [teamsData]);

  const groups = React.useMemo(() => {
    const record: Record<string, any> = {};
    groupsData.forEach(g => { record[g.id] = g; });
    return record;
  }, [groupsData]);

  const tournament = useTournamentStore(state => state.tournament);
  const advanceSelectionMode = useTournamentStore(state => state.advanceSelectionMode);
  const manualQualifiedTeamIds = useTournamentStore(state => state.manualQualifiedTeamIds);
  const canManage = useTournamentStore(state => state.hasPermission("manage_standings"));
  const activeTenantId = useTournamentStore(state => state.activeTenantId);
  const currentEventId = useTournamentStore(state => state.currentEventId);

  const addLog = useTournamentStore(state => state.addLog);
  const setAdvanceSelectionMode = useTournamentStore(state => state.setAdvanceSelectionMode);
  const toggleManualQualifiedTeam = useTournamentStore(state => state.toggleManualQualifiedTeam);
  const clearManualQualifiedTeams = useTournamentStore(state => state.clearManualQualifiedTeams);

  const groupList = groupsData;
  const currentEvent = eventsData.find((event: any) => event.id === currentEventId) || eventsData[0];
  const settings = React.useMemo(
    () => getEffectiveTournamentSettings(currentEvent, tournament.settings),
    [currentEvent, tournament.settings],
  );

  // 1. Tính toán BXH toàn bộ các bảng ở trạng thái tức thì
  const { standingsByGroup, groupFinishedMap, allGroupsFinished } = React.useMemo(() => {
    const sbGroup: Record<string, ReturnType<typeof calculateGroupStandings>> = {};
    const gfMap: Record<string, boolean> = {};
    groupList.forEach((group) => {
      const groupMatches = matches.filter((m) => m.groupId === group.id);
      gfMap[group.id] = groupMatches.length > 0 && groupMatches.every((m) => m.status === 'finished');

      sbGroup[group.id] = calculateGroupStandings(
        group.id,
        group.teamIds,
        groupMatches,
        teams,
        settings
      );
    });
    const allFinished = groupList.length > 0 && groupList.every(g => gfMap[g.id]);
    return { standingsByGroup: sbGroup, groupFinishedMap: gfMap, allGroupsFinished: allFinished };
  }, [groupList, matches, teams, settings]);

  // 2. Tính toán BXH Hạng 3 xuất sắc nhất (UEFA)
  const bestThirdPlaces = React.useMemo(() => {
    const groupNamesMap: Record<string, string> = {};
    groupList.forEach((g) => {
      groupNamesMap[g.id] = g.name;
    });
    return calculateBestThirdPlaces(
      standingsByGroup,
      matches,
      settings,
      groupNamesMap
    );
  }, [groupList, standingsByGroup, matches, settings]);

  // Xuất bảng điểm Copy-pasteable CSV cho Tổ chức mang về Excel
  const handleExportCSV = () => {
    let csv = '\uFEFF'; // UTF-8 BOM để Excel hiển thị dấu tiếng Việt đầy đủ
    csv += `BẢNG XẾP HẠNG HỘI THAO - ${tournament.name.toUpperCase()}\n`;
    csv += `Đơn vị tổ chức: ${tournament.organization}\n\n`;

    groupList.forEach((g) => {
      csv += `--- BẢNG XẾP HẠNG: ${g.name.toUpperCase()} ---\n`;
      csv += 'Hạng,Đội tuyển,Hạt giống,Trận,Thắng,Thua,Điểm BXH,Séc,Điểm ghi/nhận,Hiệu số\n';
      const standings = standingsByGroup[g.id] || [];
      standings.forEach((s) => {
        csv += `${s.rank},${s.teamName},${s.seed !== 'none' ? 'Hạt giống ' + s.seed : 'Không'},${s.matchesPlayed},${s.matchesWon},${s.matchesLost},${s.points},${s.setDiff >= 0 ? '+' : ''}${s.setDiff},${s.pointsWon}/${s.pointsLost},${s.pointDiff >= 0 ? '+' : ''}${s.pointDiff}\n`;
      });
      csv += '\n';
    });

    if (settings.advanceCount === 3 && bestThirdPlaces.length > 0) {
      csv += `--- SO SÁNH ĐỘI HẠNG 3 XUẤT SẮC (LUẬT UEFA) ---\n`;
      csv += 'Hạng,Đội tuyển,Từ Bảng,Trận (Có đ.chỉnh),Thắng,Thua,Điểm,Séc,Điểm ghi/nhận,Hiệu số,Luật UEFA áp dụng\n';
      bestThirdPlaces.forEach((s) => {
        csv += `${s.rank},${s.teamName},${s.groupName},${s.matchesPlayed},${s.matchesWon},${s.matchesLost},${s.points},${s.setDiff >= 0 ? '+' : ''}${s.setDiff},${s.pointsWon}/${s.pointsLost},${s.pointDiff >= 0 ? '+' : ''}${s.pointDiff},${s.isUefaAdjusted ? 'Đã trừ trận đội bét bảng' : 'Bằng số đội - Giữ nguyên'}\n`;
      });
      csv += '\n';
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bxh-giai-pickleball-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    addLog('Xuất Excel', 'Xuất bảng xếp hạng và biểu điểm UEFA dưới dạng tập tin CSV thành công.');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-8" id="standings-view">
      {/* Thẻ công cụ xuất excel */}
      <div className="bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <h3 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            <BarChart3 size={18} className="text-blue-500" />
            Biểu Đồ Xếp Hạng & Biểu Điểm Thi Đấu
          </h3>
          <p className="text-xs text-zinc-405">Xếp hạng được tính toán thời gian thực theo thứ tự ưu tiên: Điểm số &gt; Hiệu số séc &gt; Hiệu số điểm &gt; Đối đầu.</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleExportCSV}
            className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 font-bold rounded-xl text-xs cursor-pointer flex items-center gap-1.5"
            id="btn-export-standings-csv"
          >
            <Download size={14} /> Xuất Bảng Điểm (.CSV)
          </button>
          
          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-850 dark:text-zinc-100 font-bold rounded-xl text-xs cursor-pointer flex items-center gap-1.5"
            id="btn-print-standings"
          >
            <Printer size={14} /> In Biên Bản
          </button>
        </div>
      </div>

      {groupList.length > 0 && (
        <div className="bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
          <div className="space-y-1">
            <h4 className="text-sm font-extrabold text-[#111c30] dark:text-zinc-100 uppercase tracking-tight">Phương thức tuyển chọn đội đi tiếp</h4>
            <p className="text-xs text-zinc-400 font-medium">Bố trí đội giành vé đi tiếp tự động dựa trên vị trí BXH hoặc tích chọn thủ công theo ý ban tổ chức giải đấu.</p>
          </div>
          <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-950 p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 shrink-0">
            <button
              onClick={() => setAdvanceSelectionMode('auto')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                advanceSelectionMode === 'auto'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-850 dark:text-zinc-400 dark:hover:text-zinc-200 bg-transparent'
              }`}
            >
              Tự động theo thứ hạng
            </button>
            <button
              onClick={() => setAdvanceSelectionMode('manual')}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                advanceSelectionMode === 'manual'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-850 dark:text-zinc-400 dark:hover:text-zinc-200 bg-transparent'
              }`}
              id="btn-selection-manual"
            >
              Tích chọn Đội đi tiếp ({manualQualifiedTeamIds.length} đội)
            </button>
          </div>
        </div>
      )}

      {groupList.length === 0 ? (
        <div className="py-16 text-center text-zinc-400 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 space-y-3 print:border-none">
          <ShieldAlert size={48} className="mx-auto text-zinc-305" />
          <p>Chưa có bảng xếp hạng, vui lòng cấu hình giải đấu và chia bảng trước.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 print:block print:space-y-8">
          {groupList.map((group) => {
            const standings = standingsByGroup[group.id] || [];
            
            return (
              <div
                key={group.id}
                className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 space-y-4 shadow-xs print:border-zinc-300 print:shadow-none break-inside-avoid"
                id={`container-standings-group-${group.id}`}
              >
                <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
                  <span className="text-sm font-extrabold text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 py-1 px-3 rounded-lg">
                    {group.name}
                  </span>
                  
                  <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wide">
                    Quy tắc UEFA & Thể thao
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-100 dark:border-zinc-800 text-zinc-405 font-bold">
                        <th className="py-3 px-2 text-center w-8">Hạng</th>
                        <th className="py-3 px-3">Đội chơi</th>
                        <th className="py-3 px-2 text-center">Đã đấu</th>
                        <th className="py-3 px-2 text-center text-emerald-600 dark:text-emerald-450">T</th>
                        <th className="py-3 px-2 text-center text-red-600">B</th>
                        <th className="py-3 px-2 text-center font-bold text-zinc-850 dark:text-zinc-100">Điểm</th>
                        <th className="py-3 px-3 text-center">Séc</th>
                        <th className="py-3 px-3 text-center">Điểm ghi</th>
                        <th className="py-3 px-3 text-center">Hiệu số</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((s, idx) => {
                        const isAdvancing = advanceSelectionMode === 'manual'
                          ? (manualQualifiedTeamIds || []).includes(s.teamId)
                          : (groupFinishedMap[group.id] && s.rank <= settings.advanceCount);
                        
                        const isSpecialEl = (group.id === 'group-1' || group.id.startsWith('group-1-')) && idx === 0;
                        
                        return (
                          <tr
                            key={s.teamId}
                            className={`border-b border-zinc-50 dark:border-zinc-850/60 hover:bg-zinc-50/50 dark:hover:bg-zinc-850/10 transition-colors ${
                              isAdvancing
                                ? 'bg-emerald-500/[0.02]/50 print:bg-none'
                                : ''
                            }`}
                          >
                            <td className="py-3.5 px-2 text-center">
                              <span className={`inline-flex items-center justify-center h-5 w-5 rounded font-extrabold text-[10px] ${
                                s.rank === 1
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-955/50 dark:text-amber-300'
                                  : s.rank === 2
                                  ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                                  : 'text-zinc-400'
                              }`}>
                                {s.rank}
                              </span>
                            </td>
 
                            <td className="py-3.5 px-3">
                              <div className="font-extrabold text-zinc-800 dark:text-zinc-200 flex items-center gap-2 truncate max-w-[170px]" title={s.teamName}>
                                {advanceSelectionMode === 'manual' && (
                                  <input
                                    type="checkbox"
                                    checked={isAdvancing}
                                    onChange={() => toggleManualQualifiedTeam(s.teamId)}
                                    className="w-4 h-4 rounded text-blue-600 bg-zinc-100 border-zinc-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600 cursor-pointer print:hidden shrink-0"
                                    id={`check-${s.teamId}`}
                                  />
                                )}
                                <span
                                  className={advanceSelectionMode === 'manual' ? 'cursor-pointer select-none hover:text-blue-600 transition-colors' : ''}
                                  onClick={() => {
                                    if (advanceSelectionMode === 'manual') toggleManualQualifiedTeam(s.teamId);
                                  }}
                                  style={isSpecialEl ? { fontSize: '15px', color: '#131389' } : undefined}
                                >
                                  {s.teamName}
                                </span>
                                {isAdvancing && (
                                  <span className="text-[8px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1 rounded-full text-center shrink-0" title="Đủ điều kiện đi tiếp vào Knockout">
                                    Vé đi tiếp
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="py-3.5 px-2 text-center text-zinc-400 font-medium" style={isSpecialEl ? { fontSize: '14px' } : undefined}>{s.matchesPlayed}</td>
                            <td className="py-3.5 px-2 text-center text-emerald-600 font-bold" style={isSpecialEl ? { fontSize: '14px' } : undefined}>{s.matchesWon}</td>
                            <td className="py-3.5 px-2 text-center text-red-600 font-bold" style={isSpecialEl ? { fontSize: '14px' } : undefined}>{s.matchesLost}</td>
                            
                            <td className="py-3.5 px-2 text-center font-extrabold text-[13px] text-zinc-900 dark:text-zinc-100" style={isSpecialEl ? { fontSize: '14px' } : undefined}>
                              {s.points}
                            </td>

                            <td className="py-3.5 px-3 text-center">
                              <span className={`font-mono font-bold ${s.setDiff > 0 ? 'text-emerald-600' : s.setDiff < 0 ? 'text-red-500' : 'text-zinc-400'}`}>
                                {s.setDiff > 0 ? `+${s.setDiff}` : s.setDiff}
                              </span>
                            </td>

                            <td className="py-3.5 px-3 text-center text-zinc-400 font-mono">
                              {s.pointsWon} : {s.pointsLost}
                            </td>

                            <td className="py-3.5 px-3 text-center">
                              <span className={`font-mono font-bold ${s.pointDiff > 0 ? 'text-emerald-600' : s.pointDiff < 0 ? 'text-red-500' : 'text-zinc-400'}`}>
                                {s.pointDiff > 0 ? `+${s.pointDiff}` : s.pointDiff}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Module "Đội hạng 3 xuất sắc" - Áp dụng Luật UEFA */}
      {settings.advanceCount === 3 && bestThirdPlaces.length > 0 && (
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 space-y-4 shadow-xs break-inside-avoid" id="best-thirds-panel">
          <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <Award size={20} className="text-amber-500" />
            <div>
              <h4 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">
                Bảng So Sánh Các Đội Hạng 3 Xuất Sắc (Luật UEFA)
              </h4>
              <p className="text-[10px] text-zinc-400">
                Áp dụng quy tắc so sánh liên đoàn: Khi số lượng đội giữa các bảng không đều nhau, kết quả đối đầu với đội cuối bảng sẽ tự động bị loại bỏ (trừ khấu hao) để đảm bảo tính công bằng cao nhất cho tấm vé vớt.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-805 text-zinc-405 font-bold">
                  <th className="py-3 px-2 text-center w-8">Hạng</th>
                  <th className="py-3 px-3">Đội chơi</th>
                  <th className="py-3 px-3">Bảng nguồn</th>
                  <th className="py-3 px-2 text-center">Số trận (Đã đ.chỉnh)</th>
                  <th className="py-3 px-2 text-center">T</th>
                  <th className="py-3 px-2 text-center">B</th>
                  <th className="py-3 px-2 text-center font-extrabold text-zinc-800 dark:text-zinc-100">Điểm</th>
                  <th className="py-3 px-3 text-center">Ghi:Nhận</th>
                  <th className="py-3 px-3 text-center">Séc</th>
                  <th className="py-3 px-3 text-center">Hiệu số</th>
                  <th className="py-3 px-4 text-center">Trạng thái UEFA</th>
                </tr>
              </thead>
              <tbody>
                {bestThirdPlaces.map((cand, idx) => {
                  const isTopThirdAdvancing = allGroupsFinished && advanceSelectionMode !== 'manual' && idx < 2; // Ví dụ, lấy top 2 đội hạng 3 đi tiếp
                  return (
                    <tr
                      key={cand.teamId}
                      className={`border-b border-zinc-50 dark:border-zinc-850 hover:bg-zinc-51/40 ${
                        isTopThirdAdvancing ? 'bg-amber-500/[0.02]' : ''
                      }`}
                    >
                      <td className="py-3 px-2 text-center">
                        <span className={`h-5 w-5 inline-flex items-center justify-center font-extrabold text-[10px] rounded ${
                          isTopThirdAdvancing ? 'bg-amber-100 text-amber-800' : 'text-zinc-400'
                        }`}>
                          {cand.rank}
                        </span>
                      </td>

                      <td className="py-3 px-3 font-semibold text-zinc-800 dark:text-zinc-200">
                        {cand.teamName}
                      </td>

                      <td className="py-3 px-3">
                        <span className="py-0.5 px-2 bg-zinc-100 dark:bg-zinc-800 rounded text-[10px] text-zinc-500 font-bold">
                          {cand.groupName}
                        </span>
                      </td>

                      <td className="py-3 px-2 text-center text-zinc-400 font-mono">{cand.matchesPlayed}</td>
                      <td className="py-3 px-2 text-center text-emerald-600 font-semibold">{cand.matchesWon}</td>
                      <td className="py-3 px-2 text-center text-red-600 font-semibold">{cand.matchesLost}</td>
                      <td className="py-3 px-2 text-center font-extrabold text-[13px] text-zinc-900 dark:text-zinc-100">{cand.points}</td>
                      <td className="py-3 px-3 text-center text-zinc-400 font-mono">{cand.pointsWon}:{cand.pointsLost}</td>
                      <td className={`py-3 px-3 text-center font-mono font-bold ${cand.setDiff > 0 ? 'text-emerald-600' : cand.setDiff < 0 ? 'text-red-500' : 'text-zinc-400'}`}>{cand.setDiff >= 0 ? `+${cand.setDiff}` : cand.setDiff}</td>
                      <td className="py-3 px-3 text-center font-mono font-bold text-emerald-600">{cand.pointDiff >= 0 ? `+${cand.pointDiff}` : cand.pointDiff}</td>
                      
                      <td className="py-3 px-4 text-center">
                        {cand.isUefaAdjusted ? (
                          <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            Loại bỏ trận bét bảng
                          </span>
                        ) : (
                          <span className="inline-flex px-1.5 py-0.5 rounded text-[8px] font-medium bg-zinc-100 text-zinc-500">
                            Số đội đều - Giữ nguyên
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
