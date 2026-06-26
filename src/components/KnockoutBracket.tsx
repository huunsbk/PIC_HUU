/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useTournamentStore } from '../store';
import { useTeams } from '../hooks/useTeams';
import { useGroups } from '../hooks/useGroups';
import { useMatches } from '../hooks/useMatches';
import { useTournamentRpcMutations } from '../hooks/useTournamentRpcMutations';
import { isUsableEventId, useEvents } from '../hooks/useEvents';
import { useMatchSets } from '../hooks/useMatchSets';
import { Trophy, PlayCircle, HelpCircle, AlertTriangle, ZoomIn, ZoomOut, Maximize, Trash2 } from 'lucide-react';
import { getReadableTeamName, getReadableKoMatchName, calculateGroupStandings, calculateBestThirdPlaces, getBracketDisplayName } from '../utils/tournamentEngine';
import { attachMatchSets, getResolvedTeamName, getSeedLabel } from '../utils/scoreDisplay';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

export default function KnockoutBracket() {
  const {
    tournament,
    generateKnockoutBracket,
    updateKnockoutScore,
    updateKnockoutParticipant,
    propagateKnockoutResets,
    addLog,
    hasPermission,
    currentEventId,
  } = useTournamentStore();

  const { data: teamsData = [] } = useTeams();
  const { data: groupsData = [] } = useGroups();
  const { data: matchesData = [] } = useMatches();
  const { data: matchSetsData = [] } = useMatchSets();
  const { data: eventsData = [] } = useEvents();
  const selectedEventId = isUsableEventId(currentEventId) && eventsData.some((event) => event.id === currentEventId)
    ? currentEventId
    : eventsData[0]?.id;
  const {
    prepare_knockout_candidates_v1,
    confirm_knockout_teams_v1,
    generate_knockout_bracket_v1,
    clear_knockout_bracket_v1,
  } = useTournamentRpcMutations();

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

  const matches = React.useMemo(() => attachMatchSets(matchesData as any[], matchSetsData), [matchesData, matchSetsData]);

  const canManage = hasPermission("manage_matches");

  const [sz, setSz] = useState<4 | 8 | 16 | 32>(4);
  const [showClearConfirmModal, setShowClearConfirmModal] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [matchesSnapshot, setMatchesSnapshot] = useState<any[]>([]);
  const [numBestThirds, setNumBestThirds] = useState<number>(3);
  const [topPerGroup, setTopPerGroup] = useState<number>(2);
  const [excludeBottomResults, setExcludeBottomResults] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [koCandidates, setKoCandidates] = useState<any[]>([]);

  // States nâng cấp cho chế độ chỉnh sửa thủ công và hiển thị thông báo
  const [draftMatches, setDraftMatches] = useState<any[]>([]);
  const [draftNumBestThirds, setDraftNumBestThirds] = useState<number>(3);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Sync numBestThirds when tournament settings load
  useEffect(() => {
    if (tournament?.settings?.numBestThirds !== undefined) {
      setNumBestThirds(tournament.settings.numBestThirds);
    }
  }, [tournament?.settings?.numBestThirds]);

  // Lấy danh sách đội thi đấu để làm dropdown chọn đội đi tiếp
  const teamList = Object.values(teams);
  const teamNames = teamList.map((t) => t.name);

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

  // Compute standings for qualified teams in edit mode
  const groupStandingsMap: Record<string, { standings: any[], isFinished: boolean }> = {};
  const groupNamesMap: Record<string, string> = {};

  Object.values(groups).forEach((g) => {
    const gMatchs = matches.filter((m) => m.groupId === g.id);
    const isFinished = gMatchs.length > 0 && gMatchs.every((m) => m.status === 'finished');
    if (gMatchs.length > 0) {
      const stds = calculateGroupStandings(g.id, g.teamIds, gMatchs, teams, tournament.settings);
      groupStandingsMap[g.id] = { standings: (stds as any).ranking || stds, isFinished };
    } else {
      groupStandingsMap[g.id] = { standings: [], isFinished: false };
    }
    groupNamesMap[g.id] = g.name;
  });

  const allGroupsFinished = Object.values(groupStandingsMap).length > 0 && Object.values(groupStandingsMap).every(g => g.isFinished);
  
  const stdsOnlyMap = Object.fromEntries(Object.entries(groupStandingsMap).map(([k, v]) => [k, v.standings]));
  const calculatedBestThirds = calculateBestThirdPlaces(stdsOnlyMap as any, matches, tournament.settings, groupNamesMap);

  const sortedGroups = Object.values(groups).sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
  const firstPlaceSlots = sortedGroups.map(g => ({ key: `__1st_${g.id}`, label: `Hạng 1 Bảng ${g.name.replace(/^Bảng\s+/i, '')}` }));
  const secondPlaceSlots = sortedGroups.map(g => ({ key: `__2nd_${g.id}`, label: `Hạng 2 Bảng ${g.name.replace(/^Bảng\s+/i, '')}` }));
  
  const currentNumBestThirds = isEditMode ? draftNumBestThirds : numBestThirds;
  const thirdPlaceSlots = Array.from({length: currentNumBestThirds}).map((_, i) => ({ key: `__3rd_${i+1}`, label: `Hạng 3 xuất sắc ${i+1}` }));

  const finishedGroupTeamNames: string[] = [];
  Object.values(groups).forEach(g => {
    if (groupStandingsMap[g.id]?.isFinished) {
      finishedGroupTeamNames.push(...g.teamIds.map(tid => teams[tid]?.name));
    }
  });

  // Web helper to resolve a team ID from a slot key or standard team ID
  const getTeamIdOfSlot = (slotKey: string): string | null => {
    if (!slotKey) return null;
    if (slotKey.startsWith('__1st_')) {
      const gid = slotKey.replace('__1st_', '');
      const groupInfo = groupStandingsMap[gid];
      if (groupInfo?.isFinished && groupInfo.standings[0]) {
        return groupInfo.standings[0].teamId;
      }
      return null;
    }
    if (slotKey.startsWith('__2nd_')) {
      const gid = slotKey.replace('__2nd_', '');
      const groupInfo = groupStandingsMap[gid];
      if (groupInfo?.isFinished && groupInfo.standings[1]) {
        return groupInfo.standings[1].teamId;
      }
      return null;
    }
    if (slotKey.startsWith('__3rd_')) {
      const rank = parseInt(slotKey.replace('__3rd_', ''), 10);
      if (allGroupsFinished && calculatedBestThirds[rank - 1]) {
        return calculatedBestThirds[rank - 1].teamId;
      }
      return null;
    }
    if (teams[slotKey]) return slotKey;
    const foundTeam = Object.values(teams).find(t => t.name === slotKey || t.id === slotKey);
    if (foundTeam) return foundTeam.id;
    return null;
  };

  const placedSlotKeys = new Set<string>();
  const placedRealTeamIds = new Set<string>();
  const placedLabels = new Set<string>();

  koMatches.forEach(m => {
    if (m.teamAId && typeof m.teamAId === 'string') {
      const val = m.teamAId.trim();
      if (val.startsWith('__')) {
        placedSlotKeys.add(val);
      } else {
        placedRealTeamIds.add(val);
        const resolvedId = getTeamIdOfSlot(val);
        if (resolvedId) {
          placedRealTeamIds.add(resolvedId);
        }
      }
      placedLabels.add(val);
    }
    if (m.teamBId && typeof m.teamBId === 'string') {
      const val = m.teamBId.trim();
      if (val.startsWith('__')) {
        placedSlotKeys.add(val);
      } else {
        placedRealTeamIds.add(val);
        const resolvedId = getTeamIdOfSlot(val);
        if (resolvedId) {
          placedRealTeamIds.add(resolvedId);
        }
      }
      placedLabels.add(val);
    }
  });

  const isSlotUsed = (slotKey: string, slotLabel?: string) => {
    if (placedSlotKeys.has(slotKey)) return true;
    if (slotLabel && (placedSlotKeys.has(slotLabel) || placedRealTeamIds.has(slotLabel) || placedLabels.has(slotLabel))) {
      return true;
    }
    const resolvedId = getTeamIdOfSlot(slotKey);
    if (resolvedId && (placedRealTeamIds.has(resolvedId) || placedLabels.has(resolvedId))) return true;
    return false;
  };

  const resolveSlotName = (slotKey: string) => {
    if (!slotKey) return '';
    if (teams[slotKey]) return teams[slotKey].name;
    const foundTeam = Object.values(teams).find(t => t.id === slotKey || t.name === slotKey);
    if (foundTeam) return foundTeam.name;

    return getBracketDisplayName(slotKey, groups);
  };

  const getKoParticipantLines = (m: any, slot: 'A' | 'B') => {
    const teamId = slot === 'A' ? m.teamAId : m.teamBId;
    const placeholder = slot === 'A' ? m.placeholderA : m.placeholderB;
    if (teamId === '') return { primary: '[TRỐNG]', secondary: '' };

    const fallback = teamId ? resolveSlotName(teamId) : (placeholder || 'Chờ...');
    const primary = getSeedLabel(m, slot, placeholder || fallback);
    const resolvedName = getResolvedTeamName(m, slot, teams, teamId);
    const secondary = resolvedName && resolvedName !== primary ? resolvedName : '';

    return { primary: primary || fallback, secondary };
  };

  const findSlotKeyForPlaceholder = (placeholder: string): string | null => {
    if (!placeholder) return null;
    const cleanPlaceholder = placeholder.trim().toLowerCase();

    // 1. Check exact matches against configured place slots built from active groups
    const foundFirst = firstPlaceSlots.find(s => s.label.trim().toLowerCase() === cleanPlaceholder);
    if (foundFirst) return foundFirst.key;

    const foundSecond = secondPlaceSlots.find(s => s.label.trim().toLowerCase() === cleanPlaceholder);
    if (foundSecond) return foundSecond.key;

    const foundThird = thirdPlaceSlots.find(
      s => s.label.trim().toLowerCase() === cleanPlaceholder || 
           s.label.toLowerCase().replace('xs', 'xuất sắc') === cleanPlaceholder ||
           cleanPlaceholder.includes('hạng 3 xuất sắc ' + s.key.replace('__3rd_', '')) ||
           cleanPlaceholder.includes('hạng ba xuất sắc ' + s.key.replace('__3rd_', '')) ||
           cleanPlaceholder.includes('ba bảng xuất sắc ' + s.key.replace('__3rd_', '')) ||
           cleanPlaceholder.includes('ba xs ' + s.key.replace('__3rd_', ''))
    );
    if (foundThird) return foundThird.key;

    // 2. Fallback prefix parsing
    for (const g of Object.values(groups)) {
      const gNameClean = g.name.replace(/^Bảng\s+/i, '').trim().toLowerCase();
      
      const possible1stLabels = [
        `hạng 1 bảng ${gNameClean}`,
        `hạng 1 ${gNameClean}`,
        `hạng 1 bảng ${g.name.toLowerCase()}`,
        `nhất bảng ${gNameClean}`,
        `nhất ${gNameClean}`,
        `1st ${gNameClean}`,
        `nhất bảng ${g.name.toLowerCase()}`
      ];
      if (possible1stLabels.includes(cleanPlaceholder) || cleanPlaceholder.includes(`hạng 1 bảng ${gNameClean}`) || cleanPlaceholder.includes(`nhất bảng ${gNameClean}`)) {
        return `__1st_${g.id}`;
      }
      
      const possible2ndLabels = [
        `hạng 2 bảng ${gNameClean}`,
        `hạng 2 ${gNameClean}`,
        `hạng 2 bảng ${g.name.toLowerCase()}`,
        `nhì bảng ${gNameClean}`,
        `nhì ${gNameClean}`,
        `2nd ${gNameClean}`,
        `nhì bảng ${g.name.toLowerCase()}`
      ];
      if (possible2ndLabels.includes(cleanPlaceholder) || cleanPlaceholder.includes(`hạng 2 bảng ${gNameClean}`) || cleanPlaceholder.includes(`nhì bảng ${gNameClean}`)) {
        return `__2nd_${g.id}`;
      }
    }

    // 3. Last fallback: check if it's a real team name or ID
    const foundTeam = Object.values(teams).find(
      (t) => t.name.trim().toLowerCase() === cleanPlaceholder || t.id.toLowerCase() === cleanPlaceholder
    );
    if (foundTeam) return foundTeam.id;

    return null;
  };

  const handlePrepareCandidates = async () => {
    if (!selectedEventId) return;
    try {
      const result = await prepare_knockout_candidates_v1.mutateAsync({
        eventId: selectedEventId,
        topPerGroup,
        bestThirdCount: numBestThirds,
        excludeBottomResults,
      });
      setKoCandidates(result.candidates || []);
      setSuccessMessage(`Đã gợi ý ${result.candidate_count || result.candidates?.length || 0} đội vào vòng knockout.`);
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Không gợi ý được đội vào knockout.');
    }
  };

  const handleConfirmCandidates = async () => {
    if (!selectedEventId) return;
    if (koCandidates.length === 0) {
      setErrorMessage('Chưa có danh sách gợi ý để xác nhận.');
      return;
    }
    try {
      const selected = koCandidates.slice(0, sz).map((candidate, index) => ({
        team_id: candidate.team_id,
        seed: Number(candidate.suggested_seed || index + 1),
        source: candidate.source || 'admin',
        source_group_id: candidate.group_id,
        group_rank: candidate.group_rank,
        seed_label: candidate.seed_label,
        seed_source: candidate.seed_source,
        resolved_team_id: candidate.team_id,
      }));
      const result = await confirm_knockout_teams_v1.mutateAsync({
        eventId: selectedEventId,
        teams: selected,
        bracketSize: sz,
        overrideReason: overrideReason.trim() || null,
      });
      setSuccessMessage(`Đã xác nhận ${result.selected_count || selected.length} đội. BYE: ${result.bye_count || 0}.`);
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Không xác nhận được danh sách knockout.');
    }
  };

  const handleGenerateBracket = async () => {
    if (!selectedEventId) return;
    try {
      await generate_knockout_bracket_v1.mutateAsync(selectedEventId);
      setSuccessMessage('Đã tạo bracket knockout bằng RPC.');
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Không tạo được bracket knockout.');
    }
  };

  // Các hàm tiện ích bổ sung cho Draft State (Hiệu chỉnh thủ công an toàn)
  const propagateDraftResets = (changedMatchIds: string[], list: any[]) => {
    const matchesMap = new Map<string, any>();
    list.forEach((m) => {
      matchesMap.set(m.id, { ...m });
    });

    const queue = [...changedMatchIds];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const currentMatch = matchesMap.get(currentId);
      if (!currentMatch) continue;

      currentMatch.scoreA = null;
      currentMatch.scoreB = null;
      currentMatch.winnerId = null;
      currentMatch.status = 'pending';

      const nextId = currentMatch.nextMatchId;
      if (nextId) {
        const nextMatch = matchesMap.get(nextId);
        if (nextMatch) {
          const slot = currentMatch.nextMatchSlot || 'A';
          if (slot === 'A') {
            nextMatch.teamAId = null;
          } else {
            nextMatch.teamBId = null;
          }
          queue.push(nextId);
        }
      }
    }

    return Array.from(matchesMap.values());
  };

  const validateDraftMatches = (items: any[]) => {
    const round1Matches = items.filter(m => m.round === 1);
    const usedKeys = new Set<string>();
    let hasEmpty = false;
    let hasDuplicate = false;

    for (const m of round1Matches) {
      const valA = m.teamAId !== null && m.teamAId !== undefined ? String(m.teamAId).trim() : '';
      const valB = m.teamBId !== null && m.teamBId !== undefined ? String(m.teamBId).trim() : '';

      if (valA === '' || valB === '') {
        hasEmpty = true;
      }

      if (valA) {
        if (usedKeys.has(valA)) {
          hasDuplicate = true;
        }
        usedKeys.add(valA);
      }

      if (valB) {
        if (usedKeys.has(valB)) {
          hasDuplicate = true;
        }
        usedKeys.add(valB);
      }
    }

    return { hasEmpty, hasDuplicate };
  };

  const handleClearSlot = (matchId: string, slot: 'A' | 'B') => {
    setDraftMatches(prev => {
      const newList = prev.map(m => {
        if (m.id !== matchId) return m;
        const nextM = { ...m };
        if (slot === 'A') {
          nextM.teamAId = '';
        } else {
          nextM.teamBId = '';
        }
        nextM.scoreA = null;
        nextM.scoreB = null;
        nextM.winnerId = null;
        nextM.status = 'pending';
        return nextM;
      });

      return propagateDraftResets([matchId], newList);
    });
  };

  const handleDraftDrop = (matchId: string, slot: 'A' | 'B', teamId: string, sMatchId?: string, sSlot?: string) => {
    setDraftMatches(prev => {
      const targetMatch = prev.find(m => m.id === matchId);
      if (!targetMatch) return prev;

      const currentVal = (slot === 'A' ? targetMatch.teamAId : targetMatch.teamBId) || '';

      const updated = prev.map(m => {
        let updatedM = { ...m };
        let changed = false;

        if (m.id === matchId) {
          if (slot === 'A') {
            updatedM.teamAId = teamId;
          } else {
            updatedM.teamBId = teamId;
          }
          updatedM.scoreA = null;
          updatedM.scoreB = null;
          updatedM.winnerId = null;
          updatedM.status = 'pending';
          changed = true;
        }

        if (sMatchId && sSlot && m.id === sMatchId) {
          if (sSlot === 'A') {
            updatedM.teamAId = currentVal;
          } else {
            updatedM.teamBId = currentVal;
          }
          updatedM.scoreA = null;
          updatedM.scoreB = null;
          updatedM.winnerId = null;
          updatedM.status = 'pending';
          changed = true;
        }

        return changed ? updatedM : m;
      });

      const affectedIds = [matchId];
      if (sMatchId) affectedIds.push(sMatchId);
      return propagateDraftResets(affectedIds, updated);
    });
  };

  const handleToggleEditMode = () => {
    if (!canManage) return;
    if (!isEditMode) {
      let initialMatches = matches.filter((m) => m.groupId === 'knockout');
      if (initialMatches.length === 0) {
        generateKnockoutBracket(sz);
        initialMatches = useTournamentStore.getState().matches.filter((m) => m.groupId === 'knockout');
      }

      // Clone koMatches into draftMatches
      let draftList = JSON.parse(JSON.stringify(initialMatches));

      // Auto populate any null/empty round 1 slots with their matching placeholder slot keys
      draftList = draftList.map((m: any) => {
        if (m.round === 1) {
          let updated = false;
          let teamAId = m.teamAId || '';
          let teamBId = m.teamBId || '';

          if (!teamAId && m.placeholderA) {
            const mappedA = findSlotKeyForPlaceholder(m.placeholderA);
            if (mappedA) {
              teamAId = mappedA;
              updated = true;
            }
          }
          if (!teamBId && m.placeholderB) {
            const mappedB = findSlotKeyForPlaceholder(m.placeholderB);
            if (mappedB) {
              teamBId = mappedB;
              updated = true;
            }
          }

          if (updated) {
            return {
              ...m,
              teamAId,
              teamBId,
              scoreA: null,
              scoreB: null,
              winnerId: null,
              status: 'pending'
            };
          }
        }
        return m;
      });

      setErrorMessage(null);
      setDraftMatches(draftList);
      setDraftNumBestThirds(tournament.settings.numBestThirds || 3);
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

  const handleConfirmSaveBracket = () => {
    const { hasEmpty, hasDuplicate } = validateDraftMatches(draftMatches);
    if (hasEmpty || hasDuplicate) {
      setErrorMessage("Còn vị trí chưa được gán đội hoặc biến.");
      return;
    }

    setErrorMessage(null);

    // Lưu sơ đồ thủ công xuống database thông qua action store
    const { updateKnockoutManualBracket } = useTournamentStore.getState();
    updateKnockoutManualBracket(draftMatches, draftNumBestThirds);

    // Hiển thị thông báo thành công đẹp mắt
    setSuccessMessage("✅ Tạo sơ đồ thành công\n✅ Đã cập nhật lịch thi đấu");
    setTimeout(() => {
      setSuccessMessage(null);
    }, 4500);

    setIsEditMode(false);
    setDraftMatches([]);
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
              ? "Sửa thủ công (Kéo thả): Kéo các đội hoặc các khe nhất/nhì/ba xuất sắc từ cột bên trái thả vào nhánh đấu ngoài cùng."
              : "Tự động đấu bốc thăm theo luật định hoặc chỉnh sửa thủ công để tinh chỉnh theo nhu cầu."}
          </p>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-3">
            {/* Chọn số đội (Quy mô nhánh đấu) - Chỉ hiện khi ở chế độ khoá */}
            {!isEditMode && (
              <div className="flex items-center gap-2 bg-zinc-55 dark:bg-zinc-950 p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase px-2 select-none">Quy mô:</span>
                <select
                  value={sz}
                  onChange={(e) => setSz(Number(e.target.value) as 4 | 8 | 16 | 32)}
                  className="px-2 py-1 border-none rounded-lg text-xs font-black text-zinc-800 dark:text-zinc-100 bg-transparent cursor-pointer outline-none focus:ring-0"
                >
                  <option value={4}>4 đội (Bán Kết - 2 bảng)</option>
                  <option value={8}>8 đội (Tứ Kết)</option>
                  <option value={16}>16 đội (Vòng 1/8)</option>
                  <option value={32}>32 đội (Vòng 1/16)</option>
                </select>
              </div>
            )}

            {!isEditMode && (
              <div className="flex items-center gap-2 bg-zinc-55 dark:bg-zinc-950 p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase px-2 select-none">Top/bảng</span>
                <input
                  type="number"
                  min={0}
                  max={8}
                  value={topPerGroup}
                  onChange={(e) => setTopPerGroup(Math.max(0, Number(e.target.value) || 0))}
                  className="w-14 px-2 py-1 border-none rounded-lg text-xs font-black text-zinc-800 dark:text-zinc-100 bg-transparent outline-none"
                />
              </div>
            )}

            {!isEditMode && (
              <label className="flex items-center gap-1.5 text-[10px] font-black text-zinc-500 uppercase">
                <input
                  type="checkbox"
                  checked={excludeBottomResults}
                  onChange={(e) => setExcludeBottomResults(e.target.checked)}
                />
                Trừ đội cuối bảng
              </label>
            )}

            {!isEditMode && (
              <input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Lý do override nếu có"
                className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-xs font-semibold text-zinc-700 dark:text-zinc-200"
              />
            )}

            {!isEditMode && (
              <button
                onClick={handlePrepareCandidates}
                disabled={prepare_knockout_candidates_v1.isPending}
                className="px-5 py-3 bg-amber-500 hover:bg-amber-400 text-white font-black rounded-xl text-xs transition-all flex items-center gap-2 shadow-md uppercase tracking-wider cursor-pointer disabled:opacity-50"
              >
                Gợi ý đội vào KO
              </button>
            )}

            {!isEditMode && (
              <button
                onClick={handleConfirmCandidates}
                disabled={confirm_knockout_teams_v1.isPending || koCandidates.length === 0}
                className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-xs transition-all flex items-center gap-2 shadow-md uppercase tracking-wider cursor-pointer disabled:opacity-50"
              >
                Xác nhận đội KO
              </button>
            )}

            {/* Nút 1: Tạo nhánh tự động (Chỉ hiện khi isEditMode là false) */}
            {!isEditMode && (
              <button
                onClick={() => {
                  if (koMatches.length > 0) {
                    setShowClearConfirmModal(true);
                  } else {
                    handleGenerateBracket();
                  }
                }}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-white font-black rounded-xl text-xs transition-all flex items-center gap-2 shadow-md uppercase tracking-wider cursor-pointer"
                id="btn-generate-knockout"
              >
                <PlayCircle size={16} /> Tạo bracket RPC
              </button>
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
            {!isEditMode && (
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

      {koCandidates.length > 0 && !isEditMode && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h4 className="text-sm font-black text-zinc-900 dark:text-zinc-100 uppercase">Danh sách gợi ý vào knockout</h4>
            <span className="text-[10px] font-black text-zinc-500">Bracket {sz}, BYE dự kiến {Math.max(0, sz - koCandidates.slice(0, sz).length)}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
            {koCandidates.slice(0, sz).map((candidate, index) => (
              <div key={`${candidate.team_id}-${index}`} className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 text-xs bg-zinc-50 dark:bg-zinc-950">
                <div className="font-black text-zinc-900 dark:text-zinc-100 truncate">{candidate.suggested_seed || index + 1}. {candidate.team_name}</div>
                <div className="text-[10px] text-zinc-500 font-bold mt-1">
                  {candidate.group_name || 'KO'} · Hạng {candidate.group_rank || '-'} · {candidate.source || 'group_rank'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                  <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest text-center">Số suất Hạng 3</span>
                  <input 
                    type="number" 
                    min="0" max="16" 
                    className="w-full px-3 py-2 text-sm font-bold border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-center"
                    value={draftNumBestThirds} 
                    onChange={(e) => setDraftNumBestThirds(Number(e.target.value) || 0)} 
                  />
                </div>
              </div>

              {/* Lists */}
              <div className="flex-1 space-y-6">
                {/* Hạng 1 Bảng */}
                <div className="space-y-3">
                  <div className="text-[11px] font-black uppercase text-amber-600 bg-amber-50 dark:bg-amber-950/40 text-center py-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 shadow-sm">Nhóm Hạng 1 Bảng</div>
                  <div className="flex flex-col gap-2">
                    {firstPlaceSlots.filter(s => !isSlotUsed(s.key, s.label)).map((slot) => (
                      <div 
                        key={slot.key}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', slot.key)}
                        className="px-4 py-3 bg-white dark:bg-zinc-800 rounded-xl text-xs font-bold cursor-move border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 hover:shadow-md hover:-translate-y-0.5 transition-all text-center"
                      >
                        {slot.label}
                      </div>
                    ))}
                    {firstPlaceSlots.filter(s => !isSlotUsed(s.key, s.label)).length === 0 && <div className="text-xs text-zinc-400 text-center py-4 italic font-medium bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">Hết / Đã xếp xong</div>}
                  </div>
                </div>
                
                {/* Hạng 2 Bảng */}
                <div className="space-y-3">
                  <div className="text-[11px] font-black uppercase text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/80 text-center py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">Nhóm Hạng 2 Bảng</div>
                  <div className="flex flex-col gap-2">
                    {secondPlaceSlots.filter(s => !isSlotUsed(s.key, s.label)).map((slot) => (
                      <div 
                        key={slot.key}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', slot.key)}
                        className="px-4 py-3 bg-white dark:bg-zinc-800 rounded-xl text-xs font-bold cursor-move border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 hover:shadow-md hover:-translate-y-0.5 transition-all text-center"
                      >
                        {slot.label}
                      </div>
                    ))}
                    {secondPlaceSlots.filter(s => !isSlotUsed(s.key, s.label)).length === 0 && <div className="text-xs text-zinc-400 text-center py-4 italic font-medium bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">Hết / Đã xếp xong</div>}
                  </div>
                </div>

                {/* Hạng 3 Xuất Sắc */}
                <div className="space-y-3">
                  <div className="text-[11px] font-black uppercase text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-center py-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900/50 shadow-sm">Nhóm Hạng 3 Xuất Sắc</div>
                  <div className="flex flex-col gap-2">
                    {thirdPlaceSlots.filter(s => !isSlotUsed(s.key, s.label)).map((slot) => (
                      <div 
                        key={slot.key}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', slot.key)}
                        className="px-4 py-3 bg-white dark:bg-zinc-800 rounded-xl text-xs font-bold cursor-move border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 hover:shadow-md hover:-translate-y-0.5 transition-all text-center"
                      >
                        {slot.label}
                      </div>
                    ))}
                    {thirdPlaceSlots.filter(s => !isSlotUsed(s.key, s.label)).length === 0 && <div className="text-xs text-zinc-400 text-center py-4 italic font-medium bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">Hết / Đã xếp xong</div>}
                  </div>
                </div>

                {/* Danh Sách Đội Tuyển Đánh Đồng Bộ */}
                <div className="space-y-3">
                  <div className="text-[11px] font-black uppercase text-blue-600 bg-blue-50 dark:bg-blue-950/40 text-center py-2.5 rounded-lg border border-blue-200 dark:border-blue-900/50 shadow-sm font-extrabold">Đội tuyển đơn lẻ</div>
                  <div className="flex flex-col gap-2">
                    {teamList.filter(t => !placedRealTeamIds.has(t.id) && !placedRealTeamIds.has(t.name) && !placedSlotKeys.has(t.id)).map((t) => (
                      <div 
                        key={t.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                        className="px-4 py-3 bg-white dark:bg-zinc-800 rounded-xl text-xs font-bold cursor-move border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 hover:shadow-md hover:-translate-y-0.5 transition-all text-center"
                      >
                        {t.name}
                      </div>
                    ))}
                    {teamList.filter(t => !placedRealTeamIds.has(t.id) && !placedRealTeamIds.has(t.name) && !placedSlotKeys.has(t.id)).length === 0 && (
                      <div className="text-xs text-zinc-400 text-center py-4 italic font-medium bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">Không còn đội dự phòng</div>
                    )}
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
                              {/* Hàng Đội A (Hạt giống) */}
                              <div className="flex items-center justify-between gap-3" style={(m.id === 'ko-QF1-ww7imxn' || m.id === 'ko-QF2-3f2hlbu') ? { marginBottom: '0px' } : undefined}>
                                <div className="flex items-center gap-1.5 truncate max-w-[210px] sm:max-w-[250px]">
                                  {!isFinished && m.round === 1 ? (
                                    isEditMode ? (
                                      <div className="relative group/slot w-full">
                                        <div
                                          draggable={!!m.teamAId}
                                          onDragStart={(e) => {
                                            if (m.teamAId) {
                                              e.dataTransfer.setData('text/plain', m.teamAId);
                                              e.dataTransfer.setData('sourceMatchId', m.id);
                                              e.dataTransfer.setData('sourceSlot', 'A');
                                            }
                                          }}
                                          onDragOver={(e) => { e.preventDefault(); }}
                                          onDrop={(e) => {
                                            e.preventDefault();
                                            const teamId = e.dataTransfer.getData('text/plain');
                                            const sMatchId = e.dataTransfer.getData('sourceMatchId');
                                            const sSlot = e.dataTransfer.getData('sourceSlot');
                                            
                                            if (teamId) {
                                              handleDraftDrop(m.id, 'A', teamId, sMatchId, sSlot);
                                            }
                                          }}
                                          className={`font-black flex items-center justify-between rounded-lg border-2 bg-white dark:bg-zinc-900 text-xs min-w-[200px] h-10 transition-all ${
                                            m.teamAId === ''
                                              ? 'border-dashed border-red-350 dark:border-red-900 bg-red-50/10'
                                              : 'border-dashed border-zinc-400 dark:border-zinc-700 hover:border-blue-500 hover:bg-blue-50/10 cursor-grab active:cursor-grabbing'
                                          }`}
                                        >
                                          <span className={`px-2.5 py-1.5 truncate max-w-[170px] ${m.teamAId === '' ? 'text-red-500 font-extrabold' : 'text-zinc-900 dark:text-zinc-100'}`}>
                                            {m.teamAId === '' ? '[TRỐNG]' : (m.teamAId ? resolveSlotName(m.teamAId) : (m.placeholderA || 'Thả đội vào đây'))}
                                          </span>
                                        </div>
                                        {m.teamAId && (
                                          <button 
                                            title="Gỡ đội"
                                            onClick={() => handleClearSlot(m.id, 'A')} 
                                            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-650 text-white rounded-full flex items-center justify-center text-[10px] font-black shadow-md border border-white dark:border-zinc-950 hover:scale-110 active:scale-95 transition-all cursor-pointer z-10"
                                          >
                                            ✕
                                          </button>
                                        )}
                                      </div>
                                    ) : (() => {
                                      const lines = getKoParticipantLines(m, 'A');
                                      return (
                                        <div
                                          className={`max-w-[190px] sm:max-w-[230px] ${
                                            m.teamAId === '' ? 'text-red-500 dark:text-red-400 italic' : 'text-zinc-800 dark:text-zinc-200'
                                          }`}
                                          title={`${lines.primary}${lines.secondary ? ` - ${lines.secondary}` : ''}`}
                                        >
                                          <span className={`font-black text-xs sm:text-sm truncate block ${isFinished && m.winnerId === m.teamAId ? 'text-blue-600 dark:text-blue-400 underline decoration-2' : ''}`}>
                                            {lines.primary}
                                          </span>
                                          {lines.secondary && <span className="block truncate text-[10px] font-bold text-zinc-500 dark:text-zinc-400">{lines.secondary}</span>}
                                        </div>
                                      );
                                    })()
                                  ) : (() => {
                                    const lines = getKoParticipantLines(m, 'A');
                                    return (
                                      <div
                                        className={`max-w-[190px] sm:max-w-[230px] ${
                                          m.teamAId === '' ? 'text-red-500 dark:text-red-400 italic' : 'text-zinc-800 dark:text-zinc-200'
                                        }`}
                                        title={`${lines.primary}${lines.secondary ? ` - ${lines.secondary}` : ''}`}
                                      >
                                        <span className={`font-black text-xs sm:text-sm truncate block ${isFinished && m.winnerId === m.teamAId ? 'text-blue-600 dark:text-blue-400 underline decoration-2' : ''}`}>
                                          {lines.primary}
                                        </span>
                                        {lines.secondary && <span className="block truncate text-[10px] font-bold text-zinc-500 dark:text-zinc-400">{lines.secondary}</span>}
                                      </div>
                                    );
                                  })()}
                                </div>
                                
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  placeholder=""
                                  value={localScores[m.id]?.scoreA ?? ''}
                                  onChange={(e) => handleScoreInputChange(m.id, 'A', e.target.value)}
                                  disabled={!canManage}
                                  className="w-12 h-9 border border-zinc-250 dark:border-zinc-800 rounded-xl text-center font-bold text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                  id={`input-ko-match-${m.id}-scoreA`}
                                />
                              </div>

                              {/* Hàng Đội B */}
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-1.5 truncate max-w-[210px] sm:max-w-[250px]">
                                  {!isFinished && m.round === 1 ? (
                                    isEditMode ? (
                                      <div className="relative group/slot w-full">
                                        <div
                                          draggable={!!m.teamBId}
                                          onDragStart={(e) => {
                                            if (m.teamBId) {
                                              e.dataTransfer.setData('text/plain', m.teamBId);
                                              e.dataTransfer.setData('sourceMatchId', m.id);
                                              e.dataTransfer.setData('sourceSlot', 'B');
                                            }
                                          }}
                                          onDragOver={(e) => { e.preventDefault(); }}
                                          onDrop={(e) => {
                                            e.preventDefault();
                                            const teamId = e.dataTransfer.getData('text/plain');
                                            const sMatchId = e.dataTransfer.getData('sourceMatchId');
                                            const sSlot = e.dataTransfer.getData('sourceSlot');
                                            
                                            if (teamId) {
                                              handleDraftDrop(m.id, 'B', teamId, sMatchId, sSlot);
                                            }
                                          }}
                                          className={`font-black flex items-center justify-between rounded-lg border-2 bg-white dark:bg-zinc-900 text-xs min-w-[200px] h-10 transition-all ${
                                            m.teamBId === ''
                                              ? 'border-dashed border-red-350 dark:border-red-900 bg-red-50/10'
                                              : 'border-dashed border-zinc-400 dark:border-zinc-700 hover:border-blue-500 hover:bg-blue-50/10 cursor-grab active:cursor-grabbing'
                                          }`}
                                        >
                                          <span className={`px-2.5 py-1.5 truncate max-w-[170px] ${m.teamBId === '' ? 'text-red-500 font-extrabold' : 'text-zinc-900 dark:text-zinc-100'}`}>
                                            {m.teamBId === '' ? '[TRỐNG]' : (m.teamBId ? resolveSlotName(m.teamBId) : (m.placeholderB || 'Thả đội vào đây'))}
                                          </span>
                                        </div>
                                        {m.teamBId && (
                                          <button 
                                            title="Gỡ đội"
                                            onClick={() => handleClearSlot(m.id, 'B')} 
                                            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-650 text-white rounded-full flex items-center justify-center text-[10px] font-black shadow-md border border-white dark:border-zinc-950 hover:scale-110 active:scale-95 transition-all cursor-pointer z-10"
                                          >
                                            ✕
                                          </button>
                                        )}
                                      </div>
                                    ) : (() => {
                                      const lines = getKoParticipantLines(m, 'B');
                                      return (
                                        <div
                                          className={`max-w-[190px] sm:max-w-[230px] ${
                                            m.teamBId === '' ? 'text-red-500 dark:text-red-400 italic' : 'text-zinc-800 dark:text-zinc-200'
                                          }`}
                                          title={`${lines.primary}${lines.secondary ? ` - ${lines.secondary}` : ''}`}
                                        >
                                          <span className={`font-black text-xs sm:text-sm truncate block ${isFinished && m.winnerId === m.teamBId ? 'text-blue-600 dark:text-blue-400 underline decoration-2' : ''}`}>
                                            {lines.primary}
                                          </span>
                                          {lines.secondary && <span className="block truncate text-[10px] font-bold text-zinc-500 dark:text-zinc-400">{lines.secondary}</span>}
                                        </div>
                                      );
                                    })()
                                  ) : (() => {
                                    const lines = getKoParticipantLines(m, 'B');
                                    return (
                                      <div
                                        className={`max-w-[190px] sm:max-w-[230px] ${
                                          m.teamBId === '' ? 'text-red-500 dark:text-red-400 italic' : 'text-zinc-800 dark:text-zinc-200'
                                        }`}
                                        title={`${lines.primary}${lines.secondary ? ` - ${lines.secondary}` : ''}`}
                                      >
                                        <span className={`font-black text-xs sm:text-sm truncate block ${isFinished && m.winnerId === m.teamBId ? 'text-blue-600 dark:text-blue-400 underline decoration-2' : ''}`}>
                                          {lines.primary}
                                        </span>
                                        {lines.secondary && <span className="block truncate text-[10px] font-bold text-zinc-500 dark:text-zinc-400">{lines.secondary}</span>}
                                      </div>
                                    );
                                  })()}
                                </div>

                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  placeholder=""
                                  value={localScores[m.id]?.scoreB ?? ''}
                                  onChange={(e) => handleScoreInputChange(m.id, 'B', e.target.value)}
                                  disabled={!canManage}
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
