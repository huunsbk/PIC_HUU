/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTournamentStore } from '../store';
import { Trophy, Users, Layers, Calendar, Play, Download, Upload, Trash2, Check, AlertCircle, MapPin, CalendarDays, Award, FileText, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useTeams } from '../hooks/useTeams';
import { useGroups } from '../hooks/useGroups';
import { useMatches } from '../hooks/useMatches';
import { useDashboardStats } from '../hooks/useDashboardStats';

export default function Dashboard() {
  const {
    tournament,
    teams,
    groups,
    matches,
    events,
    updateTournament,
    updateSettings,
    resetAll,
    addLog,
    supabaseConnected,
    supabaseSyncError,
    checkConnection,
    activeTenantId,
    activeTenantName,
  } = useTournamentStore();

  const [name, setName] = useState(tournament.name);
  const [org, setOrg] = useState(tournament.organization);
  const [loc, setLoc] = useState(tournament.location);
  const [date, setDate] = useState(tournament.date);
  
  const [winPt, setWinPt] = useState(tournament.settings.winPoint);
  const [lossPt, setLossPt] = useState(tournament.settings.lossPoint);
  const [maxSc, setMaxSc] = useState(tournament.settings.maxScore);
  const [capSc, setCapSc] = useState(tournament.settings.capScore);
  const [advCount, setAdvCount] = useState(tournament.settings.advanceCount);
  const isTenantWorkspace = activeTenantId !== 'default';
  const lockedOrganizationName = activeTenantName || tournament.organization || '';

  React.useEffect(() => {
    if (isTenantWorkspace && lockedOrganizationName && org !== lockedOrganizationName) {
      setOrg(lockedOrganizationName);
    }
  }, [isTenantWorkspace, lockedOrganizationName, org]);

  React.useEffect(() => {
    setWinPt(tournament.settings.winPoint);
    setLossPt(tournament.settings.lossPoint);
    setMaxSc(tournament.settings.maxScore);
    setCapSc(tournament.settings.capScore);
    setAdvCount(tournament.settings.advanceCount);
  }, [
    tournament.settings.winPoint,
    tournament.settings.lossPoint,
    tournament.settings.maxScore,
    tournament.settings.capScore,
    tournament.settings.advanceCount,
  ]);

  // States for custom modals & backups
  const [jsonInput, setJsonInput] = useState('');
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isCheckingConn, setIsCheckingConn] = useState(false);
  const teamsQuery = useTeams();
  const groupsQuery = useGroups();
  const matchesQuery = useMatches();
  const statsQuery = useDashboardStats();

  // Check connection once on mount
  React.useEffect(() => {
    checkConnection();
  }, []);

  const handleManualCheck = async () => {
    if (isCheckingConn) return;
    setIsCheckingConn(true);
    await checkConnection();
    setIsCheckingConn(false);
    showToast('Đã cập nhật trạng thái kết nối Supabase trực tuyến!');
  };

  const teamList = teamsQuery.isSuccess ? teamsQuery.data : Object.values(teams);
  const groupList = groupsQuery.isSuccess ? groupsQuery.data : Object.values(groups);
  const matchList = matchesQuery.isSuccess ? matchesQuery.data : matches;
  const totalTeams = teamList.length;
  const totalGroups = groupList.length;
  const groupMatches = matchList.filter((m) => m.groupId !== 'knockout');
  const totalMatches = groupMatches.length;
  const finishedMatches = groupMatches.filter((m) => m.status === 'finished').length;
  const directMatchesCount = matchList.filter((m) => m.groupId === 'knockout').length;

  // Tổng hợp thống kê của toàn giải đấu (tất cả cá nội dung)
  const eventList = Object.values(events || {});
  let fallbackTeamsAll = 0;
  let fallbackGroupsAll = 0;
  let fallbackMatchesAll = 0;
  let fallbackFinishedMatchesAll = 0;
  let fallbackDirectMatchesCountAll = 0;

  eventList.forEach((evt) => {
    fallbackTeamsAll += Object.keys(evt.teams || {}).length;
    fallbackGroupsAll += Object.keys(evt.groups || {}).length;
    
    const evtMatches = evt.matches || [];
    const evtGroupMatches = evtMatches.filter((m) => m.groupId !== 'knockout');
    fallbackMatchesAll += evtGroupMatches.length;
    fallbackFinishedMatchesAll += evtGroupMatches.filter((m) => m.status === 'finished').length;
    fallbackDirectMatchesCountAll += evtMatches.filter((m) => m.groupId === 'knockout').length;
  });

  const totalTeamsAll = statsQuery.data?.teamsAll ?? fallbackTeamsAll;
  const totalGroupsAll = statsQuery.data?.groupsAll ?? fallbackGroupsAll;
  const totalMatchesAll = statsQuery.data?.groupMatchesAll ?? fallbackMatchesAll;
  const finishedMatchesAll = statsQuery.data?.finishedGroupMatchesAll ?? fallbackFinishedMatchesAll;
  const directMatchesCountAll = statsQuery.data?.knockoutMatchesAll ?? fallbackDirectMatchesCountAll;

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateTournament({
        name,
        organization: isTenantWorkspace ? lockedOrganizationName || org : org,
        location: loc,
        date,
      });
      showToast('Đã lưu thông tin giải đấu thành công!');
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi cập nhật thông tin giải đấu.', 'error');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (Number(capSc) < Number(maxSc)) {
        showToast('Điểm Kịch Trần (Cap) phải lớn hơn hoặc bằng Set Chạm Đến.', 'error');
        return;
      }
      await updateSettings({
        winPoint: Number(winPt),
        lossPoint: Number(lossPt),
        maxScore: Number(maxSc),
        capScore: Number(capSc),
        advanceCount: Number(advCount),
      });
      showToast('Cập nhật luật chơi & cấu hình điểm số thành công!');
    } catch (err: any) {
      showToast(err.message || 'Lỗi khi cập nhật quy chế giải đấu.', 'error');
    }
  };

  const handleExportDataJson = () => {
    const storeState = useTournamentStore.getState();
    const backup = {
      version: '2.0',
      system: 'pickleball-tournament-system',
      exportedAt: new Date().toISOString(),
      tournament: storeState.tournament,
      teams: storeState.teams,
      groups: storeState.groups,
      matches: storeState.matches,
      logs: storeState.logs,
      events: storeState.events,
      currentEventId: storeState.currentEventId,
      darkMode: storeState.darkMode,
      selectedTab: storeState.selectedTab,
      activeGroupId: storeState.activeGroupId,
      advanceSelectionMode: storeState.advanceSelectionMode,
      manualQualifiedTeamIds: storeState.manualQualifiedTeamIds,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const sanitizedName = storeState.tournament.name.trim().toLowerCase()
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_');
    link.download = `${sanitizedName}-full-backup-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    addLog('Sao Lưu', 'Đã xuất toàn tệp JSON lưu trữ toàn bộ hệ thống giải đấu thành công (gồm tất cả nội dung, bảng, đội & lịch đấu).');
    showToast('Xuất tệp JSON lưu trữ hệ thống toàn vẹn thành công!');
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUploadedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value === '') return;
    if (e.target.files && e.target.files[0]) {
      handleUploadedFile(e.target.files[0]);
    }
  };

  const handleUploadedFile = (file: File) => {
    if (!file.name.endsWith('.json')) {
      showToast('Lỗi: Chỉ chấp nhận tệp định dạng .json');
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (text) {
        setJsonInput(text);
        showToast('Đã đọc tệp sao lưu .json thành công! Nhấn "Khôi Phục" để tiến hành cập nhật hệ thống.');
      }
    };
    reader.readAsText(file);
  };

    const handleImportJson = async () => {
    try {
      const parsed = JSON.parse(jsonInput);
      if (!parsed.tournament) {
        showToast('Cấu trúc mã JSON sao lưu không hợp chuẩn. Thiếu thông tin giải đấu.');
        return;
      }

      // 1. Tạo bản đồ tra cứu từ groupId -> eventId từ groups cũng như matches trong JSON
      const groupIdToEventIdMap = new Map<string, string>();
      
      const getTeamsArray = (teamsData: any): any[] => {
        if (!teamsData) return [];
        if (Array.isArray(teamsData)) return teamsData;
        return Object.values(teamsData);
      };

      const getGroupsArray = (groupsData: any): any[] => {
        if (!groupsData) return [];
        if (Array.isArray(groupsData)) return groupsData;
        return Object.values(groupsData);
      };

      // Điền bản đồ từ parsed.events
      if (parsed.events) {
        Object.keys(parsed.events).forEach(evtId => {
          const evt = parsed.events[evtId];
          if (evt) {
            const gps = getGroupsArray(evt.groups);
            gps.forEach((g: any) => {
              if (g && g.id) {
                groupIdToEventIdMap.set(g.id, evtId);
              }
            });
            if (evt.matches) {
              evt.matches.forEach((m: any) => {
                if (m && m.groupId && !groupIdToEventIdMap.has(m.groupId)) {
                  groupIdToEventIdMap.set(m.groupId, evtId);
                }
              });
            }
          }
        });
      }

      // Điền bản đồ từ root (fallback cho dữ liệu cũ)
      if (parsed.groups) {
        const rootGroups = getGroupsArray(parsed.groups);
        rootGroups.forEach((g: any) => {
          if (g && g.id) {
            groupIdToEventIdMap.set(g.id, parsed.currentEventId || 'event-default');
          }
        });
      }
      if (parsed.matches) {
        parsed.matches.forEach((m: any) => {
          if (m && m.groupId && !groupIdToEventIdMap.has(m.groupId)) {
            groupIdToEventIdMap.set(m.groupId, parsed.currentEventId || 'event-default');
          }
        });
      }

      // Hàm xác định eventId của một Team chuẩn xác
      const getTeamEventId = (t: any, loopEventId: string): string => {
        if (t.eventId) return t.eventId;
        if (t.event_id) return t.event_id;
        const gId = t.groupId || t.group_id;
        if (gId && groupIdToEventIdMap.has(gId)) {
          return groupIdToEventIdMap.get(gId)!;
        }
        return loopEventId || parsed.currentEventId || 'event-default';
      };

      // 2. Chuẩn hóa cấu trúc để ghi đè vào Local Zustand Store
      // Zustand cục bộ yêu cầu teams & groups lưu dạng { [id]: Object } để phục vụ hiển thị trực quan tức thì.
      const localEventsRecord: Record<string, any> = {};
      const eventsToUpsert: any[] = [];
      const teamsToUpsert: any[] = [];
      const groupsToUpsert: any[] = [];
      const matchesToUpsert: any[] = [];

      if (parsed.events) {
        Object.keys(parsed.events).forEach(evtId => {
          const evt = parsed.events[evtId];
          if (evt) {
            const normalizedTeamsObj: Record<string, any> = {};
            const normalizedGroupsObj: Record<string, any> = {};
            const matchesArr = Array.isArray(evt.matches) ? evt.matches : [];

            // Thu thập và chuyển đổi Teams từ Object/Array sang Record
            const tList = getTeamsArray(evt.teams);
            tList.forEach((t: any) => {
              if (t && t.id) {
                let finalGroupId = t.groupId !== undefined ? t.groupId : (t.group_id || null);
                if (finalGroupId && finalGroupId !== 'knockout' && !finalGroupId.endsWith(`-${evtId}`)) {
                  finalGroupId = `${finalGroupId}-${evtId}`;
                }

                const normTeam = {
                  id: t.id,
                  name: t.name,
                  groupId: finalGroupId,
                  seed: t.seed || 'none',
                };
                normalizedTeamsObj[t.id] = normTeam;

                // Thêm vào hàng đợi gửi Supabase
                teamsToUpsert.push({
                  id: t.id,
                  name: t.name,
                  group_id: normTeam.groupId,
                  seed: normTeam.seed,
                  event_id: getTeamEventId(t, evtId),
                  });
              }
            });

            // Thu thập và chuyển đổi Groups
            const gList = getGroupsArray(evt.groups);
            gList.forEach((g: any) => {
              if (g && g.id) {
                let finalGroupId = g.id;
                if (!finalGroupId.endsWith(`-${evtId}`)) {
                  finalGroupId = `${finalGroupId}-${evtId}`;
                }

                normalizedGroupsObj[finalGroupId] = {
                  id: finalGroupId,
                  name: g.name,
                  teamIds: Array.isArray(g.teamIds) ? g.teamIds : (Array.isArray(g.team_ids) ? g.team_ids : []),
                };

                // Thêm vào hàng đợi gửi Supabase
                groupsToUpsert.push({
                  id: finalGroupId,
                  name: g.name,
                  team_ids: normalizedGroupsObj[finalGroupId].teamIds,
                  event_id: evtId,
                  });
              }
            });

            // Thu thập Matches
            matchesArr.forEach((m: any) => {
              if (m && m.id) {
                matchesToUpsert.push({
                  id: m.id,
                  group_id: m.groupId !== undefined ? m.groupId : (m.group_id || null),
                  team_a_id: m.teamAId !== undefined ? m.teamAId : (m.team_a_id || null),
                  team_b_id: m.teamBId !== undefined ? m.teamBId : (m.team_b_id || null),
                  score_a: m.scoreA !== undefined && m.scoreA !== null ? m.scoreA : (m.score_a !== undefined && m.score_a !== null ? m.score_a : null),
                  score_b: m.scoreB !== undefined && m.scoreB !== null ? m.scoreB : (m.score_b !== undefined && m.score_b !== null ? m.score_b : null),
                  winner_id: m.winnerId !== undefined ? m.winnerId : (m.winner_id || null),
                  status: m.status || 'pending',
                  round: m.round,
                  knockout_round_name: m.knockoutRoundName !== undefined ? m.knockoutRoundName : (m.knockout_round_name || null),
                  knockout_match_id: m.knockoutMatchId !== undefined ? m.knockoutMatchId : (m.knockout_match_id || null),
                  next_match_id: m.nextMatchId !== undefined ? m.nextMatchId : (m.next_match_id || null),
                  next_match_slot: m.nextMatchSlot !== undefined ? m.nextMatchSlot : (m.next_match_slot || null),
                  event_id: evtId,
                  });
              }
            });

            // Tiêu chuẩn hóa activeGroupId cho event
            let activeGroupId = evt.activeGroupId !== undefined ? evt.activeGroupId : (evt.active_group_id || null);
            if (activeGroupId && activeGroupId !== 'knockout' && !activeGroupId.endsWith(`-${evtId}`)) {
              activeGroupId = `${activeGroupId}-${evtId}`;
            }

            // Đưa vào danh sách sự kiện cục bộ
            localEventsRecord[evtId] = {
              id: evt.id,
              name: evt.name,
              settings: evt.settings || parsed.tournament?.settings || {},
              activeGroupId: activeGroupId,
              advanceSelectionMode: evt.advanceSelectionMode || 'auto',
              manualQualifiedTeamIds: evt.manualQualifiedTeamIds || [],
              teams: normalizedTeamsObj,
              groups: normalizedGroupsObj,
              matches: matchesArr
            };

            // Thêm vào hàng đợi gửi Supabase
            eventsToUpsert.push({
              id: evt.id,
              name: evt.name,
              settings: evt.settings || parsed.tournament?.settings || {},
              active_group_id: activeGroupId,
              advance_selection_mode: evt.advanceSelectionMode || 'auto',
              manual_qualified_team_ids: evt.manualQualifiedTeamIds || [],
              });
          }
        });
      } else {
        // Fallback cho Tournament chỉ có 1 Event cũ
        const defEvtId = parsed.currentEventId || 'event-default';
        const normalizedTeamsObj: Record<string, any> = {};
        const normalizedGroupsObj: Record<string, any> = {};
        const matchesArr = Array.isArray(parsed.matches) ? parsed.matches : [];

        const tList = getTeamsArray(parsed.teams);
        tList.forEach((t: any) => {
          if (t && t.id) {
            let finalGroupId = t.groupId !== undefined ? t.groupId : (t.group_id || null);
            if (finalGroupId && finalGroupId !== 'knockout' && !finalGroupId.endsWith(`-${defEvtId}`)) {
              finalGroupId = `${finalGroupId}-${defEvtId}`;
            }

            const normTeam = {
              id: t.id,
              name: t.name,
              groupId: finalGroupId,
              seed: t.seed || 'none'
            };
            normalizedTeamsObj[t.id] = normTeam;

            teamsToUpsert.push({
              id: t.id,
              name: t.name,
              group_id: normTeam.groupId,
              seed: normTeam.seed,
              event_id: getTeamEventId(t, defEvtId),
              });
          }
        });

        const gList = getGroupsArray(parsed.groups);
        gList.forEach((g: any) => {
          if (g && g.id) {
            let finalGroupId = g.id;
            if (!finalGroupId.endsWith(`-${defEvtId}`)) {
              finalGroupId = `${finalGroupId}-${defEvtId}`;
            }

            normalizedGroupsObj[finalGroupId] = {
              id: finalGroupId,
              name: g.name,
              teamIds: Array.isArray(g.teamIds) ? g.teamIds : (Array.isArray(g.team_ids) ? g.team_ids : [])
            };

            groupsToUpsert.push({
              id: finalGroupId,
              name: g.name,
              team_ids: normalizedGroupsObj[finalGroupId].teamIds,
              event_id: defEvtId,
              });
          }
        });

        matchesArr.forEach((m: any) => {
          if (m && m.id) {
            matchesToUpsert.push({
              id: m.id,
              group_id: m.groupId !== undefined ? m.groupId : (m.group_id || null),
              team_a_id: m.teamAId !== undefined ? m.teamAId : (m.team_a_id || null),
              team_b_id: m.teamBId !== undefined ? m.teamBId : (m.team_b_id || null),
              score_a: m.scoreA !== undefined && m.scoreA !== null ? m.scoreA : (m.score_a !== undefined && m.score_a !== null ? m.score_a : null),
              score_b: m.scoreB !== undefined && m.scoreB !== null ? m.scoreB : (m.score_b !== undefined && m.score_b !== null ? m.score_b : null),
              winner_id: m.winnerId !== undefined ? m.winnerId : (m.winner_id || null),
              status: m.status || 'pending',
              round: m.round,
              knockout_round_name: m.knockoutRoundName !== undefined ? m.knockoutRoundName : (m.knockout_round_name || null),
              knockout_match_id: m.knockoutMatchId !== undefined ? m.knockoutMatchId : (m.knockout_match_id || null),
              next_match_id: m.nextMatchId !== undefined ? m.nextMatchId : (m.next_match_id || null),
              next_match_slot: m.nextMatchSlot !== undefined ? m.nextMatchSlot : (m.next_match_slot || null),
              event_id: defEvtId,
              });
          }
        });

        // Tiêu chuẩn hóa activeGroupId cho event mặc định
        let activeGroupId = parsed.activeGroupId || null;
        if (activeGroupId && activeGroupId !== 'knockout' && !activeGroupId.endsWith(`-${defEvtId}`)) {
          activeGroupId = `${activeGroupId}-${defEvtId}`;
        }

        // Tạo 1 event mặc định
        localEventsRecord[defEvtId] = {
          id: defEvtId,
          name: parsed.currentEventName || 'Đôi Nam Chuyên Nghiệp',
          settings: parsed.tournament?.settings || {},
          activeGroupId: activeGroupId,
          advanceSelectionMode: parsed.advanceSelectionMode || 'auto',
          manualQualifiedTeamIds: parsed.manualQualifiedTeamIds || [],
          teams: normalizedTeamsObj,
          groups: normalizedGroupsObj,
          matches: matchesArr
        };

        eventsToUpsert.push({
          id: defEvtId,
          name: parsed.currentEventName || 'Đôi Nam Chuyên Nghiệp',
          settings: parsed.tournament?.settings || {},
          active_group_id: activeGroupId,
          advance_selection_mode: parsed.advanceSelectionMode || 'auto',
          manual_qualified_team_ids: parsed.manualQualifiedTeamIds || [],
          });
      }

      const targetEventId = parsed.currentEventId || Object.keys(localEventsRecord)[0] || 'event-default';
      const targetEventObj = localEventsRecord[targetEventId] || {
        teams: {},
        groups: {},
        matches: [],
        activeGroupId: null,
        advanceSelectionMode: 'auto',
        manualQualifiedTeamIds: []
      };

      // Đóng gói payload hoàn chỉnh để nạp tức thì vào Zustand Store
      const localStatePayload: any = {
        tournament: parsed.tournament,
        events: localEventsRecord,
        currentEventId: targetEventId,
        teams: targetEventObj.teams,
        groups: targetEventObj.groups,
        matches: targetEventObj.matches,
        activeGroupId: targetEventObj.activeGroupId,
        advanceSelectionMode: targetEventObj.advanceSelectionMode,
        manualQualifiedTeamIds: targetEventObj.manualQualifiedTeamIds,
        logs: parsed.logs || []
      };

      if (parsed.darkMode !== undefined) {
        localStatePayload.darkMode = parsed.darkMode;
      }
      if (parsed.selectedTab) {
        localStatePayload.selectedTab = parsed.selectedTab;
      }

      // Cập nhật trạng thái Offline cực kì mượt mà ngay tắp lự
      useTournamentStore.setState(localStatePayload);

      if (supabaseConnected) {
        addLog(
          'Khôi Phục',
          'Đã nạp JSON vào phiên làm việc hiện tại. Đồng bộ trực tiếp lên Supabase đã bị khóa; dữ liệu production phải đi qua RPC/API có kiểm quyền.'
        );
      }

      addLog('Khôi Phục', 'Đã khôi phục toàn bộ cấu hình giải đấu & tất cả danh mục nội dung thi đấu thành công từ sao lưu JSON.');
      setShowJsonModal(false);
      setJsonInput('');
      setDragActive(false);
      showToast('Khôi phục hệ thống giải đấu thành công!');
    } catch (e: any) {
      console.error('Lỗi phân tích hoặc tải dữ liệu JSON:', e);
      showToast('Lỗi khôi phục sao lưu: ' + (e.message || 'vui lòng kiểm tra lại định dạng chuỗi.'));
    }
  };

  const handleResetConfirmSubmit = () => {
    resetAll();
    setShowResetConfirm(false);
    showToast('Giải đấu đã được dọn dẹp sạch sẽ!');
  };

  return (
    <div className="space-y-4" id="dashboard-view">
      
      {/* Toast báo sự kiện mini */}
      {notification && (
        <div className={`fixed bottom-4 right-4 border text-white text-xs px-4 py-2.5 rounded-lg shadow-2xl z-50 flex items-center gap-2 animate-bounce ${
          notification.type === 'success'
            ? 'bg-zinc-900 border-zinc-800'
            : 'bg-red-700 border-red-800'
        }`}>
          {notification.type === 'success' ? (
            <Check size={13} className="text-emerald-400 stroke-[3]" />
          ) : (
            <AlertCircle size={13} className="text-red-100 stroke-[3]" />
          )}
          <span className="font-bold">{notification.message}</span>
        </div>
      )}

      {/* BANNER ĐẬM CHẤT THỂ THAO ĐỈNH CAO (Chữ to rõ, màu rực rỡ, thiết kế cực sang trọng) */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-805 to-slate-900 text-white p-5 md:p-6 rounded-2xl shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4" id="tournament-branding-banner">
        <div className="space-y-2 max-w-2xl">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-white/12 text-blue-200 border border-white/10 rounded-full text-[9px] font-black uppercase tracking-widest" style={{ color: '#e8eeda', fontSize: '9.5px' }}>
            Giải Đấu Điển Hình 2026
          </span>
          <h2 className="text-xl md:text-2xl font-black tracking-tight leading-none uppercase font-display select-text" style={{ color: '#f1eb38', fontSize: '20px', lineHeight: '17.55px', textAlign: 'left', marginLeft: '0px' }}>
            {tournament.name || 'GIẢI PICKLEBALL ĐÔI NAM TOÀN TỈNH'}
          </h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-blue-100 font-bold" style={{ textAlign: 'center', color: '#f0f0f0' }}>
            <span className="flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded-md">
              <MapPin size={12} className="text-amber-300" />
              <span style={{ fontSize: '11px' }}>Địa điểm: {tournament.location || 'Sân vận động Trung tâm Thể thao'}</span>
            </span>
            <span className="flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded-md">
              <CalendarDays size={12} className="text-amber-300" />
              <span style={{ fontSize: '10.5px' }}>Khai mạc: {tournament.date || '2026-05-28'}</span>
            </span>
          </div>
        </div>
      </div>

      {/* TRẠNG THÁI KẾT NỐI SUPABASE Ở THỜI GIAN THỰC */}
      <div className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all ${
        supabaseConnected === null
          ? 'bg-zinc-50 border-zinc-200 dark:bg-zinc-900/40 dark:border-zinc-800 text-zinc-500'
          : supabaseConnected
            ? 'bg-emerald-50/75 border-emerald-200/80 dark:bg-emerald-950/20 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-300'
            : 'bg-amber-50/75 border-amber-200/80 dark:bg-amber-955/20 dark:border-amber-900/40 text-amber-800 dark:text-amber-300'
      }`} id="supabase-realtime-status-card">
        <div className="flex items-start gap-3">
          <div className={`p-2.5 rounded-xl shrink-0 ${
            supabaseConnected === null
              ? 'bg-zinc-200/60 text-zinc-500 dark:bg-zinc-800/80'
              : supabaseConnected
                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200/40 dark:border-emerald-900/30 font-bold'
                : 'bg-amber-100 dark:bg-amber-955/60 text-amber-600 dark:text-amber-400 border border-amber-200/40 dark:border-amber-900/30'
          }`}>
            {supabaseConnected === null ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : supabaseConnected ? (
              <Wifi size={18} className="animate-pulse" />
            ) : (
              <WifiOff size={18} className="animate-bounce" />
            )}
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-black uppercase tracking-wider">KẾT NỐI HỆ THỐNG TRỰC TUYẾN</span>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase ${
                supabaseConnected === null
                  ? 'bg-zinc-100 text-zinc-500 border border-zinc-200 dark:bg-zinc-800'
                  : supabaseConnected
                    ? 'bg-emerald-500 text-white animate-pulse'
                    : 'bg-amber-500 text-white'
              }`}>
                {supabaseConnected === null ? 'ĐANG KIỂM TRA' : supabaseConnected ? 'ONLINE' : 'OFFLINE CHỜĐỒNG BỘ'}
              </span>
            </div>
            <p className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-3xl">
              {supabaseConnected === null ? (
                'Đang dò tìm kết nối ổn định với đám mây Supabase trực tuyến để xác minh trạng thái đồng bộ...'
              ) : supabaseConnected ? (
                'Đã liên thông dữ liệu thời gian thực thành công. Khi đăng nhập Admin, mọi thay đổi, bảng xếp hạng hay tỷ số lập tức cập nhật lên cơ sở dữ liệu chung.'
              ) : (
                'Hiện tại không kết nối được Supabase (hoặc chưa cấu hình). Hệ thống tự động chuyển sang sử dụng dữ liệu tạm thời (Local cache), thông tin của bạn không bị mất.'
              )}
            </p>
          </div>
        </div>
        <button
          onClick={handleManualCheck}
          disabled={isCheckingConn}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer hover:scale-[1.01] active:scale-[0.99] border select-none shrink-0 ${
            supabaseConnected === null
              ? 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 border-zinc-200 dark:border-zinc-700'
              : supabaseConnected
                ? 'bg-emerald-600 hover:bg-emerald-555 text-white hover:bg-emerald-500 border-transparent shadow-sm'
                : 'bg-amber-600 hover:bg-amber-555 text-white hover:bg-amber-500 border-transparent shadow-sm'
          }`}
          id="btn-manual-recheck-supabase"
        >
          <RefreshCw size={12} className={isCheckingConn ? 'animate-spin' : ''} />
          {isCheckingConn ? 'Đang dò...' : 'Dò Kết Nối'}
        </button>
      </div>

      {/* GRID THỐNG KÊ LỚN (Chữ to, dễ nhìn, đường biên dày dặn) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        
        {/* Số trận vòng bảng */}
        <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-start gap-3 transition-all shadow-xs hover:border-blue-500">
          <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-lg border border-blue-100 dark:border-blue-900/30">
            <Trophy size={18} className="stroke-[2.5]" id="stat-match" />
          </div>
          <div>
            <p className="text-[10px] font-black text-zinc-430 dark:text-zinc-500 uppercase tracking-wider">Trận vòng bảng toàn bộ</p>
            <p className="text-lg font-black text-zinc-900 dark:text-zinc-100 mt-0.5 leading-none">
              {finishedMatchesAll} <span className="text-xs font-semibold text-zinc-400">/ {totalMatchesAll - directMatchesCountAll}</span>
            </p>
            <p className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-1 font-semibold">
              Bảng hiện tại: {finishedMatches} / {totalMatches - directMatchesCount}
            </p>
          </div>
        </div>

        {/* Tổng số đội */}
        <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-start gap-3 transition-all shadow-xs hover:border-blue-500">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-lg border border-indigo-100 dark:border-indigo-900/30">
            <Users size={18} className="stroke-[2.5]" id="stat-team-count" />
          </div>
          <div>
            <p className="text-[10px] font-black text-zinc-430 dark:text-zinc-500 uppercase tracking-wider">Đội đăng ký toàn bộ</p>
            <p className="text-lg font-black text-zinc-900 dark:text-zinc-100 mt-0.5 leading-none">
              {totalTeamsAll} <span className="text-[10px] font-semibold text-zinc-400 uppercase">Đội</span>
            </p>
            <p className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-1 font-semibold">
              Nội dung hiện tại: {totalTeams} Đội
            </p>
          </div>
        </div>

        {/* Số bảng đấu */}
        <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-start gap-3 transition-all shadow-xs hover:border-blue-500">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
            <Layers size={18} id="stat-group-count" />
          </div>
          <div>
            <p className="text-[10px] font-black text-zinc-430 dark:text-zinc-500 uppercase tracking-wider">Số lượng bảng đấu</p>
            <p className="text-lg font-black text-zinc-900 dark:text-zinc-100 mt-0.5 leading-none">
              {totalGroupsAll} <span className="text-[10px] font-semibold text-zinc-400 uppercase">Bảng</span>
            </p>
            <p className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-1 font-semibold">
              Bảng nội dung này: {totalGroups} Bảng
            </p>
          </div>
        </div>

        {/* Số trận trực tiếp Knockout */}
        <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-start gap-3 transition-all shadow-xs hover:border-blue-500">
          <div className="p-2 bg-amber-50 dark:bg-amber-955/50 text-amber-600 dark:text-amber-400 rounded-lg border border-amber-100 dark:border-amber-900/30">
            <Award size={18} id="stat-direct-count" />
          </div>
          <div>
            <p className="text-[10px] font-black text-zinc-430 dark:text-zinc-500 uppercase tracking-wider">Trận trực tiếp (KO)</p>
            <p className="text-lg font-black text-zinc-900 dark:text-zinc-100 mt-0.5 leading-none">
              {directMatchesCountAll} <span className="text-[10px] font-semibold text-zinc-400 uppercase">Trận</span>
            </p>
            <p className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-1 font-semibold">
              Event hiện tại: {directMatchesCount} Trận
            </p>
          </div>
        </div>

      </div>

      {/* BIỂU MẪU SỐ HÓA THÔNG TIN & THIẾT LẬP */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        
        {/* Thông tin giải */}
        <div className="bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-4">
          <h3 className="text-xs font-black text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 border-b border-zinc-100 dark:border-zinc-800 pb-2 uppercase tracking-tight">
            <Trophy size={15} className="text-blue-600 stroke-[2.5]" />
            Thông Tin Giải Đấu
          </h3>
          
          <form onSubmit={handleSaveInfo} className="space-y-3">
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Tên Giải Đấu</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold text-xs"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Đơn Vị Chủ Trì (BTC)</label>
              <input
                type="text"
                value={isTenantWorkspace ? lockedOrganizationName || org : org}
                disabled={isTenantWorkspace}
                readOnly={isTenantWorkspace}
                onChange={(e) => setOrg(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-900 focus:outline-none font-semibold text-xs disabled:cursor-not-allowed disabled:text-zinc-600 dark:disabled:text-zinc-300"
                required
              />
              {isTenantWorkspace && (
                <p className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
                  Tự động lấy theo đơn vị đang mở trong URL.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Địa Điểm Vận Hành</label>
                <input
                  type="text"
                  value={loc}
                  onChange={(e) => setLoc(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold text-xs"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Ngày Tổ Chức</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold text-xs"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-900 text-white font-black rounded-lg transition-all shadow-sm text-xs uppercase tracking-wider cursor-pointer"
              id="btn-save-info"
            >
              Cập Nhật Thông Tin
            </button>
          </form>
        </div>

        {/* Luật và Điểm cấu hình */}
        <div className="bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-4">
          <h3 className="text-xs font-black text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 border-b border-zinc-100 dark:border-zinc-800 pb-2 uppercase tracking-tight">
            <Trophy size={15} className="text-emerald-600 stroke-[2.5]" />
            Luật & Điểm Thi Đấu
          </h3>
          
          <form onSubmit={handleSaveSettings} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Tỉ Số Thắng</label>
                <input
                  type="number"
                  value={winPt}
                  onChange={(e) => setWinPt(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold text-xs"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Tỉ Số Thua</label>
                <input
                  type="number"
                  value={lossPt}
                  onChange={(e) => setLossPt(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold text-xs"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Set Chạm Đến</label>
                <input
                  type="number"
                  value={maxSc}
                  onChange={(e) => setMaxSc(Math.max(1, Number(e.target.value)))}
                  className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold text-xs"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Điểm Kịch Trần (Cap)</label>
                <input
                  type="number"
                  value={capSc}
                  onChange={(e) => setCapSc(Math.max(maxSc, Number(e.target.value)))}
                  className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold text-xs"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Số Đội Đi Tiếp Mỗi Bảng</label>
              <select
                value={advCount}
                onChange={(e) => setAdvCount(Number(e.target.value))}
                className="w-full px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold text-xs cursor-pointer"
              >
                <option value={1}>1 Đội (Chỉ lấy Hạng 1 bảng tiến vào)</option>
                <option value={2}>2 Đội (Lấy Hạng 1 và Hạng 2 bảng)</option>
                <option value={3}>3 Đội (Hạng 1, Hạng 2 và so Hạng 3 xuất sắc)</option>
              </select>
            </div>

            <button
              type="submit"
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-lg transition-all shadow-sm text-xs uppercase tracking-wider cursor-pointer"
              id="btn-save-settings"
            >
              Cập Nhật Quy Chế
            </button>
          </form>
        </div>

      </div>

      {/* CHỨC NĂNG SAO LƯU BACKUP (.json) */}
      <div className="bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-3 shadow-xs">
        <h3 className="text-xs font-extrabold text-zinc-905 dark:text-zinc-100 uppercase border-b border-zinc-100 dark:border-zinc-800 pb-2">
          Quản Trị Hệ Thống & Lưu Trữ
        </h3>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed font-semibold">
          Ban tổ chức có thể xuất tệp JSON để đồng bộ hoặc bàn giao dữ liệu vận hành từ xa qua các thiết bị trọng tài biên khác nhau khi không có mạng.
        </p>
        <div className="flex flex-wrap gap-2.5 pt-1">
          <button
            onClick={handleExportDataJson}
            className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-805 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-100 rounded-lg transition-all flex items-center gap-1.5 text-xs font-black cursor-pointer shadow-xs border border-zinc-200/50 dark:border-zinc-800"
            id="btn-export-backup"
          >
            <Download size={14} /> Xuất Sao Lưu (.json)
          </button>
          <button
            onClick={() => setShowJsonModal(true)}
            className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-805 dark:hover:bg-zinc-800 text-zinc-805 dark:text-zinc-100 rounded-lg transition-all flex items-center gap-1.5 text-xs font-black cursor-pointer shadow-xs border border-zinc-200/50 dark:border-zinc-800"
            id="btn-open-import"
          >
            <Upload size={14} /> Nhập Sao Lưu (.json)
          </button>
        </div>
      </div>

      {/* POPUP IMPORT SAO LƯU JSON */}
      {showJsonModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" id="import-json-modal">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl max-w-lg w-full p-6 space-y-4 border border-zinc-200 dark:border-zinc-800 shadow-2xl relative">
            <h3 className="text-base font-black text-zinc-900 dark:text-zinc-100 uppercase tracking-tight flex items-center gap-2">
              <Upload size={18} className="text-blue-600 dark:text-blue-400 stroke-[3]" />
              Nhập Sao Lưu Toàn Hệ Thống
            </h3>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed font-semibold">
              Kéo thả tệp tin <code className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded text-red-600 dark:text-red-400 font-mono text-[10px]">.json</code> của giải đấu vào vùng tải lên dưới đây hoặc dán mã JSON trực tiếp để khôi phục dữ liệu tức thì.
            </p>
            
            {/* VÙNG KÉO THẢ FILE CHUYÊN NGHIỆP */}
            <div 
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all relative ${
                dragActive 
                  ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/20 text-blue-600' 
                  : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/20'
              }`}
            >
              <input 
                type="file" 
                id="file-upload-input" 
                accept=".json" 
                onChange={handleFileChange} 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
              />
              <Upload size={28} className={`mb-2 stroke-[2] ${dragActive ? 'text-blue-600 dark:text-blue-400 animate-bounce' : 'text-zinc-400 dark:text-zinc-500'}`} />
              <p className="text-xs font-black text-zinc-700 dark:text-zinc-300">
                Kéo & thả tệp sao lưu vào đây
              </p>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-450 mt-1 font-semibold">
                hoặc click để chọn tệp .json từ thiết bị
              </p>
            </div>

            <div className="flex items-center my-2">
              <div className="flex-1 border-t border-zinc-100 dark:border-zinc-800"></div>
              <span className="text-[10px] font-bold text-zinc-400 px-3 uppercase tracking-wider">Hoặc dán mã JSON trực tiếp</span>
              <div className="flex-1 border-t border-zinc-100 dark:border-zinc-800"></div>
            </div>

            <textarea
              rows={5}
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder='Nhập chuỗi văn bản JSON sao lưu tại đây...'
              className="w-full p-3 font-mono text-xs rounded-xl border-2 border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:border-blue-500 font-semibold"
            />
            
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setShowJsonModal(false);
                  setJsonInput('');
                }}
                className="px-5 py-2.5 text-xs font-bold text-zinc-500 hover:text-zinc-700 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 rounded-xl cursor-pointer"
              >
                Hủy quay lại
              </button>
              <button
                onClick={handleImportJson}
                disabled={!jsonInput.trim()}
                className={`px-6 py-2.5 text-xs font-black text-white rounded-xl cursor-pointer uppercase tracking-wider transition-all ${
                  jsonInput.trim() 
                    ? 'bg-blue-600 hover:bg-blue-500' 
                    : 'bg-zinc-300 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-600 cursor-not-allowed'
                }`}
                id="btn-submit-import"
              >
                Khôi Phục Bản Ghi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POPUP XÁC NHẬN RESET GIẢI ĐẤU CUSTOM - AN TOÀN TRỌN VẸN iFRAME */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-51 animate-fade-in" id="reset-app-popup">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-205 dark:border-zinc-800 rounded-3xl max-w-md w-full p-6.5 shadow-2xl space-y-4">
            
            <div className="flex items-center gap-3.5 text-red-600">
              <div className="p-3 bg-red-50 dark:bg-red-955/40 rounded-2xl">
                <Trash2 size={24} className="stroke-[2.5]" />
              </div>
              <div>
                <h4 className="text-lg font-black leading-tight text-zinc-900 dark:text-zinc-100">Yêu Cầu Reset Giải Đấu</h4>
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Hành động nguy hại cao</p>
              </div>
            </div>

            <p className="text-sm font-semibold text-zinc-650 dark:text-zinc-400 leading-relaxed pt-2">
              Bạn có thực sự muốn <strong className="text-red-650 dark:text-red-400 font-black">XÓA SẠCH TOÀN BỘ GIẢI ĐẤU</strong> hiện tại? 
              Mọi danh sách đội đã đăng ký, lịch thi đấu, bảng kết quả, điểm số ghi nhận sẽ mất vĩnh viễn và không cách gì lấy lại được.
            </p>

            <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800 animate-fade-in">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-5 py-2.5 text-xs font-bold text-zinc-600 hover:text-zinc-800 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-805 dark:text-zinc-300 rounded-xl cursor-pointer"
              >
                Giữ giải đấu lại
              </button>
              
              <button
                onClick={handleResetConfirmSubmit}
                className="px-6 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-550 rounded-xl shadow-md cursor-pointer uppercase tracking-wider"
                id="btn-confirm-reset-app"
              >
                Xóa Hết & Đặt Lại
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
