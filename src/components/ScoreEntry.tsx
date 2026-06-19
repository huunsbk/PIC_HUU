import React, { useState } from 'react';
import { Clock, Play, CheckSquare, RotateCcw, X } from 'lucide-react';
import { useTournamentStore } from '../store';
import { useEvents } from '../hooks/useEvents';
import { useMatches } from '../hooks/useMatches';
import { useTeams } from '../hooks/useTeams';
import { useGroups } from '../hooks/useGroups';
import { useMatchSets } from '../hooks/useMatchSets';
import { useMatchMutations } from '../hooks/useDataMutations';
import { balanceMatchesRestTime, getMatchDisplayName } from '../utils/tournamentEngine';

export default function ScoreEntry() {
  const { currentEventId, setCurrentEvent, userRole, currentUser } = useTournamentStore();
  const currentEnterpriseUser = useTournamentStore(state => state.currentEnterpriseUser);

  const { data: eventsData = [] } = useEvents();
  const { data: matchesData = [] } = useMatches();
  const { data: teamsData = [] } = useTeams();
  const { data: groupsData = [] } = useGroups();
  const { data: matchSetsData = [] } = useMatchSets();
  const { updateMatchScore, updateMatchSetScore, resetMatchScore } = useMatchMutations();

  const events = React.useMemo(() => {
    const record: Record<string, any> = {};
    eventsData.forEach(e => { record[e.id] = e; });
    return record;
  }, [eventsData]);

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

  const matches = matchesData;

  const [localScores, setLocalScores] = useState<Record<string, { a: string, b: string }>>({});
  const [localSetScores, setLocalSetScores] = useState<Record<string, { a: string, b: string }>>({});
  const [activeMatchIds, setActiveMatchIds] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const triggerError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 4000);
  };

  const eventList = eventsData;
  
  // Safe checks for currentEventId
  const currentEvt = currentEventId && events[currentEventId] ? events[currentEventId] : eventList[0];
  const matchSetMode = currentEvt?.scoring_config?.matchSetMode || 'single';
  const isBestOf3 = matchSetMode === 'best_of_3';
  
  const isPermitted = React.useMemo(() => {
    // If they have all access, they are permitted
    if (useTournamentStore.getState().hasPermission('*') || useTournamentStore.getState().hasPermission('enter_scores')) return true;
    if (!currentEvt) return false;
    
    // Fallback or specific case handling: users with enter_scores permission might have permittedEventIds
    // inside the EnterpriseAccount payload (retrieved dynamically or aggregated during login)
    // Check if the current ID matches any permitted IDs
    return currentEnterpriseUser?.permittedEventIds?.includes(currentEvt.id) || false;
  }, [useTournamentStore.getState().permissions, currentEnterpriseUser, currentEvt?.id]);

  if (eventList.length === 0) {
    return <div className="text-center py-20 text-zinc-500 font-bold bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800">Chưa có nội dung thi đấu nào. Vui lòng tạo nội dung trước.</div>;
  }

  // The condition below must now use `matches` array since `currentEvt` no longer holds `.matches`
  if (!matches || matches.length === 0) {
     return (
        <div className="space-y-6">
          <div className="flex items-center gap-3 bg-zinc-100 dark:bg-zinc-900 p-2 rounded-2xl border border-zinc-200/50 dark:border-zinc-800/50 overflow-x-auto whitespace-nowrap hide-scrollbar">
            {eventList.map(evt => (
              <button
                key={evt.id}
                onClick={() => setCurrentEvent(evt.id)}
                className={`px-5 py-2.5 rounded-xl font-black text-sm transition-all focus:outline-none ${
                    currentEvt?.id === evt.id
                    ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm border border-zinc-200 dark:border-zinc-700'
                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 border border-transparent'
                }`}
              >
                {evt.name}
              </button>
            ))}
          </div>
          <div className="text-center py-20 text-zinc-500 font-bold bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800">Chưa có lịch thi đấu. Hãy chia bảng và xuất lịch thi đấu trước!</div>
        </div>
     )
  }

  const evtMatches = balanceMatchesRestTime(matches || []);
  const playingIdSet = new Set(activeMatchIds);
  const playingMatches = evtMatches.filter(m => m.status === 'playing' || playingIdSet.has(m.id));

  const handleSetPlaying = async (matchId: string) => {
    setActiveMatchIds(prev => prev.includes(matchId) ? prev : [...prev, matchId]);
    setLocalScores(prev => ({
        ...prev,
        [matchId]: { a: '', b: '' }
    }));
  };

  const handleCancelPlaying = async (matchId: string) => {
    setActiveMatchIds(prev => prev.filter(id => id !== matchId));
  };

  const handleScoreChange = (matchId: string, team: 'a' | 'b', value: string) => {
    if (value === '' || /^[0-9]+$/.test(value)) {
        setLocalScores(prev => {
            const currentObj = prev[matchId] || { a: '', b: '' };
            return {
                ...prev,
                [matchId]: {
                    ...currentObj,
                    [team]: value
                }
            };
        });
    }
  };

  const saveScore = async (matchId: string) => {
    const scores = localScores[matchId];
    if (!scores || scores.a === '' || scores.b === '') {
        try {
            alert('Vui lòng nhập đầy đủ điểm số cho cả hai đội!');
        } catch (e) {
            console.warn('Alert blocked by browser sandboxing:', e);
        }
        triggerError('Vui lòng nhập đầy đủ điểm số cho cả hai đội!');
        return;
    }
    try {
      await updateMatchScore.mutateAsync({ matchId, scoreA: parseInt(scores.a, 10), scoreB: parseInt(scores.b, 10) });
    } catch (err) {
      triggerError(err instanceof Error ? err.message : 'Không lưu được điểm séc.');
    }
  };

  const getSetKey = (matchId: string, setNumber: number) => `${matchId}:${setNumber}`;

  const getSetScoreValue = (matchId: string, setNumber: 1 | 2 | 3) => {
    const local = localSetScores[getSetKey(matchId, setNumber)];
    if (local) return local;
    const existing = matchSetsData.find((row) => row.match_id === matchId && row.set_number === setNumber);
    return {
      a: existing?.score_a !== null && existing?.score_a !== undefined ? String(existing.score_a) : '',
      b: existing?.score_b !== null && existing?.score_b !== undefined ? String(existing.score_b) : '',
    };
  };

  const handleSetScoreChange = (matchId: string, setNumber: 1 | 2 | 3, team: 'a' | 'b', value: string) => {
    if (value !== '' && !/^[0-9]+$/.test(value)) return;
    setLocalSetScores(prev => {
      const key = getSetKey(matchId, setNumber);
      const current = prev[key] || getSetScoreValue(matchId, setNumber);
      return {
        ...prev,
        [key]: {
          ...current,
          [team]: value,
        },
      };
    });
  };

  const saveSetScore = async (matchId: string, setNumber: 1 | 2 | 3) => {
    const scores = getSetScoreValue(matchId, setNumber);
    if (scores.a === '' || scores.b === '') {
      triggerError(`Vui lòng nhập đủ điểm cho séc ${setNumber}.`);
      return;
    }

    try {
      await updateMatchSetScore.mutateAsync({
        matchId,
        setNumber,
        scoreA: parseInt(scores.a, 10),
        scoreB: parseInt(scores.b, 10),
      });
    } catch (err) {
      triggerError(err instanceof Error ? err.message : `Không lưu được điểm séc ${setNumber}.`);
    }
  };

  const handleResetScore = async (matchId: string) => {
    await resetMatchScore.mutateAsync(matchId);
    setLocalScores(prev => ({ ...prev, [matchId]: { a: '', b: '' } }));
    setLocalSetScores(prev => {
      const next = { ...prev };
      [1, 2, 3].forEach(setNumber => delete next[getSetKey(matchId, setNumber)]);
      return next;
    });
    setActiveMatchIds(prev => prev.filter(id => id !== matchId));
  };

  const getMatchResultLabel = (match: any, teamA: string, teamB: string) => {
    if (match.status !== 'finished' || match.scoreA === null || match.scoreB === null) {
      return 'Chưa có kết quả trận';
    }
    const winnerName = match.winnerId === match.teamAId ? teamA : match.winnerId === match.teamBId ? teamB : 'Đội thắng';
    return `${winnerName} thắng ${match.scoreA}-${match.scoreB}`;
  };

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="fixed top-5 right-5 z-50 bg-red-650 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2 font-bold animate-pulse text-xs border border-red-500/30">
          <span>⚠️ {errorMsg}</span>
        </div>
      )}
      <div className="flex items-center gap-3 bg-white dark:bg-zinc-900 p-2 rounded-2xl border border-zinc-200/50 dark:border-zinc-800/50 overflow-x-auto whitespace-nowrap hide-scrollbar">
        {eventList.map(evt => (
            <button
            key={evt.id}
            onClick={() => setCurrentEvent(evt.id)}
            className={`px-5 py-2.5 rounded-xl font-black text-sm transition-all focus:outline-none ${
                currentEvt.id === evt.id
                ? 'bg-zinc-100 dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm border border-zinc-200 dark:border-zinc-700'
                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 border border-transparent'
            }`}
            >
            {evt.name}
            </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Panel: Lịch thi đấu cập nhật mới nhất (đang chờ và tiến độ) */}
        <div className="lg:col-span-1 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden flex flex-col h-[600px]">
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 text-[16px] font-extrabold flex items-center gap-2 tracking-tight uppercase bg-zinc-50 dark:bg-zinc-950">
               <Clock size={16} /> LỊCH ĐẤU & ĐIỂM SỐ MỚI NHẤT
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 space-y-2 h-[500px]">
                {evtMatches.map((m, idx) => {
                    const teamA = getMatchDisplayName(m.teamAId, m.placeholderA, teams, groups, matches, currentEvt.settings || {});
                    const teamB = getMatchDisplayName(m.teamBId, m.placeholderB, teams, groups, matches, currentEvt.settings || {});
                    const group = groups[m.groupId];
                    const absoluteIndex = idx + 1;
                    const isFinished = m.status === 'finished';
                    const isPlaying = m.status === 'playing' || playingIdSet.has(m.id);

                    let roundLabel = "";
                    let groupBadgeStyle = "text-zinc-600 dark:text-zinc-400 font-bold text-[9px]";
                    if (group) {
                        const groupNameUpper = group.name.toUpperCase();
                        roundLabel = groupNameUpper.startsWith('BẢNG') ? groupNameUpper : `BẢNG ${groupNameUpper}`;
                    } else {
                        const rName = (m.knockoutRoundName || "").toLowerCase();
                        if (rName.includes("32")) roundLabel = "VÒNG 32";
                        else if (rName.includes("16")) roundLabel = "VÒNG 16";
                        else if (rName.includes("tứ kết")) roundLabel = "TỨ KẾT";
                        else if (rName.includes("bán kết")) roundLabel = "BÁN KẾT";
                        else if (rName.includes("chung kết")) roundLabel = "CHUNG KẾT";
                        else roundLabel = rName ? rName.toUpperCase() : `VÒNG KO ${m.round}`;
                    }

                    let btnJsx = null;
                    let wrapperClass = "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800";
                    
                    if (isFinished) {
                        wrapperClass = "bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800";
                        btnJsx = (
                           <button
                             onClick={() => handleSetPlaying(m.id)}
                             disabled={!isPermitted}
                             className="text-[10px] font-black tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/60 px-2 py-1 rounded leading-none border border-emerald-200/50 dark:border-emerald-800 shadow-sm mt-1 shrink-0 text-center disabled:opacity-50"
                             title="Xem kết quả hoặc reset trước khi sửa"
                           >
                              {m.scoreA}-{m.scoreB}
                           </button>
                        );
                    } else if (isPlaying) {
                        wrapperClass = "bg-blue-50/40 dark:bg-blue-950/20 border-blue-300 dark:border-blue-800";
                        btnJsx = (
                            <button className="text-[9px] font-bold text-blue-100 bg-blue-600 dark:bg-blue-600 px-2.5 py-1.5 rounded leading-none shrink-0 shadow-sm mt-1 cursor-default text-center">
                                ĐANG ĐẤU
                            </button>
                        );
                    } else {
                        btnJsx = (
                            <button
                                onClick={() => handleSetPlaying(m.id)}
                            disabled={!isPermitted || !m.teamAId || !m.teamBId}
                            className={`text-[9px] font-bold px-2.5 py-1.5 rounded leading-none shrink-0 shadow-sm transition-colors mt-1 text-center ${(!isPermitted || !m.teamAId || !m.teamBId) ? 'text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 cursor-not-allowed' : 'text-zinc-600 bg-zinc-150 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 cursor-pointer'}`}
                            >
                                CHỜ
                            </button>
                        );
                    }

                    return (
                        <div key={m.id} className={`flex pl-[10px] py-0 rounded-xl border-[1.5px] items-stretch gap-2 transition-colors ${wrapperClass}`}>
                           <div className={`w-8 h-8 rounded flex items-center justify-center font-black text-sm shrink-0 self-center shadow-xs border ${
                               isFinished ? 'bg-emerald-600 text-white border-emerald-700' :
                               isPlaying ? 'bg-blue-600 text-white border-blue-700' : 'bg-[#114666] text-white border-[#0d344d]'
                           }`}>
                               {absoluteIndex}
                           </div>
                           <div className="flex-1 min-w-0 pr-1 flex flex-col justify-center">
                               <div className="flex flex-col space-y-1">
                                  <div className="truncate text-xs font-bold text-zinc-800 dark:text-zinc-200">{teamA}</div>
                                  <div className="w-0.5 h-1.5 bg-orange-400 mx-1"></div>
                                  <div className="truncate text-xs font-bold text-zinc-800 dark:text-zinc-200">{teamB}</div>
                               </div>
                           </div>
                           <div className="flex flex-col items-center justify-center min-w-[50px] shrink-0 border-l border-black/5 dark:border-white/5 pl-2">
                               <span className={groupBadgeStyle}>{roundLabel}</span>
                               {btnJsx}
                           </div>
                        </div>
                    );
                })}
            </div>
        </div>

        {/* Right Panel: Khu vực nhập điểm */}
        <div className="lg:col-span-2 space-y-8">
           {!isPermitted ? (
               <div className="bg-zinc-50 dark:bg-zinc-950/50 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col items-center justify-center py-32 text-zinc-400">
                  <Play size={48} className="mb-4 opacity-20 text-zinc-400" />
                  <p className="font-bold text-sm text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Trọng tài không có quyền</p>
                  <p className="text-xs font-medium text-zinc-500 mt-2 px-8 text-center">Bạn không được phân công nhập điểm cho nội dung này. Vui lòng chuyển sang nội dung bạn phụ trách.</p>
               </div>
           ) : playingMatches.length === 0 ? (
               <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col items-center justify-center py-32 text-zinc-400">
                  <Play size={48} className="mb-4 opacity-20 text-zinc-400" />
                  <p className="font-bold text-sm">Chưa có trận đấu nào đang diễn ra.</p>
                  <p className="text-xs font-medium opacity-70 mt-1">Chọn nút "CHỜ" ở lịch thi đấu bên trái để bắt đầu nhập điểm trận đấu.</p>
               </div>
           ) : (
               <div className="grid grid-cols-1 gap-6">
                   {playingMatches.map(m => {
                       const teamA = getMatchDisplayName(m.teamAId, m.placeholderA, teams, groups, matches, currentEvt.settings || {});
                       const teamB = getMatchDisplayName(m.teamBId, m.placeholderB, teams, groups, matches, currentEvt.settings || {});
                       const group = groups[m.groupId];
                       
                       let roundLabel = "";
                       if (group) {
                           const groupNameUpper = group.name.toUpperCase();
                           roundLabel = groupNameUpper.startsWith('BẢNG') ? groupNameUpper : `BẢNG ${groupNameUpper}`;
                       } else {
                           const rName = (m.knockoutRoundName || "").toLowerCase();
                           if (rName.includes("32")) roundLabel = "VÒNG 32";
                           else if (rName.includes("16")) roundLabel = "VÒNG 16";
                           else if (rName.includes("tứ kết")) roundLabel = "TỨ KẾT";
                           else if (rName.includes("bán kết")) roundLabel = "BÁN KẾT";
                           else if (rName.includes("chung kết")) roundLabel = "CHUNG KẾT";
                           else roundLabel = rName ? rName.toUpperCase() : `VÒNG KO ${m.round}`;
                       }

                       const scores = localScores[m.id] || { a: '', b: '' };
                       const set1 = getSetScoreValue(m.id, 1);
                       const set2 = getSetScoreValue(m.id, 2);
                       const set3 = getSetScoreValue(m.id, 3);
                       const matchFinished = m.status === 'finished';
                       const isTwoZeroFinished = matchFinished && ((m.scoreA === 2 && m.scoreB === 0) || (m.scoreA === 0 && m.scoreB === 2));
                       const resultLabel = getMatchResultLabel(m, teamA, teamB);

                       return (
                           <div key={m.id} className="relative bg-white dark:bg-zinc-900 py-3 px-2 sm:px-4 w-full sm:w-[627px] h-auto min-h-[90px] mx-auto border rounded-2xl sm:rounded-[1.5rem] border-blue-200 dark:border-blue-900 shadow-sm hover:shadow-md transition-shadow">
                                <div className="absolute top-0 inset-x-0 -mt-3.5 flex justify-center">
                                    <span className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 border border-blue-200 dark:border-blue-800 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-xs">
                                        {roundLabel}
                                    </span>
                                </div>
                                
                                <button
                                    onClick={() => isBestOf3 ? undefined : saveScore(m.id)}
                                    disabled={isBestOf3 || matchFinished}
                                    className="absolute left-2 sm:left-5 top-1/2 -translate-y-1/2 p-2 sm:p-3.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white dark:bg-emerald-900/30 dark:hover:bg-emerald-600 dark:text-emerald-500 dark:hover:text-white rounded-xl sm:rounded-2xl transition-all cursor-pointer shadow-sm z-10"
                                    title={isBestOf3 ? "Lưu từng séc bằng nút trên từng hàng" : "Lưu điểm séc"}
                                >
                                    <CheckSquare className="w-5 h-5 sm:w-6 sm:h-6" />
                                </button>

                                <button
                                    onClick={() => matchFinished ? handleResetScore(m.id) : handleCancelPlaying(m.id)}
                                    className="absolute right-2 sm:right-5 top-1/2 -translate-y-1/2 p-2 sm:p-3.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-xl sm:rounded-2xl transition-all cursor-pointer z-10"
                                    title={matchFinished ? "Reset điểm trước khi sửa" : "Hủy đang diễn ra"}
                                >
                                    {matchFinished ? <RotateCcw className="w-5 h-5 sm:w-6 sm:h-6" /> : <X className="w-5 h-5 sm:w-6 sm:h-6" />}
                                </button>
                                
                                {!isBestOf3 ? (
                                <div className="space-y-2 mt-4 px-10 sm:px-0">
                                  <div className="text-center text-[10px] font-black uppercase tracking-widest text-zinc-400">Điểm từng séc</div>
                                  <div className="flex items-center justify-center pb-1 sm:pb-0 sm:gap-6 gap-2 flex-nowrap w-full">
                                    {/* Team A */}
                                    <div className="flex flex-col sm:flex-row items-center sm:gap-4 gap-1.5 sm:w-[240px] flex-1 sm:justify-end">
                                        <div className="text-[12px] sm:text-[17px] font-extrabold text-zinc-800 dark:text-zinc-100 text-center sm:text-right w-full sm:w-[180px] shrink-0 truncate px-0.5 order-1">{teamA}</div>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={scores.a ?? ''}
                                            onChange={(e) => handleScoreChange(m.id, 'a', e.target.value)}
                                            disabled={matchFinished}
                                            className="w-[54px] h-[44px] sm:w-[50px] sm:h-[50px] text-center text-[18px] p-[2px] font-black bg-blue-50/50 dark:bg-zinc-950 border-[2px] border-blue-200 dark:border-zinc-800 text-blue-600 dark:text-blue-400 rounded-xl focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/20 transition-all font-mono order-2"
                                        />
                                    </div>

                                    {/* DIVIDER */}
                                    <div className="hidden sm:flex text-zinc-300 dark:text-zinc-700 font-black text-3xl">-</div>
                                    <div className="flex sm:hidden text-zinc-300 dark:text-zinc-700 font-black text-xl mt-4 shrink-0 px-0.5">:</div>

                                    {/* Team B */}
                                    <div className="flex flex-col sm:flex-row items-center sm:gap-4 gap-1.5 sm:w-[240px] flex-1 sm:justify-start">
                                        <div className="text-[12px] sm:text-[17px] font-extrabold text-zinc-800 dark:text-zinc-100 text-center sm:text-left w-full sm:w-[180px] shrink-0 truncate px-0.5 order-1 sm:order-2">{teamB}</div>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={scores.b ?? ''}
                                            onChange={(e) => handleScoreChange(m.id, 'b', e.target.value)}
                                            disabled={matchFinished}
                                            className="w-[54px] h-[44px] sm:w-[50px] sm:h-[50px] text-center text-[18px] p-[2px] font-black bg-blue-50/50 dark:bg-zinc-950 border-[2px] border-blue-200 dark:border-zinc-800 text-blue-600 dark:text-blue-400 rounded-xl focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/20 transition-all font-mono order-2 sm:order-1"
                                        />
                                    </div>
                                  </div>
                                  <div className="text-center text-[11px] font-black text-emerald-700 dark:text-emerald-400">
                                    Kết quả trận: {resultLabel}
                                  </div>
                                </div>
                                ) : (
                                  <div className="mt-5 px-12 space-y-2">
                                    <div className="text-center text-[10px] font-black uppercase tracking-widest text-zinc-400">Điểm từng séc</div>
                                    {([1, 2, 3] as const).map((setNumber) => {
                                      const setScore = setNumber === 1 ? set1 : setNumber === 2 ? set2 : set3;
                                      const isSetLocked = matchFinished || (setNumber === 3 && isTwoZeroFinished);
                                      return (
                                        <div key={setNumber} className="flex items-center justify-center gap-2 text-xs">
                                          <span className="w-12 text-[10px] font-black text-zinc-500 uppercase">Séc {setNumber}</span>
                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            value={setScore.a}
                                            onChange={(e) => handleSetScoreChange(m.id, setNumber, 'a', e.target.value)}
                                            disabled={isSetLocked}
                                            className="w-12 h-8 text-center font-black bg-blue-50/50 dark:bg-zinc-950 border border-blue-200 dark:border-zinc-800 text-blue-600 dark:text-blue-400 rounded-lg focus:border-blue-500 focus:outline-none font-mono disabled:opacity-45"
                                          />
                                          <span className="font-black text-zinc-300">-</span>
                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            value={setScore.b}
                                            onChange={(e) => handleSetScoreChange(m.id, setNumber, 'b', e.target.value)}
                                            disabled={isSetLocked}
                                            className="w-12 h-8 text-center font-black bg-blue-50/50 dark:bg-zinc-950 border border-blue-200 dark:border-zinc-800 text-blue-600 dark:text-blue-400 rounded-lg focus:border-blue-500 focus:outline-none font-mono disabled:opacity-45"
                                          />
                                          <button
                                            onClick={() => saveSetScore(m.id, setNumber)}
                                            disabled={isSetLocked}
                                            className="px-2 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black disabled:opacity-45"
                                          >
                                            Lưu
                                          </button>
                                        </div>
                                      );
                                    })}
                                    <div className="text-center text-[11px] font-black text-emerald-700 dark:text-emerald-400 pt-1">
                                      Kết quả trận: {resultLabel}
                                    </div>
                                    {matchFinished && (
                                      <div className="text-center text-[10px] font-bold text-amber-600 dark:text-amber-400">
                                        Trận đã hoàn tất. Bấm reset để sửa lại điểm.
                                      </div>
                                    )}
                                  </div>
                                )}
                            </div>
                       );
                   })}
               </div>
           )}
        </div>
      </div>
    </div>
  );
}
