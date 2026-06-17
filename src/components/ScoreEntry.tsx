import React, { useState } from 'react';
import { Clock, Play, Award, CheckSquare, Save, X } from 'lucide-react';
import { useTournamentStore } from '../store';
import { useEvents } from '../hooks/useEvents';
import { useMatches } from '../hooks/useMatches';
import { useTeams } from '../hooks/useTeams';
import { useGroups } from '../hooks/useGroups';
import { useMatchMutations } from '../hooks/useDataMutations';
import { getReadableTeamName, balanceMatchesRestTime, getMatchDisplayName } from '../utils/tournamentEngine';

export default function ScoreEntry() {
  const { currentEventId, setCurrentEvent, userRole, currentUser } = useTournamentStore();
  const currentEnterpriseUser = useTournamentStore(state => state.currentEnterpriseUser);

  const { data: eventsData = [] } = useEvents();
  const { data: matchesData = [] } = useMatches();
  const { data: teamsData = [] } = useTeams();
  const { data: groupsData = [] } = useGroups();
  const { updateMatchScore, updateMatchStatus } = useMatchMutations();

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const triggerError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 4000);
  };

  const eventList = eventsData;
  
  // Safe checks for currentEventId
  const currentEvt = currentEventId && events[currentEventId] ? events[currentEventId] : eventList[0];
  
  const isPermitted = React.useMemo(() => {
    // If they have all access, they are permitted
    if (useTournamentStore.getState().hasPermission('*') || useTournamentStore.getState().hasPermission('enter_score')) return true;
    if (!currentEvt) return false;
    
    // Fallback or specific case handling: users with enter_score permission might have permittedEventIds
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
  const pendingMatches = evtMatches.filter(m => m.status === 'pending');
  const playingMatches = evtMatches.filter(m => m.status === 'playing');

  const handleSetPlaying = async (matchId: string) => {
    await updateMatchStatus.mutateAsync({ matchId, status: 'playing' });
    setLocalScores(prev => ({
        ...prev,
        [matchId]: { a: '', b: '' }
    }));
  };

  const handleCancelPlaying = async (matchId: string) => {
    await updateMatchStatus.mutateAsync({ matchId, status: 'pending' });
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
    await updateMatchScore.mutateAsync({ matchId, scoreA: parseInt(scores.a, 10), scoreB: parseInt(scores.b, 10) });
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
                    const isPlaying = m.status === 'playing';

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
                           <div className="text-[12px] font-black tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/60 px-2 py-1 rounded leading-none border border-emerald-200/50 dark:border-emerald-800 shadow-sm mt-1 shrink-0 text-center">
                              {m.scoreA} - {m.scoreB}
                           </div>
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

                       return (
                           <div key={m.id} className="relative bg-white dark:bg-zinc-900 py-3 sm:py-[5px] px-2 sm:px-4 w-full sm:w-[627px] h-auto sm:h-[76.6px] min-h-[90px] mx-auto border rounded-2xl sm:rounded-[1.5rem] border-blue-200 dark:border-blue-900 shadow-sm hover:shadow-md transition-shadow">
                                <div className="absolute top-0 inset-x-0 -mt-3.5 flex justify-center">
                                    <span className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 border border-blue-200 dark:border-blue-800 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-xs">
                                        {roundLabel}
                                    </span>
                                </div>
                                
                                <button
                                    onClick={() => saveScore(m.id)}
                                    className="absolute left-2 sm:left-5 top-1/2 -translate-y-1/2 p-2 sm:p-3.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white dark:bg-emerald-900/30 dark:hover:bg-emerald-600 dark:text-emerald-500 dark:hover:text-white rounded-xl sm:rounded-2xl transition-all cursor-pointer shadow-sm z-10"
                                    title="Hoàn Thành"
                                >
                                    <CheckSquare className="w-5 h-5 sm:w-6 sm:h-6" />
                                </button>

                                <button
                                    onClick={() => handleCancelPlaying(m.id)}
                                    className="absolute right-2 sm:right-5 top-1/2 -translate-y-1/2 p-2 sm:p-3.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-xl sm:rounded-2xl transition-all cursor-pointer z-10"
                                    title="Hủy đang diễn ra"
                                >
                                    <X className="w-5 h-5 sm:w-6 sm:h-6" />
                                </button>
                                
                                <div className="flex items-center justify-center pb-1 sm:pb-0 sm:gap-6 gap-2 mt-4 sm:mt-2 flex-nowrap w-full px-10 sm:px-0">
                                    {/* Team A */}
                                    <div className="flex flex-col sm:flex-row items-center sm:gap-4 gap-1.5 sm:w-[240px] flex-1 sm:justify-end">
                                        <div className="text-[12px] sm:text-[17px] font-extrabold text-zinc-800 dark:text-zinc-100 text-center sm:text-right w-full sm:w-[180px] shrink-0 truncate px-0.5 order-1">{teamA}</div>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={scores.a ?? ''}
                                            onChange={(e) => handleScoreChange(m.id, 'a', e.target.value)}
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
                                            className="w-[54px] h-[44px] sm:w-[50px] sm:h-[50px] text-center text-[18px] p-[2px] font-black bg-blue-50/50 dark:bg-zinc-950 border-[2px] border-blue-200 dark:border-zinc-800 text-blue-600 dark:text-blue-400 rounded-xl focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/20 transition-all font-mono order-2 sm:order-1"
                                        />
                                    </div>
                                </div>
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
