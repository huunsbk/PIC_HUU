import React, { useEffect, useMemo, useState } from 'react';
import { Check, Clock, Play, RotateCcw, Save, X } from 'lucide-react';
import { useTournamentStore } from '../store';
import { useEvents } from '../hooks/useEvents';
import { useMatches } from '../hooks/useMatches';
import { useTeams } from '../hooks/useTeams';
import { useGroups } from '../hooks/useGroups';
import { useMatchSets } from '../hooks/useMatchSets';
import { useMatchMutations } from '../hooks/useDataMutations';
import { balanceMatchesRestTime, getMatchDisplayName } from '../utils/tournamentEngine';
import { attachMatchSets, getMatchResultLabel } from '../utils/scoreDisplay';
import type { Match, MatchSet } from '../types';

type SetScoreDraft = { a: string; b: string };

const emptyDraft: SetScoreDraft = { a: '', b: '' };

export default function ScoreEntry() {
  const {
    currentEventId,
    setCurrentEvent,
    currentEnterpriseUser,
    permissions,
    tournament,
    hasPermission,
  } = useTournamentStore();

  const { data: eventsData = [] } = useEvents();
  const { data: matchesData = [] } = useMatches();
  const { data: teamsData = [] } = useTeams();
  const { data: groupsData = [] } = useGroups();
  const { data: matchSetsData = [] } = useMatchSets();
  const { updateMatchSetScore, finalizeMatchScore, resetMatchScore, updateMatchStatus } = useMatchMutations();

  const events = useMemo(() => Object.fromEntries(eventsData.map((event) => [event.id, event])), [eventsData]);
  const teams = useMemo(() => Object.fromEntries(teamsData.map((team) => [team.id, team])), [teamsData]);
  const groups = useMemo(() => Object.fromEntries(groupsData.map((group) => [group.id, group])), [groupsData]);
  const matches = useMemo(() => attachMatchSets(matchesData as Match[], matchSetsData), [matchesData, matchSetsData]);

  const currentEvent = currentEventId && events[currentEventId] ? events[currentEventId] : eventsData[0];
  const matchSetMode = currentEvent?.scoring_config?.matchSetMode || 'single';
  const maxSetCount = matchSetMode === 'best_of_3' ? 3 : 1;

  const isPermitted = useMemo(() => {
    if (hasPermission('*') || hasPermission('enter_scores') || hasPermission('manage_matches')) return true;
    if (!currentEvent) return false;
    return currentEnterpriseUser?.permittedEventIds?.includes(currentEvent.id) || false;
  }, [permissions, currentEnterpriseUser, currentEvent?.id, hasPermission]);

  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [localSetScores, setLocalSetScores] = useState<Record<string, SetScoreDraft>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const eventMatches = useMemo(() => balanceMatchesRestTime(matches || []), [matches]);
  const playingMatches = useMemo(() => eventMatches.filter((match) => match.status === 'playing'), [eventMatches]);

  useEffect(() => {
    if (activeMatchId && !eventMatches.some((match) => match.id === activeMatchId)) {
      setActiveMatchId(null);
    }
  }, [activeMatchId, eventMatches]);

  const triggerError = (message: string) => {
    setErrorMsg(message);
    setTimeout(() => setErrorMsg(null), 4500);
  };

  const triggerSuccess = (message: string) => {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const getSetKey = (matchId: string, setNumber: number) => `${matchId}:${setNumber}`;

  const getStoredSet = (matchId: string, setNumber: number) =>
    matchSetsData.find((row) => row.match_id === matchId && row.set_number === setNumber);

  const getSavedSetScores = (matchId: string) =>
    matchSetsData.filter(
      (row) =>
        row.match_id === matchId &&
        !row.deleted_at &&
        (row.score_a !== null || row.score_b !== null),
    );

  const hasSavedSetScores = (matchId: string) => getSavedSetScores(matchId).length > 0;

  const getSetScoreValue = (matchId: string, setNumber: 1 | 2 | 3): SetScoreDraft => {
    const local = localSetScores[getSetKey(matchId, setNumber)];
    if (local) return local;
    const existing = getStoredSet(matchId, setNumber);
    return {
      a: existing?.score_a !== null && existing?.score_a !== undefined ? String(existing.score_a) : '',
      b: existing?.score_b !== null && existing?.score_b !== undefined ? String(existing.score_b) : '',
    };
  };

  const getTeamName = (match: Match, slot: 'A' | 'B') =>
    slot === 'A'
      ? getMatchDisplayName(match.teamAId, match.placeholderA, teams, groups, matches, tournament?.settings || {})
      : getMatchDisplayName(match.teamBId, match.placeholderB, teams, groups, matches, tournament?.settings || {});

  const getGroupLabel = (match: Match) => {
    if (match.groupId === 'knockout') return match.knockoutRoundName || 'Knockout';
    return groups[match.groupId]?.name || match.groupId || 'Chưa rõ';
  };

  const getSetCell = (match: Match, setNumber: 1 | 2 | 3, side: 'A' | 'B') => {
    if (setNumber > maxSetCount) return '-';
    const set = getStoredSet(match.id, setNumber);
    const value = side === 'A' ? set?.score_a : set?.score_b;
    return value !== null && value !== undefined ? value : '';
  };

  const getStatusLabel = (status: Match['status']) => {
    if (status === 'finished') return 'Đã chốt';
    if (status === 'playing') return 'Đang đấu';
    return 'Chờ đấu';
  };

  const getStatusClassName = (status: Match['status']) => {
    if (status === 'finished') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300';
    if (status === 'playing') return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300';
    return 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300';
  };

  const getSetWinCounts = (matchId: string) => {
    const rows = matchSetsData.filter((row) => row.match_id === matchId && row.status === 'finished' && !row.deleted_at);
    return rows.reduce(
      (acc, row) => {
        const match = eventMatches.find((m) => m.id === matchId);
        if (!match) return acc;
        if (row.winner_id === match.teamAId) acc.a += 1;
        if (row.winner_id === match.teamBId) acc.b += 1;
        return acc;
      },
      { a: 0, b: 0 },
    );
  };

  const handleSetScoreChange = (matchId: string, setNumber: 1 | 2 | 3, team: 'a' | 'b', value: string) => {
    if (value !== '' && !/^[0-9]+$/.test(value)) return;
    setLocalSetScores((prev) => {
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
      triggerError(maxSetCount === 1 ? 'Vui lòng nhập đủ điểm.' : `Vui lòng nhập đủ điểm cho séc ${setNumber}.`);
      return;
    }

    try {
      await updateMatchSetScore.mutateAsync({
        matchId,
        setNumber,
        scoreA: parseInt(scores.a, 10),
        scoreB: parseInt(scores.b, 10),
      });
      triggerSuccess(maxSetCount === 1 ? 'Đã lưu điểm.' : `Đã lưu séc ${setNumber}.`);
    } catch (err) {
      triggerError(err instanceof Error ? err.message : maxSetCount === 1 ? 'Không lưu được điểm.' : `Không lưu được điểm séc ${setNumber}.`);
    }
  };

  const handleFinalizeMatch = async (matchId: string) => {
    try {
      await finalizeMatchScore.mutateAsync(matchId);
      triggerSuccess('Đã chốt kết quả trận.');
    } catch (err) {
      triggerError(err instanceof Error ? err.message : 'Không chốt được kết quả trận.');
    }
  };

  const handleResetMatch = async (matchId: string) => {
    try {
      await resetMatchScore.mutateAsync(matchId);
      setLocalSetScores((prev) => {
        const next = { ...prev };
        [1, 2, 3].forEach((setNumber) => delete next[getSetKey(matchId, setNumber)]);
        return next;
      });
      triggerSuccess('Đã đặt lại điểm trận.');
    } catch (err) {
      triggerError(err instanceof Error ? err.message : 'Không đặt lại được điểm trận.');
    }
  };

  const handleOpenMatch = async (match: Match) => {
    if (!isPermitted) return;
    try {
      if (match.status === 'pending') {
        await updateMatchStatus.mutateAsync({ matchId: match.id, status: 'playing' });
        triggerSuccess('Đã chuyển trận sang đang đấu.');
      }
      setActiveMatchId(match.id);
    } catch (err) {
      triggerError(err instanceof Error ? err.message : 'Không chuyển được trạng thái trận.');
    }
  };

  const handleCloseMatch = async (match: Match) => {
    if (match.status === 'playing' && hasSavedSetScores(match.id)) {
      triggerError('Trận đã có điểm séc. Vui lòng reset điểm trước khi thoát về chờ đấu.');
      return;
    }

    try {
      if (match.status === 'playing') {
        await updateMatchStatus.mutateAsync({ matchId: match.id, status: 'pending' });
        triggerSuccess('Đã đưa trận về chờ đấu.');
      }
      if (activeMatchId === match.id) {
        setActiveMatchId(null);
      }
    } catch (err) {
      triggerError(err instanceof Error ? err.message : 'Không đưa được trận về chờ đấu.');
    }
  };

  if (eventsData.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white py-20 text-center text-sm font-bold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        Chưa có nội dung thi đấu nào.
      </div>
    );
  }

  const renderSetInputs = (match: Match) => {
    const winCounts = getSetWinCounts(match.id);
    const matchFinished = match.status === 'finished';

    return ([1, 2, 3] as const).slice(0, maxSetCount).map((setNumber) => {
      const setScore = getSetScoreValue(match.id, setNumber);
      const thirdSetNotNeeded = setNumber === 3 && (winCounts.a >= 2 || winCounts.b >= 2);
      const disabled = !isPermitted || matchFinished || thirdSetNotNeeded;

      if (maxSetCount === 1) {
        return (
          <div key={setNumber} className="grid grid-cols-[minmax(0,1fr)_72px_22px_72px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950">
            <span className="truncate text-sm font-black text-zinc-900 dark:text-zinc-100" title={getTeamName(match, 'A')}>
              {getTeamName(match, 'A')}
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={setScore.a}
              onChange={(event) => handleSetScoreChange(match.id, setNumber, 'a', event.target.value)}
              disabled={disabled}
              className="h-9 w-full rounded-lg border border-zinc-250 bg-white text-center font-black text-blue-600 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900"
            />
            <span className="text-center text-xs font-black text-zinc-300">-</span>
            <input
              type="text"
              inputMode="numeric"
              value={setScore.b}
              onChange={(event) => handleSetScoreChange(match.id, setNumber, 'b', event.target.value)}
              disabled={disabled}
              className="h-9 w-full rounded-lg border border-zinc-250 bg-white text-center font-black text-blue-600 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900"
            />
            <span className="truncate text-right text-sm font-black text-zinc-900 dark:text-zinc-100" title={getTeamName(match, 'B')}>
              {getTeamName(match, 'B')}
            </span>
            <button
              type="button"
              onClick={() => saveSetScore(match.id, setNumber)}
              disabled={disabled || updateMatchSetScore.isPending}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
              title="Lưu điểm"
            >
              <Save size={15} />
            </button>
          </div>
        );
      }

      return (
        <div key={setNumber} className="grid grid-cols-[70px_1fr_38px_1fr_auto] items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950">
          <span className="text-[10px] font-black uppercase text-zinc-500">Séc {setNumber}</span>
          <input
            type="text"
            inputMode="numeric"
            value={setScore.a}
            onChange={(event) => handleSetScoreChange(match.id, setNumber, 'a', event.target.value)}
            disabled={disabled}
            className="h-9 w-full rounded-lg border border-zinc-250 bg-white text-center font-black text-blue-600 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900"
          />
          <span className="text-center text-xs font-black text-zinc-300">-</span>
          <input
            type="text"
            inputMode="numeric"
            value={setScore.b}
            onChange={(event) => handleSetScoreChange(match.id, setNumber, 'b', event.target.value)}
            disabled={disabled}
            className="h-9 w-full rounded-lg border border-zinc-250 bg-white text-center font-black text-blue-600 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900"
          />
          <button
            type="button"
            onClick={() => saveSetScore(match.id, setNumber)}
            disabled={disabled || updateMatchSetScore.isPending}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
            title={`Lưu séc ${setNumber}`}
          >
            <Save size={15} />
          </button>
        </div>
      );
    });
  };

  const renderPlayingMatchPanel = (match: Match) => (
    <div key={match.id} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">{getGroupLabel(match)}</p>
            <span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase ${getStatusClassName(match.status)}`}>
              {getStatusLabel(match.status)}
            </span>
          </div>
          <h3 className="mt-1 truncate text-base font-black text-zinc-900 dark:text-zinc-100">
            {getTeamName(match, 'A')} vs {getTeamName(match, 'B')}
          </h3>
          <p className="mt-1 text-[11px] font-bold text-zinc-500">{getMatchResultLabel(match, getTeamName(match, 'A'), getTeamName(match, 'B'))}</p>
        </div>
        <button
          type="button"
          onClick={() => handleCloseMatch(match)}
          disabled={updateMatchStatus.isPending || hasSavedSetScores(match.id)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          title={hasSavedSetScores(match.id) ? 'Reset điểm trước khi thoát trận về chờ đấu' : 'Thoát panel nhập điểm'}
        >
          <X size={18} />
        </button>
      </div>

      {hasSavedSetScores(match.id) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          Trận đã có điểm séc. Muốn bấm X để trả về chờ đấu, hãy reset điểm trước.
        </div>
      )}

      <div className="space-y-2">{renderSetInputs(match)}</div>

      <div className="flex items-center justify-between gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => handleResetMatch(match.id)}
          disabled={resetMatchScore.isPending}
          className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <RotateCcw size={15} /> Reset
        </button>
        <button
          type="button"
          onClick={() => handleFinalizeMatch(match.id)}
          disabled={match.status === 'finished' || finalizeMatchScore.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check size={16} /> Chốt trận
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {(errorMsg || successMsg) && (
        <div className={`rounded-xl border px-4 py-3 text-xs font-bold ${
          errorMsg
            ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
        }`}>
          {errorMsg || successMsg}
        </div>
      )}

      <div className="flex items-center gap-3 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
        {eventsData.map((event) => (
          <button
            key={event.id}
            onClick={() => {
              setCurrentEvent(event.id);
              setActiveMatchId(null);
            }}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-black transition-colors ${
              currentEvent?.id === event.id
                ? 'bg-blue-600 text-white'
                : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
            }`}
          >
            {event.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-blue-600" />
              <h2 className="text-sm font-black uppercase text-zinc-900 dark:text-zinc-100">Lịch đấu & kết quả mới nhất</h2>
            </div>
            <span className="text-[10px] font-bold text-zinc-500">{eventMatches.length} trận</span>
          </div>

          {eventMatches.length === 0 ? (
            <div className="py-20 text-center text-sm font-bold text-zinc-500">
              Chưa có lịch thi đấu. Hãy chia bảng và sinh lịch trước.
            </div>
          ) : (
            <div className="grid max-h-[calc(100vh-260px)] grid-cols-1 gap-2 overflow-y-auto p-3">
              {eventMatches.map((match, index) => {
                const teamA = getTeamName(match, 'A');
                const teamB = getTeamName(match, 'B');
                const isActive = activeMatchId === match.id;
                const actionLabel = match.status === 'finished' ? 'Xem' : match.status === 'playing' ? 'Đang đấu' : 'Chờ';
                const setNumbers = ([1, 2, 3] as const).slice(0, maxSetCount);

                return (
                  <article
                    key={match.id}
                    className={`rounded-lg border p-3 transition-colors ${
                      isActive
                        ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/25'
                        : 'border-zinc-200 bg-white hover:border-blue-200 hover:bg-blue-50/40 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-900 dark:hover:bg-blue-950/15'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-lg bg-zinc-900 px-2 text-[11px] font-black text-white dark:bg-zinc-100 dark:text-zinc-950">
                            {index + 1}
                          </span>
                          <span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase ${getStatusClassName(match.status)}`}>
                            {getStatusLabel(match.status)}
                          </span>
                          <span className="rounded-full border border-zinc-200 px-2 py-1 text-[10px] font-black uppercase text-zinc-500 dark:border-zinc-800">
                            {getGroupLabel(match)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenMatch(match)}
                        disabled={!isPermitted || updateMatchStatus.isPending}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-[11px] font-black disabled:cursor-not-allowed disabled:opacity-50 ${
                          match.status === 'playing'
                            ? 'bg-blue-600 text-white hover:bg-blue-500'
                            : match.status === 'finished'
                              ? 'bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-950'
                              : 'bg-amber-500 text-white hover:bg-amber-400'
                        }`}
                      >
                        {match.status === 'finished' ? <Check size={14} /> : <Play size={14} />}
                        {actionLabel}
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-950">
                      <p className="truncate text-sm font-black text-zinc-900 dark:text-zinc-100" title={teamA}>{teamA}</p>
                      <span className="text-[10px] font-black text-zinc-400">VS</span>
                      <p className="truncate text-right text-sm font-black text-zinc-900 dark:text-zinc-100" title={teamB}>{teamB}</p>
                    </div>

                    <div className="mt-2 grid gap-2">
                      {maxSetCount === 1 ? (
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg border border-zinc-100 px-2 py-1.5 text-xs dark:border-zinc-800">
                          <span className="rounded bg-blue-50 px-2 py-1 text-center font-mono font-black text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                            {getSetCell(match, 1, 'A') || '-'}
                          </span>
                          <span className="text-zinc-300">-</span>
                          <span className="rounded bg-blue-50 px-2 py-1 text-center font-mono font-black text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                            {getSetCell(match, 1, 'B') || '-'}
                          </span>
                        </div>
                      ) : (
                        setNumbers.map((setNumber) => (
                          <div key={setNumber} className="grid grid-cols-[56px_1fr_auto_1fr] items-center gap-2 rounded-lg border border-zinc-100 px-2 py-1.5 text-xs dark:border-zinc-800">
                            <span className="text-[10px] font-black uppercase text-zinc-500">Séc {setNumber}</span>
                            <span className="rounded bg-blue-50 px-2 py-1 text-center font-mono font-black text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                              {getSetCell(match, setNumber, 'A') || '-'}
                            </span>
                            <span className="text-zinc-300">-</span>
                            <span className="rounded bg-blue-50 px-2 py-1 text-center font-mono font-black text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                              {getSetCell(match, setNumber, 'B') || '-'}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="rounded-xl border border-zinc-200 bg-zinc-50 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/40">
          {!isPermitted ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center text-zinc-500">
              <Play size={40} className="mb-4 opacity-30" />
              <p className="text-sm font-black uppercase text-zinc-700 dark:text-zinc-300">Không có quyền nhập điểm</p>
              <p className="mt-2 text-xs font-medium">Tài khoản hiện tại chưa được phân công nhập điểm cho nội dung này.</p>
            </div>
          ) : playingMatches.length === 0 ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center text-zinc-500">
              <Play size={40} className="mb-4 opacity-30" />
              <p className="text-sm font-black uppercase text-zinc-700 dark:text-zinc-300">Chưa có trận đang đấu</p>
              <p className="mt-2 text-xs font-medium">Bấm Chờ để đưa trận lên panel và chuyển trạng thái đang đấu.</p>
            </div>
          ) : (
            <div className="space-y-3 p-3">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                <div>
                  <p className="text-sm font-black uppercase text-zinc-900 dark:text-zinc-100">Trận đang đấu</p>
                  <p className="text-[11px] font-bold text-zinc-500">Nhập điểm cho toàn bộ trận đang diễn ra.</p>
                </div>
                <span className="rounded-full bg-blue-600 px-3 py-1 text-[11px] font-black text-white">{playingMatches.length} trận</span>
              </div>
              <div className="max-h-[calc(100vh-260px)] space-y-3 overflow-y-auto pr-1">
                {playingMatches.map(renderPlayingMatchPanel)}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
