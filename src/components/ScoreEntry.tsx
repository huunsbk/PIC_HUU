import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clock, Loader2, Play, RotateCcw, X } from 'lucide-react';
import { useTournamentStore } from '../store';
import { useEvents } from '../hooks/useEvents';
import { useMatches } from '../hooks/useMatches';
import { useTeams } from '../hooks/useTeams';
import { useGroups } from '../hooks/useGroups';
import { useMatchSets } from '../hooks/useMatchSets';
import { useMatchMutations } from '../hooks/useDataMutations';
import { balanceMatchesRestTime, getMatchDisplayName } from '../utils/tournamentEngine';
import { attachMatchSets, getMatchResultLabel } from '../utils/scoreDisplay';
import { getMaxSetCountForMatch } from '../lib/eventSettings';
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
  const { updateMatchSetScore, resetMatchScoreForReentry, updateMatchStatus } = useMatchMutations();

  const events = useMemo(() => Object.fromEntries(eventsData.map((event) => [event.id, event])), [eventsData]);
  const teams = useMemo(() => Object.fromEntries(teamsData.map((team) => [team.id, team])), [teamsData]);
  const groups = useMemo(() => Object.fromEntries(groupsData.map((group) => [group.id, group])), [groupsData]);
  const matches = useMemo(() => attachMatchSets(matchesData as Match[], matchSetsData), [matchesData, matchSetsData]);

  const currentEvent = currentEventId && events[currentEventId] ? events[currentEventId] : eventsData[0];
  const getMatchMaxSetCount = (match: Match) => {
    const event = events[match.event_id || currentEvent?.id || ''] || currentEvent;
    return getMaxSetCountForMatch(match, event?.scoring_config || {});
  };

  const isPermitted = useMemo(() => {
    if (hasPermission('*') || hasPermission('enter_scores') || hasPermission('manage_matches')) return true;
    if (!currentEvent) return false;
    return currentEnterpriseUser?.permittedEventIds?.includes(currentEvent.id) || false;
  }, [permissions, currentEnterpriseUser, currentEvent?.id, hasPermission]);

  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [localSetScores, setLocalSetScores] = useState<Record<string, SetScoreDraft>>({});
  const [savingSetKeys, setSavingSetKeys] = useState<Set<string>>(() => new Set());
  const [locallySavedSetKeys, setLocallySavedSetKeys] = useState<Set<string>>(() => new Set());
  const [autoFinalizedMatchIds, setAutoFinalizedMatchIds] = useState<Set<string>>(() => new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const savingSetKeysRef = useRef<Set<string>>(new Set());
  const suppressBlurSaveMatchIdsRef = useRef<Set<string>>(new Set());

  const eventMatches = useMemo(() => balanceMatchesRestTime(matches || []), [matches]);
  const playingMatches = useMemo(
    () => eventMatches.filter((match) => match.status === 'playing' && !autoFinalizedMatchIds.has(match.id)),
    [eventMatches, autoFinalizedMatchIds],
  );
  const reviewMatch = useMemo(
    () => eventMatches.find((match) => match.id === activeMatchId && match.status === 'finished') || null,
    [activeMatchId, eventMatches],
  );
  const panelMatches = useMemo(() => {
    if (!reviewMatch) return playingMatches;
    return playingMatches.some((match) => match.id === reviewMatch.id) ? playingMatches : [...playingMatches, reviewMatch];
  }, [playingMatches, reviewMatch]);

  useEffect(() => {
    if (activeMatchId && !eventMatches.some((match) => match.id === activeMatchId)) {
      setActiveMatchId(null);
    }
  }, [activeMatchId, eventMatches]);

  useEffect(() => {
    setAutoFinalizedMatchIds((previous) => {
      const next = new Set(
        [...previous].filter((matchId) => eventMatches.some((match) => match.id === matchId && match.status === 'playing')),
      );
      if (next.size === previous.size && [...next].every((matchId) => previous.has(matchId))) return previous;
      return next;
    });
  }, [eventMatches]);

  useEffect(() => {
    setLocallySavedSetKeys((previous) => {
      const next = new Set(
        [...previous].filter((setKey) => {
          const [matchId, setNumber] = setKey.split(':');
          return matchSetsData.some(
            (row) => row.match_id === matchId && row.set_number === Number(setNumber) && row.status === 'finished' && !row.deleted_at,
          ) || savingSetKeysRef.current.has(setKey);
        }),
      );
      if (next.size === previous.size && [...next].every((setKey) => previous.has(setKey))) return previous;
      return next;
    });
  }, [matchSetsData]);

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
    const maxSetCount = getMatchMaxSetCount(match);
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

  const saveSetScore = async (matchId: string, setNumber: 1 | 2 | 3, showIncompleteError = false) => {
    if (suppressBlurSaveMatchIdsRef.current.has(matchId)) return;

    const scores = getSetScoreValue(matchId, setNumber);
    if (scores.a === '' || scores.b === '') {
      if (showIncompleteError) {
        const match = eventMatches.find((item) => item.id === matchId);
        const maxSetCount = match ? getMatchMaxSetCount(match) : 1;
        triggerError(maxSetCount === 1 ? 'Vui lòng nhập đủ điểm.' : `Vui lòng nhập đủ điểm cho séc ${setNumber}.`);
      }
      return;
    }

    const setKey = getSetKey(matchId, setNumber);
    if (savingSetKeysRef.current.has(setKey)) return;

    const storedSet = getStoredSet(matchId, setNumber);
    if (
      storedSet?.status === 'finished' &&
      storedSet.score_a === Number(scores.a) &&
      storedSet.score_b === Number(scores.b)
    ) {
      return;
    }

    savingSetKeysRef.current.add(setKey);
    setSavingSetKeys((previous) => new Set(previous).add(setKey));

    try {
      const result = await updateMatchSetScore.mutateAsync({
        matchId,
        setNumber,
        scoreA: parseInt(scores.a, 10),
        scoreB: parseInt(scores.b, 10),
      });
      setLocallySavedSetKeys((previous) => new Set(previous).add(setKey));
      const match = eventMatches.find((item) => item.id === matchId);
      const maxSetCount = match ? getMatchMaxSetCount(match) : 1;
      if (result?.auto_finalized === true) {
        setAutoFinalizedMatchIds((previous) => new Set(previous).add(matchId));
        setActiveMatchId((current) => current === matchId ? null : current);
        triggerSuccess('Đã lưu điểm và tự động chốt trận.');
      } else {
        triggerSuccess(maxSetCount === 1 ? 'Đã lưu điểm.' : `Đã lưu séc ${setNumber}.`);
      }
    } catch (err) {
      const match = eventMatches.find((item) => item.id === matchId);
      const maxSetCount = match ? getMatchMaxSetCount(match) : 1;
      triggerError(err instanceof Error ? err.message : maxSetCount === 1 ? 'Không lưu được điểm.' : `Không lưu được điểm séc ${setNumber}.`);
    } finally {
      savingSetKeysRef.current.delete(setKey);
      setSavingSetKeys((previous) => {
        const next = new Set(previous);
        next.delete(setKey);
        return next;
      });
    }
  };

  const handleScoreKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, matchId: string) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (suppressBlurSaveMatchIdsRef.current.has(matchId)) return;
    event.currentTarget.blur();
  };

  const handleResetMatch = async (matchId: string) => {
    try {
      await resetMatchScoreForReentry.mutateAsync(matchId);
      setLocalSetScores((prev) => {
        const next = { ...prev };
        [1, 2, 3].forEach((setNumber) => delete next[getSetKey(matchId, setNumber)]);
        return next;
      });
      setLocallySavedSetKeys((previous) => {
        const next = new Set(previous);
        [1, 2, 3].forEach((setNumber) => next.delete(getSetKey(matchId, setNumber)));
        return next;
      });
      setAutoFinalizedMatchIds((previous) => {
        const next = new Set(previous);
        next.delete(matchId);
        return next;
      });
      triggerSuccess('Đã đặt lại điểm trận.');
    } catch (err) {
      triggerError(err instanceof Error ? err.message : 'Không đặt lại được điểm trận.');
    } finally {
      suppressBlurSaveMatchIdsRef.current.delete(matchId);
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
    if (match.status === 'finished') {
      if (activeMatchId === match.id) {
        setActiveMatchId(null);
      }
      suppressBlurSaveMatchIdsRef.current.delete(match.id);
      return;
    }

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
    } finally {
      suppressBlurSaveMatchIdsRef.current.delete(match.id);
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
    const maxSetCount = getMatchMaxSetCount(match);

    return ([1, 2, 3] as const).slice(0, maxSetCount).map((setNumber) => {
      const setScore = getSetScoreValue(match.id, setNumber);
      const thirdSetNotNeeded = setNumber === 3 && (winCounts.a >= 2 || winCounts.b >= 2);
      const setKey = getSetKey(match.id, setNumber);
      const storedSet = getStoredSet(match.id, setNumber);
      const setAlreadySaved = storedSet?.status === 'finished' || locallySavedSetKeys.has(setKey);
      const setIsSaving = savingSetKeys.has(setKey);
      const disabled = !isPermitted || matchFinished || thirdSetNotNeeded || setAlreadySaved || setIsSaving;

      if (maxSetCount === 1) {
        return (
          <div key={setNumber} className="grid min-w-max grid-cols-[21px_5px_21px_15px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-1.5 py-1 dark:border-zinc-800 dark:bg-zinc-950">
            <input
              type="text"
              inputMode="numeric"
              size={2}
              aria-label={`Điểm đội A, ${getTeamName(match, 'A')}`}
              value={setScore.a}
              onChange={(event) => handleSetScoreChange(match.id, setNumber, 'a', event.target.value)}
              onBlur={() => void saveSetScore(match.id, setNumber)}
              onKeyDown={(event) => handleScoreKeyDown(event, match.id)}
              disabled={disabled}
              className="score-input-2digits match-score-value rounded-lg border border-zinc-250 bg-white text-center font-black text-blue-600 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900"
            />
            <span className="match-score-value text-center font-black text-zinc-300">-</span>
            <input
              type="text"
              inputMode="numeric"
              size={2}
              aria-label={`Điểm đội B, ${getTeamName(match, 'B')}`}
              value={setScore.b}
              onChange={(event) => handleSetScoreChange(match.id, setNumber, 'b', event.target.value)}
              onBlur={() => void saveSetScore(match.id, setNumber)}
              onKeyDown={(event) => handleScoreKeyDown(event, match.id)}
              disabled={disabled}
              className="score-input-2digits match-score-value rounded-lg border border-zinc-250 bg-white text-center font-black text-blue-600 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900"
            />
            <span className="inline-flex h-[15px] w-[15px] items-center justify-center text-emerald-600" title={setIsSaving ? 'Đang lưu điểm' : setAlreadySaved ? 'Đã lưu điểm' : undefined}>
              {setIsSaving ? <Loader2 size={13} className="animate-spin" /> : setAlreadySaved ? <Check size={13} /> : null}
            </span>
          </div>
        );
      }

      return (
        <div key={setNumber} className="grid min-w-max grid-cols-[19px_21px_5px_21px_15px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-1.5 py-1 dark:border-zinc-800 dark:bg-zinc-950">
          <span className="match-group-title font-black uppercase text-zinc-500">Séc {setNumber}</span>
          <input
            type="text"
            inputMode="numeric"
            size={2}
            aria-label={`Điểm đội A, séc ${setNumber}, ${getTeamName(match, 'A')}`}
            value={setScore.a}
            onChange={(event) => handleSetScoreChange(match.id, setNumber, 'a', event.target.value)}
            onBlur={() => void saveSetScore(match.id, setNumber)}
            onKeyDown={(event) => handleScoreKeyDown(event, match.id)}
            disabled={disabled}
            className="score-input-2digits match-score-value rounded-lg border border-zinc-250 bg-white text-center font-black text-blue-600 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900"
          />
          <span className="match-score-value text-center font-black text-zinc-300">-</span>
          <input
            type="text"
            inputMode="numeric"
            size={2}
            aria-label={`Điểm đội B, séc ${setNumber}, ${getTeamName(match, 'B')}`}
            value={setScore.b}
            onChange={(event) => handleSetScoreChange(match.id, setNumber, 'b', event.target.value)}
            onBlur={() => void saveSetScore(match.id, setNumber)}
            onKeyDown={(event) => handleScoreKeyDown(event, match.id)}
            disabled={disabled}
            className="score-input-2digits match-score-value rounded-lg border border-zinc-250 bg-white text-center font-black text-blue-600 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900"
          />
          <span className="inline-flex h-[15px] w-[15px] items-center justify-center text-emerald-600" title={setIsSaving ? `Đang lưu séc ${setNumber}` : setAlreadySaved ? `Đã lưu séc ${setNumber}` : undefined}>
            {setIsSaving ? <Loader2 size={13} className="animate-spin" /> : setAlreadySaved ? <Check size={13} /> : null}
          </span>
        </div>
      );
    });
  };

  const renderPlayingMatchPanel = (match: Match) => {
    const isReviewingFinished = match.status === 'finished';

    return (
    <div key={match.id} className="space-y-2 rounded-xl border border-zinc-200 bg-white p-2.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 pb-2 dark:border-zinc-800">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="match-group-title font-black uppercase tracking-widest text-blue-600">{getGroupLabel(match)}</p>
            <span className={`match-group-title rounded-full border px-2 py-1 font-black uppercase ${getStatusClassName(match.status)}`}>
              {getStatusLabel(match.status)}
            </span>
          </div>
          <h3 className="match-team-name mt-1 font-black leading-tight text-zinc-900 dark:text-zinc-100">
            {getTeamName(match, 'A')} vs {getTeamName(match, 'B')}
          </h3>
        </div>
        <button
          type="button"
          onPointerDown={() => suppressBlurSaveMatchIdsRef.current.add(match.id)}
          onClick={() => handleCloseMatch(match)}
          disabled={updateMatchStatus.isPending || (!isReviewingFinished && hasSavedSetScores(match.id))}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          title={!isReviewingFinished && hasSavedSetScores(match.id) ? 'Reset điểm trước khi thoát trận về chờ đấu' : 'Thoát panel nhập điểm'}
        >
          <X size={18} />
        </button>
      </div>

      {isReviewingFinished ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          Trận đã chốt. Có thể reset nếu cần nhập lại kết quả.
        </div>
      ) : hasSavedSetScores(match.id) ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          Trận đã có điểm séc. Muốn bấm X để trả về chờ đấu, hãy reset điểm trước.
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 overflow-x-auto border-t border-zinc-200 pt-2 dark:border-zinc-800">
        <div className="flex min-w-max items-center gap-1.5">{renderSetInputs(match)}</div>
        <button
          type="button"
          onPointerDown={() => suppressBlurSaveMatchIdsRef.current.add(match.id)}
          onClick={() => handleResetMatch(match.id)}
          disabled={resetMatchScoreForReentry.isPending}
          className="inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
          aria-label="Reset điểm"
          title="Reset điểm"
        >
          <RotateCcw size={15} />
        </button>
      </div>
    </div>
    );
  };

  return (
    <div className="score-entry-viewport space-y-6">
      {(errorMsg || successMsg) && (
        <div className={`rounded-xl border px-4 py-3 text-xs font-bold ${
          errorMsg
            ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
        }`}>
          {errorMsg || successMsg}
        </div>
      )}

      <div className="score-entry-event-bar flex items-center gap-3 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
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

      <div className="score-entry-panels grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <section className="score-schedule-section overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-blue-600" />
              <h2 className="match-section-title font-black uppercase text-zinc-900 dark:text-zinc-100">Lịch đấu & kết quả mới nhất</h2>
            </div>
            <span className="text-[10px] font-bold text-zinc-500">{eventMatches.length} trận</span>
          </div>

          {eventMatches.length === 0 ? (
            <div className="py-20 text-center text-sm font-bold text-zinc-500">
              Chưa có lịch thi đấu. Hãy chia bảng và sinh lịch trước.
            </div>
          ) : (
            <div className="score-schedule-scroll grid max-h-[calc(100vh-230px)] grid-cols-1 gap-2 overflow-y-auto p-2.5">
              {eventMatches.map((match, index) => {
                const teamA = getTeamName(match, 'A');
                const teamB = getTeamName(match, 'B');
                const isActive = activeMatchId === match.id;
                const actionLabel = match.status === 'finished' ? 'Xem' : match.status === 'playing' ? 'Đang đấu' : 'Chờ';
                const maxSetCount = getMatchMaxSetCount(match);
                const setNumbers = ([1, 2, 3] as const).slice(0, maxSetCount);

                return (
                  <article
                    key={match.id}
                    className={`rounded-lg border p-2.5 transition-colors ${
                      isActive
                        ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/25'
                        : 'border-zinc-200 bg-white hover:border-blue-200 hover:bg-blue-50/40 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-900 dark:hover:bg-blue-950/15'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-zinc-900 px-1.5 text-[10px] font-black text-white dark:bg-zinc-100 dark:text-zinc-950">
                            {index + 1}
                          </span>
                          <span className="match-group-title rounded-full border border-zinc-200 px-2 py-0.5 font-black uppercase text-zinc-500 dark:border-zinc-800">
                            {getGroupLabel(match)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenMatch(match)}
                        disabled={!isPermitted || updateMatchStatus.isPending}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-black disabled:cursor-not-allowed disabled:opacity-50 ${
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

                    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(58px,84px)] items-center gap-2 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-950 max-sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                      <p className="match-team-name min-w-0 whitespace-normal break-words font-black leading-tight text-zinc-900 dark:text-zinc-100" title={teamA}>{teamA}</p>
                      <span className="text-[10px] font-black text-zinc-400">VS</span>
                      <p className="match-team-name min-w-0 whitespace-normal break-words text-right font-black leading-tight text-zinc-900 dark:text-zinc-100" title={teamB}>{teamB}</p>
                      <div className="grid gap-1 max-sm:col-span-3">
                      {maxSetCount === 1 ? (
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg border border-zinc-100 px-2 py-1 text-xs dark:border-zinc-800">
                          <span className="match-score-value rounded bg-blue-50 px-2 py-1 text-center font-mono font-black text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                            {getSetCell(match, 1, 'A') || '-'}
                          </span>
                          <span className="text-zinc-300">-</span>
                          <span className="match-score-value rounded bg-blue-50 px-2 py-1 text-center font-mono font-black text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                            {getSetCell(match, 1, 'B') || '-'}
                          </span>
                        </div>
                      ) : (
                        setNumbers.map((setNumber) => (
                          <div key={setNumber} className="grid grid-cols-[42px_1fr_auto_1fr] items-center gap-1.5 rounded-lg border border-zinc-100 px-2 py-1 text-xs dark:border-zinc-800">
                            <span className="match-group-title font-black uppercase text-zinc-500">Séc {setNumber}</span>
                            <span className="match-score-value rounded bg-blue-50 px-2 py-1 text-center font-mono font-black text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                              {getSetCell(match, setNumber, 'A') || '-'}
                            </span>
                            <span className="text-zinc-300">-</span>
                            <span className="match-score-value rounded bg-blue-50 px-2 py-1 text-center font-mono font-black text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                              {getSetCell(match, setNumber, 'B') || '-'}
                            </span>
                          </div>
                        ))
                      )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="score-live-section rounded-xl border border-zinc-200 bg-zinc-50 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/40">
          {!isPermitted ? (
            <div className="score-live-empty flex min-h-[420px] flex-col items-center justify-center p-8 text-center text-zinc-500">
              <Play size={40} className="mb-4 opacity-30" />
              <p className="text-sm font-black uppercase text-zinc-700 dark:text-zinc-300">Không có quyền nhập điểm</p>
              <p className="mt-2 text-xs font-medium">Tài khoản hiện tại chưa được phân công nhập điểm cho nội dung này.</p>
            </div>
          ) : panelMatches.length === 0 ? (
            <div className="score-live-empty flex min-h-[420px] flex-col items-center justify-center p-8 text-center text-zinc-500">
              <Play size={40} className="mb-4 opacity-30" />
              <p className="text-sm font-black uppercase text-zinc-700 dark:text-zinc-300">Chưa có trận đang đấu</p>
              <p className="mt-2 text-xs font-medium">Bấm Chờ để đưa trận lên panel và chuyển trạng thái đang đấu.</p>
            </div>
          ) : (
            <div className="score-live-content space-y-3 p-3">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
                <div>
                  <p className="match-section-title font-black uppercase text-zinc-900 dark:text-zinc-100">
                    {reviewMatch ? 'Trận đang đấu / xem lại' : 'Trận đang đấu'}
                  </p>
                </div>
                <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-blue-600 px-2 text-[13px] font-black text-white">{panelMatches.length}</span>
              </div>
              <div className="score-live-scroll max-h-[calc(100vh-230px)] space-y-2 overflow-y-auto pr-1">
                {panelMatches.map(renderPlayingMatchPanel)}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
