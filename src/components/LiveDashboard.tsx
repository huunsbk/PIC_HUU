/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import ExcelJS from 'exceljs';
import { QRCodeCanvas } from 'qrcode.react';
import { useQuery } from '@tanstack/react-query';
import { useTournamentStore } from '../store';
import { isPublicViewerRoute, useEvents } from '../hooks/useEvents';
import { supabase } from '../supabaseClient';
import { tournamentRpc } from '../lib/api/tournamentRpc';
import { calculateGroupStandings, getReadableTeamName, getReadableKoMatchName, balanceMatchesRestTime, getMatchDisplayName } from '../utils/tournamentEngine';
import { attachMatchSets, getSetScoreText } from '../utils/scoreDisplay';
import { getEffectiveTournamentSettings } from '../lib/eventSettings';
import { useSportsCatalog } from '../hooks/useSportsCatalog';
import { getSportName } from '../lib/sports';
import type { MatchSet } from '../types';
import { 
  Monitor, 
  Play, 
  Pause, 
  Maximize, 
  Clock, 
  Award, 
  Trophy, 
  Layers, 
  GitCommit, 
  Grid,
  Share2,
  QrCode,
  Copy,
  Link,
  X,
} from 'lucide-react';
import { LiveBracket } from './LiveBracket';

interface AutoScrollListProps {
  children: React.ReactNode;
  className?: string;
  maxHeight?: string;
}

function AutoScrollList({ children, className = '', maxHeight = '350px' }: AutoScrollListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    
    // Disable auto-scroll on mobile to allow native scrolling and full display
    if (window.innerWidth < 1024) return;

    let timer: any;
    let scrollDirection = 1; // 1 for down, -1 for up
    let pauseCounter = 0;

    const scroll = () => {
      if (!element) return;
      const { scrollTop, scrollHeight, clientHeight } = element;
      const maxScroll = scrollHeight - clientHeight;

      if (maxScroll <= 2) {
        element.scrollTop = 0;
        timer = setTimeout(scroll, 1000);
        return;
      }

      if (pauseCounter > 0) {
        pauseCounter--;
        timer = setTimeout(scroll, 35);
        return;
      }

      let nextScroll = scrollTop + scrollDirection * 0.7; // Slow and gentle scroll

      if (nextScroll >= maxScroll) {
        nextScroll = maxScroll;
        scrollDirection = -1;
        pauseCounter = 60; // Pause for ~2 seconds at bottom
      } else if (nextScroll <= 0) {
        nextScroll = 0;
        scrollDirection = 1;
        pauseCounter = 60; // Pause for ~2 seconds at top
      }

      element.scrollTop = nextScroll;
      timer = setTimeout(scroll, 35);
    };

    pauseCounter = 60; // Initial delay
    timer = setTimeout(scroll, 1500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`overflow-y-auto pr-1 ${className}`}
      style={{ maxHeight: window.innerWidth >= 1024 ? maxHeight : 'none', scrollBehavior: 'auto' }}
    >
      {children}
    </div>
  );
}

// ==========================================
// OPTIMIZED MEMOIZED SUB-COMPONENTS TO PREVENT RENDER PROPS LEAKS & RE-CREATION HELL
// ==========================================

interface EventFilterButtonProps {
  evtId: string;
  name: string;
  isSelected: boolean;
  onClick: (id: string) => void;
}

const EventFilterButton = React.memo(({ 
  evtId, 
  name, 
  isSelected, 
  onClick 
}: EventFilterButtonProps) => {
  const handleClick = React.useCallback(() => {
    onClick(evtId);
  }, [onClick, evtId]);

  return (
    <button
      onClick={handleClick}
      className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all cursor-pointer select-none ${
        isSelected
          ? 'bg-blue-600 text-white shadow-xs'
          : 'text-zinc-650 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-amber-200'
      }`}
    >
      {name}
    </button>
  );
});
EventFilterButton.displayName = 'EventFilterButton';

interface StandingGroupCardProps {
  group: any;
  std: any[];
}

const StandingGroupCard = React.memo(({ 
  group, 
  std 
}: StandingGroupCardProps) => {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-805 overflow-hidden shadow-sm mb-4">
      {/* Header Bar */}
      <div className="bg-blue-600 text-white py-2 px-2 sm:px-3 flex items-center justify-between">
        <span className="match-group-title font-extrabold flex items-center gap-1.5 tracking-tight uppercase">
          <Award size={13} /> BẢNG XẾP HẠNG - {group.name}
        </span>
        <span className="text-[9px] font-bold bg-white/20 px-2 py-0.5 rounded-full border border-white/20 select-none hidden sm:inline-block">
          Bảng {group.teamIds?.length || std.length} đội
        </span>
      </div>
      {/* Table Data */}
      <div className="overflow-x-auto overflow-y-hidden">
        <table className="match-score-value w-full text-left table-fixed">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 font-bold text-[9px] sm:text-[10px] md:text-[11px] leading-tight">
              <th className="py-1.5 px-0 text-center w-6 sm:w-8">Hạng</th>
              <th className="py-1.5 px-0.5 text-center min-w-[50px] w-auto">Đội</th>
              <th className="py-1.5 px-0 text-center w-6 sm:w-8">Trận</th>
              <th className="py-1.5 px-0 text-center text-emerald-600 w-4 sm:w-6">T</th>
              <th className="py-1.5 px-0 text-center text-red-500 w-4 sm:w-6">B</th>
              <th className="py-1.5 px-0 text-center text-zinc-500 w-6 sm:w-8">Séc</th>
              <th className="py-1.5 px-0 text-center text-zinc-500 w-6 sm:w-8">H/S</th>
              <th className="py-1.5 px-0.5 text-center text-blue-600 w-8 sm:w-10">Điểm</th>
            </tr>
          </thead>
          <tbody>
            {std.map((s, idx) => {
              let rankBadge = null;
              if (idx === 0) {
                rankBadge = <span className="w-4 h-4 sm:w-5 sm:h-5 rounded-full inline-flex items-center justify-center font-bold text-[9px] sm:text-[10px] bg-amber-100 text-amber-800 border border-amber-200/40">1</span>;
              } else if (idx === 1) {
                rankBadge = <span className="w-4 h-4 sm:w-5 sm:h-5 rounded-full inline-flex items-center justify-center font-bold text-[9px] sm:text-[10px] bg-zinc-150 text-zinc-700 border border-zinc-200/40">2</span>;
              } else {
                rankBadge = <span className="text-zinc-400 font-bold block">{idx + 1}</span>;
              }

              return (
                <tr key={s.teamId} className="border-b border-zinc-100 dark:border-zinc-850/60 hover:bg-zinc-50 dark:hover:bg-zinc-850/10">
                  <td className="py-1.5 px-0 text-center font-bold text-[10px] sm:text-[11px]">
                    <span className="flex justify-center items-center">{rankBadge}</span>
                  </td>
                  <td className="match-team-name py-1.5 px-0.5 text-center font-extrabold text-zinc-700 dark:text-zinc-300 truncate">{s.teamName}</td>
                  <td className="py-1.5 px-0 text-center text-zinc-600 dark:text-zinc-400 font-medium">{s.matchesPlayed}</td>
                  <td className="py-1.5 px-0 text-center text-emerald-600 font-bold">{s.matchesWon}</td>
                  <td className="py-1.5 px-0 text-center text-red-500 font-bold">{s.matchesLost}</td>
                  <td className="py-1.5 px-0 text-center text-zinc-500 font-medium tracking-tighter">{s.setDiff > 0 ? `+${s.setDiff}` : s.setDiff}</td>
                  <td className="py-1.5 px-0 text-center text-zinc-500 font-medium tracking-tighter">{s.pointDiff > 0 ? `+${s.pointDiff}` : s.pointDiff === 0 ? 'Ø' : s.pointDiff}</td>
                  <td className="match-score-value py-1.5 px-0.5 text-center font-extrabold text-blue-600">{s.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
StandingGroupCard.displayName = 'StandingGroupCard';

interface LiveMatchRowProps {
  m: any;
  teams: any;
  groups: any;
  absoluteIndex: number;
}

const LiveMatchRow = React.memo(({
  m,
  teams,
  groups,
  absoluteIndex
}: LiveMatchRowProps) => {
  const { matches, tournament } = useTournamentStore();
  const teamA = getMatchDisplayName(m.teamAId, m.placeholderA, teams, groups, matches, tournament?.settings || {});
  const teamB = getMatchDisplayName(m.teamBId, m.placeholderB, teams, groups, matches, tournament?.settings || {});
  const group = groups[m.groupId];
  const isFinished = m.status === 'finished';
  const isPlaying = m.status === 'playing';

  let roundClass = "border-zinc-200 dark:border-zinc-800";
  let roundLabel = "";
  if (group) {
    roundClass = isFinished ? "border-emerald-300 dark:border-emerald-800" : isPlaying ? "border-blue-300 dark:border-blue-800" : "border-[#5b9e38] dark:border-[#4c842f]";
    const groupNameUpper = group.name.toUpperCase();
    roundLabel = groupNameUpper.startsWith('BẢNG') ? groupNameUpper : `BẢNG ${groupNameUpper}`;
  } else {
    const rName = (m.knockoutRoundName || "").toLowerCase();
    if (rName.includes("32")) { roundClass = "border-[#20b2aa] dark:border-[#1a8e88]"; roundLabel = "VÒNG 32"; }
    else if (rName.includes("16")) { roundClass = "border-[#3cb371] dark:border-[#308f5a]"; roundLabel = "VÒNG 16"; }
    else if (rName.includes("tứ kết")) { roundClass = "border-[#9370db] dark:border-[#7559af]"; roundLabel = "TỨ KẾT"; }
    else if (rName.includes("bán kết")) { roundClass = "border-[#ff8c00] dark:border-[#cc7000]"; roundLabel = "BÁN KẾT"; }
    else if (rName.includes("chung kết")) { roundClass = "border-[#dc143c] dark:border-[#b01030]"; roundLabel = "CHUNG KẾT"; }
    else { roundClass = "border-[#4169e1] dark:border-[#3454b4]"; roundLabel = rName ? rName.toUpperCase() : `VÒNG KO ${m.round}`; }
    if (isFinished) {
      roundClass = "border-emerald-300 dark:border-emerald-800";
    } else if (isPlaying) {
      roundClass = "border-blue-300 dark:border-blue-800";
    }
  }

  const bgClass = isFinished ? "bg-emerald-50/40 dark:bg-emerald-950/20" : isPlaying ? "bg-blue-50/40 dark:bg-blue-950/20" : "bg-white dark:bg-zinc-950";

  return (
    <div className={`flex items-center gap-2 ${bgClass} py-1.5 px-2 rounded-lg border-[1.5px] ${roundClass} text-[11px]`}>
      <div className={`w-[36px] h-[32px] rounded flex flex-col items-center justify-center font-bold shrink-0 shadow-sm border ${isFinished ? 'bg-emerald-600 text-white border-emerald-700' : isPlaying ? 'bg-blue-600 text-white border-blue-700' : 'bg-[#114666] text-white border-[#0d344d]'}`}>
        <span className="text-[14px] leading-none">{absoluteIndex}</span>
      </div>
      <div className="flex flex-col flex-1 pl-1 pr-2 overflow-hidden">
        <div className="overflow-x-auto whitespace-nowrap scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 flex flex-col gap-0.5">
          <span className={`match-team-name font-semibold truncate block ${isFinished && m.winnerId === m.teamAId ? 'text-blue-600 dark:text-blue-400 font-extrabold' : 'text-zinc-800 dark:text-zinc-200'}`}>{teamA}</span>
          <span className={`match-team-name font-semibold truncate block ${isFinished && m.winnerId === m.teamBId ? 'text-blue-600 dark:text-blue-400 font-extrabold' : 'text-zinc-800 dark:text-zinc-200'}`}>{teamB}</span>
        </div>
      </div>
      <div className="flex flex-col items-end shrink-0">
        <span className="match-group-title font-bold text-zinc-500 uppercase pb-0.5">{roundLabel}</span>
        {isFinished ? (
          <span className="match-score-value font-black tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/60 px-1.5 py-0.5 rounded leading-none shrink-0 border border-emerald-200/50 dark:border-emerald-800 shadow-sm">
            {getSetScoreText(m) || `${m.scoreA} - ${m.scoreB}`}
          </span>
        ) : isPlaying ? (
          <span className="text-[9px] font-bold text-blue-100 bg-blue-600 dark:bg-blue-600 px-1.5 py-1 rounded leading-none shrink-0 border border-blue-700 shadow-sm">
            ĐANG ĐẤU
          </span>
        ) : (
          <span className="text-[9px] font-bold text-zinc-400 bg-zinc-50 dark:bg-zinc-900 px-1.5 py-1 rounded leading-none shrink-0 border border-zinc-200/50 dark:border-zinc-850 shadow-sm">
            CHỜ
          </span>
        )}
      </div>
    </div>
  );
});
LiveMatchRow.displayName = 'LiveMatchRow';

interface KoRoundCardProps {
  round: number;
  roundMatches: any[];
  teams: any;
  groups?: any;
  roundName: string;
}

const KoRoundCard = React.memo(({
  round,
  roundMatches,
  teams,
  groups,
  roundName
}: KoRoundCardProps) => {
  const { matches, tournament } = useTournamentStore();
  return (
    <div className="space-y-1 bg-white dark:bg-zinc-950 py-1.5 px-2.5 rounded-xl border border-zinc-100 dark:border-zinc-850">
      <h6 className="text-[9px] font-black text-zinc-400 border-b pb-1 mb-1.5 uppercase select-none" style={{ fontSize: '6.5px', color: '#c61a8b' }}>{roundName}</h6>
      <div className="grid grid-cols-1 gap-1">
        {roundMatches.map((m) => {
          const teamAName = getMatchDisplayName(m.teamAId, m.placeholderA, teams, groups, matches, tournament?.settings || {});
          const teamBName = getMatchDisplayName(m.teamBId, m.placeholderB, teams, groups, matches, tournament?.settings || {});
          return (
            <div key={m.id} className="text-[10px] space-y-1 p-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800 rounded-lg">
              <div className="text-[8px] font-black text-zinc-450 border-b border-zinc-200/30 dark:border-zinc-805 pb-0.5 mb-1 select-none" style={{ fontSize: '6.5px', color: '#992371' }}>
                {getReadableKoMatchName(m.knockoutMatchId || '')}
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className={`match-team-name font-bold max-w-[85%] whitespace-normal break-words leading-tight ${m.winnerId === m.teamAId ? 'text-blue-600 font-extrabold' : 'text-zinc-500'}`}>{teamAName}</span>
                <strong className="match-score-value font-mono text-zinc-650 dark:text-zinc-350 shrink-0">{m.status === 'finished' ? m.scoreA : '-'}</strong>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className={`match-team-name font-bold max-w-[85%] whitespace-normal break-words leading-tight ${m.winnerId === m.teamBId ? 'text-blue-600 font-extrabold' : 'text-zinc-500'}`}>{teamBName}</span>
                <strong className="match-score-value font-mono text-zinc-650 dark:text-zinc-350 shrink-0">{m.status === 'finished' ? m.scoreB : '-'}</strong>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
KoRoundCard.displayName = 'KoRoundCard';

interface FullscreenButtonProps {
  elementId: string;
}

const FullscreenButton = React.memo(({ elementId }: { elementId: string }) => {
  const handleToggle = React.useCallback(() => {
    const el = document.getElementById(elementId);
    if (el) {
      if (!document.fullscreenElement) {
        el.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, [elementId]);

  return (
    <button
      onClick={handleToggle}
      className="flex items-center gap-2 px-3 py-2 bg-white/90 dark:bg-zinc-800/90 backdrop-blur-sm border border-zinc-200 dark:border-zinc-700 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 shadow-sm transition-all pointer-events-auto"
    >
      <Maximize size={16} />
      <span className="text-xs font-bold leading-none">Toàn màn hình</span>
    </button>
  );
});
FullscreenButton.displayName = 'FullscreenButton';

const sortKnockoutMatches = (matches: any[]) => [...matches].sort((a, b) => {
  const roundDiff = Number(a.round || 0) - Number(b.round || 0);
  if (roundDiff !== 0) return roundDiff;

  const aNumber = Number(String(a.knockoutMatchId || '').replace(/\D/g, '') || 0);
  const bNumber = Number(String(b.knockoutMatchId || '').replace(/\D/g, '') || 0);
  if (aNumber !== bNumber) return aNumber - bNumber;

  return String(a.knockoutMatchId || a.id).localeCompare(String(b.knockoutMatchId || b.id), undefined, { numeric: true });
});

const sortEventMatchesForTv = (matches: any[]) => {
  const groupMatches = matches.filter((m) => m.groupId !== 'knockout');
  const koMatches = sortKnockoutMatches(matches.filter((m) => m.groupId === 'knockout'));
  return [...balanceMatchesRestTime(groupMatches), ...koMatches];
};

const getRouteSlug = () => {
  if (typeof window === 'undefined') return '';
  const parts = window.location.pathname.split('/').filter(Boolean);
  const marker = parts.includes('tournament') ? 'tournament' : parts.includes('workspace') ? 'workspace' : '';
  const markerIndex = marker ? parts.indexOf(marker) : -1;
  return markerIndex >= 0 ? decodeURIComponent(parts[markerIndex + 1] || '') : '';
};

export default function LiveDashboard() {
  const { data: eventsData = [] } = useEvents();
  const tournament = useTournamentStore(state => state.tournament);
  const updateSettings = useTournamentStore(state => state.updateSettings);
  const hasPermission = useTournamentStore(state => state.hasPermission);
  const activeTenantId = useTournamentStore(state => state.activeTenantId);
  const userRole = useTournamentStore(state => state.userRole);
  const addLog = useTournamentStore(state => state.addLog);
  const publicSlug = React.useMemo(() => getRouteSlug(), []);
  const usePublicSnapshot = userRole === 'guest' && isPublicViewerRoute() && !!publicSlug;
  const eventIds = React.useMemo(() => eventsData.map((event: any) => event.id), [eventsData]);
  const { data: sports = [] } = useSportsCatalog();

  const {
    data: publicSnapshot,
    isLoading: publicSnapshotLoading,
  } = useQuery({
    queryKey: ['public-tournament-snapshot', publicSlug],
    queryFn: () => tournamentRpc.getPublicTournamentSnapshot(publicSlug),
    enabled: usePublicSnapshot,
    staleTime: 5000,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const {
    data: privateLiveData = { teams: [], groups: [], matches: [], matchSets: [] },
    isLoading: privateLiveDataLoading,
  } = useQuery({
    queryKey: ['live-dashboard-data', activeTenantId, eventIds],
    queryFn: async () => {
      await Promise.all(eventIds.map(async (eventId: string) => {
        try {
          await tournamentRpc.resolveKnockoutSlots(eventId);
        } catch (error) {
          console.warn('[Knockout] Could not resolve KO slots before loading TV data:', error);
        }
      }));

      const [teamsResult, groupsResult, matchesResult, matchSetsResult] = await Promise.all([
        supabase
          .from('teams')
          .select('id, name, group_id, seed, event_id')
          .eq('tenant_id', activeTenantId)
          .in('event_id', eventIds)
          .is('deleted_at', null)
          .order('name', { ascending: true }),
        supabase
          .from('groups')
          .select('id, name, team_ids, event_id')
          .eq('tenant_id', activeTenantId)
          .in('event_id', eventIds)
          .is('deleted_at', null)
          .order('name', { ascending: true }),
        supabase
          .from('matches')
          .select('id, group_id, team_a_id, team_b_id, placeholder_a, placeholder_b, score_a, score_b, winner_id, status, round, knockout_round_name, knockout_match_id, next_match_id, next_match_slot, court_number, slot_number, display_order, metadata, event_id')
          .eq('tenant_id', activeTenantId)
          .in('event_id', eventIds)
          .is('deleted_at', null)
          .order('event_id', { ascending: true })
          .order('display_order', { ascending: true, nullsFirst: false })
          .order('round', { ascending: true })
          .order('slot_number', { ascending: true, nullsFirst: false })
          .order('court_number', { ascending: true, nullsFirst: false }),
        supabase
          .from('match_sets')
          .select('id, match_id, tenant_id, event_id, set_number, score_a, score_b, winner_id, status, created_at, updated_at, deleted_at')
          .eq('tenant_id', activeTenantId)
          .in('event_id', eventIds)
          .is('deleted_at', null)
          .order('set_number', { ascending: true }),
      ]);

      if (teamsResult.error) throw teamsResult.error;
      if (groupsResult.error) throw groupsResult.error;
      if (matchesResult.error) throw matchesResult.error;
      if (matchSetsResult.error) throw matchSetsResult.error;

      return {
        teams: teamsResult.data || [],
        groups: groupsResult.data || [],
        matches: matchesResult.data || [],
        matchSets: (matchSetsResult.data || []) as MatchSet[],
      };
    },
    enabled: !usePublicSnapshot && !!activeTenantId && activeTenantId !== 'default' && eventIds.length > 0,
  });

  const effectiveEventsData = React.useMemo(
    () => (publicSnapshot?.events || eventsData) as any[],
    [eventsData, publicSnapshot]
  );
  const liveData = React.useMemo(
    () => publicSnapshot
      ? {
          teams: publicSnapshot.teams || [],
          groups: publicSnapshot.groups || [],
          matches: publicSnapshot.matches || [],
          matchSets: (publicSnapshot.match_sets || []) as MatchSet[],
        }
      : privateLiveData,
    [privateLiveData, publicSnapshot]
  );
  const effectiveTournament = React.useMemo(
    () => publicSnapshot?.tournament
      ? {
          ...tournament,
          ...publicSnapshot.tournament,
          id: String(publicSnapshot.tournament.id || tournament.id),
          name: String(publicSnapshot.tournament.name || tournament.name),
          settings: (publicSnapshot.tournament.settings as any) || tournament.settings,
        }
      : tournament,
    [publicSnapshot, tournament]
  );
  const liveDataLoading = usePublicSnapshot ? publicSnapshotLoading : privateLiveDataLoading;

  const events = React.useMemo(() => {
    const record: Record<string, any> = {};
    const teamsByEvent: Record<string, Record<string, any>> = {};
    const groupsByEvent: Record<string, Record<string, any>> = {};
    const matchesByEvent: Record<string, any[]> = {};
    const teamIdsByGroup = new Map<string, string[]>();

    liveData.teams.forEach((team: any) => {
      if (!teamsByEvent[team.event_id]) teamsByEvent[team.event_id] = {};
      teamsByEvent[team.event_id][team.id] = {
        ...team,
        groupId: team.group_id || null,
      };

      if (!team.group_id) return;
      const ids = teamIdsByGroup.get(team.group_id) || [];
      ids.push(team.id);
      teamIdsByGroup.set(team.group_id, ids);
    });

    liveData.groups.forEach((group: any) => {
      const queriedTeamIds = teamIdsByGroup.get(group.id) || [];
      const configuredOrder = Array.isArray(group.team_ids)
        ? group.team_ids.filter((id: string) => queriedTeamIds.includes(id))
        : [];
      const missingFromConfiguredOrder = queriedTeamIds.filter((id) => !configuredOrder.includes(id));

      if (!groupsByEvent[group.event_id]) groupsByEvent[group.event_id] = {};
      groupsByEvent[group.event_id][group.id] = {
        ...group,
        teamIds: [...configuredOrder, ...missingFromConfiguredOrder],
      };
    });

    const matchesWithSets = attachMatchSets(liveData.matches as any[], liveData.matchSets);
    matchesWithSets.forEach((match: any) => {
      if (!matchesByEvent[match.event_id]) matchesByEvent[match.event_id] = [];
      matchesByEvent[match.event_id].push({
        ...match,
        groupId: match.group_id,
        teamAId: match.team_a_id,
        teamBId: match.team_b_id,
        placeholderA: match.placeholder_a,
        placeholderB: match.placeholder_b,
        scoreA: match.score_a,
        scoreB: match.score_b,
        winnerId: match.winner_id,
        knockoutRoundName: match.knockout_round_name,
        knockoutMatchId: match.knockout_match_id,
        nextMatchId: match.next_match_id,
        nextMatchSlot: match.next_match_slot,
        courtNumber: match.court_number,
        slotNumber: match.slot_number,
        displayOrder: match.display_order,
        metadata: match.metadata,
      });
    });

    effectiveEventsData.forEach((event: any) => {
      record[event.id] = {
        ...event,
        settings: getEffectiveTournamentSettings(event, effectiveTournament.settings),
        teams: teamsByEvent[event.id] || {},
        groups: groupsByEvent[event.id] || {},
        matches: matchesByEvent[event.id] || [],
      };
    });

    return record;
  }, [effectiveEventsData, effectiveTournament.settings, liveData]);

  const [selectedEventFilter, setSelectedEventFilter] = useState<string>('all');
  const [currentTime, setCurrentTime] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [shareMessage, setShareMessage] = useState<string>('');
  const [isShareQrOpen, setIsShareQrOpen] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const canEditAnnouncement = !usePublicSnapshot && (
    hasPermission('*') ||
    hasPermission('manage_tournaments') ||
    hasPermission('manage_event_config') ||
    userRole === 'SUPER_ADMIN' ||
    userRole === 'TENANT_ADMIN'
  );
  const liveAnnouncement = (effectiveTournament.settings as any)?.liveAnnouncement || {};
  const [announcementDraft, setAnnouncementDraft] = useState({
    text: '',
    fontSize: 36,
    fontFamily: 'Arial, sans-serif',
    color: '#111827',
    textAlign: 'center' as 'left' | 'center' | 'right',
  });

  React.useEffect(() => {
    setAnnouncementDraft({
      text: String(liveAnnouncement.text || ''),
      fontSize: Number(liveAnnouncement.fontSize || 36),
      fontFamily: String(liveAnnouncement.fontFamily || 'Arial, sans-serif'),
      color: String(liveAnnouncement.color || '#111827'),
      textAlign: (['left', 'center', 'right'].includes(liveAnnouncement.textAlign) ? liveAnnouncement.textAlign : 'center') as 'left' | 'center' | 'right',
    });
  }, [
    liveAnnouncement.text,
    liveAnnouncement.fontSize,
    liveAnnouncement.fontFamily,
    liveAnnouncement.color,
    liveAnnouncement.textAlign,
  ]);

  const handleSaveAnnouncement = async () => {
    try {
      await updateSettings({
        ...(effectiveTournament.settings as any),
        liveAnnouncement: announcementDraft,
      } as any);
      setShareMessage('Đã lưu thông báo trình chiếu.');
      window.setTimeout(() => setShareMessage(''), 2500);
      if (addLog) {
        addLog('Trình chiếu', 'Cập nhật thông báo cho khán giả.');
      }
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : 'Không lưu được thông báo.');
      window.setTimeout(() => setShareMessage(''), 3500);
    }
  };

  const publicTournamentUrl = React.useMemo(() => {
    if (typeof window === 'undefined') return '';
    const slug = String((publicSnapshot?.tournament?.slug as any) || getRouteSlug() || '').trim();
    if (!slug) return '';
    const basePath = import.meta.env.BASE_URL || '/';
    const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
    return `${window.location.origin}${normalizedBase}tournament/${encodeURIComponent(slug)}`;
  }, [publicSnapshot]);

  const handleShareTournamentLink = async () => {
    if (!publicTournamentUrl) return;
    try {
      await navigator.clipboard.writeText(publicTournamentUrl);
      setShareMessage('Đã sao chép link giải đấu.');
    } catch {
      setShareMessage(publicTournamentUrl);
    }
    window.setTimeout(() => setShareMessage(''), 2500);
  };

  const handleCopyQrImage = async () => {
    const canvas = qrCanvasRef.current;
    if (!canvas) return;

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      setShareMessage('Không thể tạo ảnh QR.');
      return;
    }

    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setShareMessage('Đã sao chép ảnh QR.');
      } else {
        throw new Error('IMAGE_CLIPBOARD_UNAVAILABLE');
      }
    } catch {
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = 'ma-qr-giai-dau.png';
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
      setShareMessage('Trình duyệt không hỗ trợ sao chép ảnh; ảnh QR đã được tải xuống.');
    }
    window.setTimeout(() => setShareMessage(''), 3000);
  };

  useEffect(() => {
    if (!isShareQrOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsShareQrOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isShareQrOpen]);

  // Đếm giờ địa phương ticking liên tục
  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setCurrentTime(
        d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Handle Fullscreen API
  const handleToggleFullscreen = () => {
    const el = document.getElementById('live-root-container');
    if (!el) return;

    if (!document.fullscreenElement) {
      el.requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const handleExportLiveExcel = async () => {
    try {
      const workbook = new ExcelJS.Workbook();

      // Quyết định danh sách events cần xuất
      let eventsToExport: any[] = [];
      if (selectedEventFilter === 'all') {
        eventsToExport = Object.values(events || {});
      } else {
        const singleEvent = events[selectedEventFilter];
        if (singleEvent) {
          eventsToExport = [singleEvent];
        }
      }

      if (eventsToExport.length === 0) {
        return;
      }

      eventsToExport.forEach((evt: any) => {
        // Tên sheet Excel tối đa 30 ký tự, lược bỏ ký tự đặc biệt \/?:*[]
        const rawSheetName = evt.name || 'Noi_dung';
        const cleanSheetName = rawSheetName.replace(/[\\\/\?\*\[\]\:]/g, '');
        const sheetName = cleanSheetName.substring(0, 30) || `Nội dung ${evt.id}`;
        
        const worksheet = workbook.addWorksheet(sheetName);

        // Hiển thị đường lưới trong Excel
        worksheet.views = [{ showGridLines: true }];

        // Cố định kích thước các cột dữ liệu chính
        worksheet.columns = [
          { key: 'colA', width: 10 },
          { key: 'colB', width: 22 },
          { key: 'colC', width: 35 },
          { key: 'colD', width: 15 },
          { key: 'colE', width: 35 },
          { key: 'colF', width: 20 },
          { key: 'colG', width: 15 }
        ];

        // 1. DÒNG TIÊU ĐỀ CHÍNH: In đậm, cỡ chữ 11 (Wait, "tiêu đề in đậm, cỡ chữ 16 căn giữa. nội dung cỡ chữ thường 14, căn giữa.")
        worksheet.mergeCells('A1:G1');
        const mainTitle = worksheet.getCell('A1');
        mainTitle.value = `LỊCH ĐẤU & ĐIỂM SỐ MỚI NHẤT - NỘI DUNG: ${String(evt.name).toUpperCase()}`;
        mainTitle.font = { name: 'Times New Roman', size: 16, bold: true };
        mainTitle.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(1).height = 40;

        // Dòng phụ đề
        worksheet.mergeCells('A2:G2');
        const subTitle = worksheet.getCell('A2');
        subTitle.value = `GIẢI ĐẤU: ${String(effectiveTournament.name).toUpperCase()} | Sân: ${effectiveTournament.location || 'Trung tâm'} | Ngày lập: 2026`;
        subTitle.font = { name: 'Times New Roman', size: 12, italic: true };
        subTitle.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(2).height = 25;

        // Dòng trống cách quãng
        worksheet.addRow([]);
        worksheet.getRow(3).height = 15;

        let curRowIdx = 4;

        // --- MỤC I. BẢNG XẾP HẠNG VÒNG BẢNG (Như một tiêu đề trung gian -> 16 bold căn giữa) ---
        worksheet.mergeCells(`A${curRowIdx}:G${curRowIdx}`);
        const m1Title = worksheet.getCell(`A${curRowIdx}`);
        m1Title.value = `I. BẢNG XẾP HẠNG VÒNG BẢNG`;
        m1Title.font = { name: 'Times New Roman', size: 16, bold: true };
        m1Title.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(curRowIdx).height = 30;
        curRowIdx++;

        // Dòng trống
        worksheet.addRow([]);
        worksheet.getRow(curRowIdx).height = 10;
        curRowIdx++;

        const groupList: any[] = Object.values(evt.groups || {});
        const stdByGrp: any = getEventStandings(evt);

        if (groupList.length === 0) {
          worksheet.mergeCells(`A${curRowIdx}:G${curRowIdx}`);
          const emptyCell = worksheet.getCell(`A${curRowIdx}`);
          emptyCell.value = 'Chưa thiết lập bảng đấu cho nội dung này';
          emptyCell.font = { name: 'Times New Roman', size: 14, italic: true };
          emptyCell.alignment = { horizontal: 'center', vertical: 'middle' };
          worksheet.getRow(curRowIdx).height = 25;
          curRowIdx++;
        } else {
          groupList.forEach((group: any) => {
            // Tên Bảng đấu (Tiêu đề in đậm, cỡ chữ 11 -> 16 căn giữa)
            worksheet.mergeCells(`A${curRowIdx}:D${curRowIdx}`);
            const groupTitle = worksheet.getCell(`A${curRowIdx}`);
            groupTitle.value = `BẢNG ĐẤU: ${String(group.name).toUpperCase()}`;
            groupTitle.font = { name: 'Times New Roman', size: 16, bold: true };
            groupTitle.alignment = { horizontal: 'center', vertical: 'middle' };
            worksheet.getRow(curRowIdx).height = 28;
            curRowIdx++;

            // Headers của standings bảng
            const stdHeaders = ['Thứ hạng', 'Tên Đội tuyển / Vận động viên', 'Trận đã đấu', 'Điểm số', 'Séc', 'Hiệu số'];
            const headerRow = worksheet.addRow([...stdHeaders]);
            worksheet.getRow(curRowIdx).height = 26;

            headerRow.eachCell((cell) => {
              cell.font = { name: 'Times New Roman', size: 14, bold: true };
              cell.alignment = { horizontal: 'center', vertical: 'middle' };
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE8F4F8' }
              };
              cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'medium' },
                right: { style: 'thin' }
              };
            });
            curRowIdx++;

            const std = stdByGrp[group.id] || [];
            std.forEach((s: any, rankIndex: number) => {
              const dataRow = worksheet.addRow([
                rankIndex + 1,
                s.teamName || 'Không rõ',
                s.matchesPlayed || 0,
                `${s.points || 0}đ`,
                s.setDiff > 0 ? `+${s.setDiff}` : s.setDiff || 0,
                s.pointDiff > 0 ? `+${s.pointDiff}` : s.pointDiff || 0,
              ]);
              worksheet.getRow(curRowIdx).height = 25;

              dataRow.eachCell((cell) => {
                cell.font = { name: 'Times New Roman', size: 14 };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = {
                  top: { style: 'thin' },
                  left: { style: 'thin' },
                  bottom: { style: 'thin' },
                  right: { style: 'thin' }
                };
              });
              curRowIdx++;
            });

            // Khoảng trống sau mỗi bảng
            worksheet.addRow([]);
            worksheet.getRow(curRowIdx).height = 12;
            curRowIdx++;
          });
        }

        // --- MỤC II. LỊCH THI ĐẤU & ĐIỂM SỐ MỚI NHẤT (Tiêu đề in đậm, cỡ chữ 11 -> 16 căn giữa) ---
        worksheet.mergeCells(`A${curRowIdx}:G${curRowIdx}`);
        const m2Title = worksheet.getCell(`A${curRowIdx}`);
        m2Title.value = `II. LỊCH THI ĐẤU & ĐIỂM SỐ MỚI NHẤT`;
        m2Title.font = { name: 'Times New Roman', size: 16, bold: true };
        m2Title.alignment = { horizontal: 'center', vertical: 'middle' };
        worksheet.getRow(curRowIdx).height = 30;
        curRowIdx++;

        // Dòng trống
        worksheet.addRow([]);
        worksheet.getRow(curRowIdx).height = 10;
        curRowIdx++;

        // Header Trận đấu
        const matchesHeaders = ['STT', 'Bảng / Nhánh', 'Vòng đấu', 'Đội tuyển A (Thứ nhất)', 'Tỷ số', 'Đội tuyển B (Thứ hai)', 'Trạng thái'];
        const matchHeaderRow = worksheet.addRow([...matchesHeaders]);
        worksheet.getRow(curRowIdx).height = 28;

        matchHeaderRow.eachCell((cell) => {
          cell.font = { name: 'Times New Roman', size: 14, bold: true };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE8F4F8' }
          };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'medium' },
            right: { style: 'thin' }
          };
        });
        curRowIdx++;

        const evtMatches = evt.matches || [];
        if (evtMatches.length === 0) {
          worksheet.mergeCells(`A${curRowIdx}:G${curRowIdx}`);
          const emptyCell = worksheet.getCell(`A${curRowIdx}`);
          emptyCell.value = 'Chưa thiết lập lịch thi đấu nào';
          emptyCell.font = { name: 'Times New Roman', size: 14, italic: true };
          emptyCell.alignment = { horizontal: 'center', vertical: 'middle' };
          emptyCell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
          worksheet.getRow(curRowIdx).height = 25;
          curRowIdx++;
        } else {
          // Sắp xếp tối ưu khoảng nghỉ (trận 1 bảng A, trận 1 bảng B, trận 1 bảng C...)
          const groupMtch = evtMatches.filter((m: any) => m.groupId !== 'knockout');
          const koMtch = evtMatches.filter((m: any) => m.groupId === 'knockout');

          const balancedGroupMatches = balanceMatchesRestTime(groupMtch);
          const sortedAllList = [...balancedGroupMatches, ...sortKnockoutMatches(koMtch)];

          sortedAllList.forEach((m: any, mIdx: number) => {
            const tAName = getMatchDisplayName(m.teamAId, m.placeholderA, evt.teams, evt.groups, evt.matches, evt.settings || {});
            const tBName = getMatchDisplayName(m.teamBId, m.placeholderB, evt.teams, evt.groups, evt.matches, evt.settings || {});

            let gLabel = 'Vòng loại trực tiếp';
            if (m.groupId !== 'knockout') {
              const grpo = evt.groups[m.groupId];
              gLabel = grpo ? grpo.name : `Bảng ${m.groupId}`;
            }

            let rLabel = `Vòng ${m.round}`;
            if (m.groupId === 'knockout') {
              rLabel = m.knockoutRoundName || 'Trực tiếp';
              if (m.knockoutMatchId) {
                rLabel += ` (${getReadableKoMatchName(m.knockoutMatchId)})`;
              }
            }

            const scText = m.status === 'finished' ? (getSetScoreText(m).replaceAll('-', ' - ') || `${m.scoreA} - ${m.scoreB}`) : 'Chờ đấu';
            
            let stText = 'Chưa đấu';
            if (m.status === 'finished') {
              stText = m.scoreA! > m.scoreB! ? 'A thắng' : m.scoreB! > m.scoreA! ? 'B thắng' : 'Hòa';
            }

            const rowData = worksheet.addRow([
              mIdx + 1,
              gLabel,
              rLabel,
              tAName,
              scText,
              tBName,
              stText
            ]);

            worksheet.getRow(curRowIdx).height = 26;

            rowData.eachCell((cell) => {
              cell.font = { name: 'Times New Roman', size: 14 };
              cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
              cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
              };
            });
            curRowIdx++;
          });
        }
      });

      // Tạo nhị phân tải xuống
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const fileSuffix = selectedEventFilter === 'all' ? 'toan_bo_noi_dung' : `noi_dung_${selectedEventFilter}`;
      link.download = `lich_va_ti_so_tv_${fileSuffix}_${Date.now()}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);

      if (addLog) {
        addLog('Xuất Excel TV', `Đã xuất lịch thi đấu & điểm số truyền hình các nội dung thành công.`);
      }
    } catch (err) {
      console.error('Lỗi xuất Excel TV:', err);
    }
  };

  const eventList = React.useMemo(() => Object.values(events || {}), [events]);
  const isEventEmpty = React.useCallback((evt: any) => (
    Object.keys(evt.teams || {}).length === 0
    && Object.keys(evt.groups || {}).length === 0
    && (evt.matches || []).length === 0
  ), []);

  // Pre-calculate standings for all events to avoid recounting on every 1-second clock tick
  const standingsByEvent = React.useMemo(() => {
    const record: Record<string, Record<string, ReturnType<typeof calculateGroupStandings>>> = {};
    eventList.forEach(evt => {
      const stdRecord: Record<string, ReturnType<typeof calculateGroupStandings>> = {};
      const groupList = Object.values(evt.groups || {});
      groupList.forEach((g: any) => {
        const groupMatches = (evt.matches || []).filter((m: any) => m.groupId === g.id);
        stdRecord[g.id] = calculateGroupStandings(
          g.id, 
          g.teamIds, 
          groupMatches, 
          evt.teams || {}, 
          evt.settings
        );
      });
      record[evt.id] = stdRecord;
    });
    return record;
  }, [eventList]);

  // Hàm helper để xuất Excel gọi lại
  const getEventStandings = React.useCallback((evt: typeof events[string]) => {
    return standingsByEvent[evt.id] || {};
  }, [standingsByEvent]);

  return (
    <div
      className={`space-y-6 ${
        isFullscreen
          ? 'p-8 bg-zinc-950 text-white h-screen overflow-y-auto space-y-8 select-none'
          : ''
      }`}
      id="live-root-container"
    >
      {/* Thanh điều khiển siêu tối giản, không viền, không hộp (xóa bỏ phần khung cồng kềnh) */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-transparent py-1 print:hidden" id="live-minimal-controls-bar">
        {/* Lọc nội dung siêu gọn */}
        <div className="flex items-center gap-1 bg-zinc-250/50 dark:bg-zinc-900/60 p-1 rounded-xl border border-zinc-300/20 dark:border-zinc-800">
          <button
            onClick={() => setSelectedEventFilter('all')}
            className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all cursor-pointer select-none ${
              selectedEventFilter === 'all'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-zinc-650 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-amber-200'
            }`}
          >
            Tất cả nội dung
          </button>
          <button
            onClick={() => setSelectedEventFilter('announcement')}
            className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all cursor-pointer select-none ${
              selectedEventFilter === 'announcement'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-zinc-650 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-amber-200'
            }`}
          >
            Thông Báo
          </button>
          {eventList.map((evt) => (
            <button
              key={evt.id}
              onClick={() => {
                setSelectedEventFilter(evt.id);
              }}
              className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all cursor-pointer select-none ${
                selectedEventFilter === evt.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-zinc-650 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-amber-200'
              }`}
            >
              {evt.name}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {shareMessage && (
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              {shareMessage}
            </span>
          )}
          {publicTournamentUrl ? (
            <>
              <button
                type="button"
                onClick={handleShareTournamentLink}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-black text-zinc-700 shadow-xs transition hover:border-blue-200 hover:text-blue-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-blue-900 dark:hover:text-blue-300"
              >
                <Share2 size={14} />
                Chia sẻ link giải đấu
              </button>
              <button
                type="button"
                onClick={() => setIsShareQrOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-black text-white shadow-sm transition hover:bg-blue-700"
              >
                <QrCode size={14} />
                Mã QR chia sẻ
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* HIỂN THỊ TẨT CẢ NỘI DUNG (Sticked Grid View) */}
      {liveDataLoading ? (
        <div className="py-16 text-center text-sm font-bold text-zinc-500">
          Đang tải dữ liệu Bảng trình chiếu TV...
        </div>
      ) : selectedEventFilter === 'announcement' ? (
        <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:p-6">
          <div className="mb-4 flex flex-col gap-3 border-b border-zinc-150 pb-4 dark:border-zinc-800 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-base font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-50">
                Thông Báo Khán Giả
              </h3>
              <p className="mt-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                Nội dung này hiển thị trên màn hình trình chiếu và link khán giả.
              </p>
            </div>
            {canEditAnnouncement && (
              <button
                type="button"
                onClick={handleSaveAnnouncement}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-blue-500"
              >
                Lưu thông báo
              </button>
            )}
          </div>

          {canEditAnnouncement && (
            <div className="mb-5 grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950 lg:grid-cols-[1fr_150px_180px_140px_180px]">
              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-500">Cỡ chữ</span>
                <input
                  type="number"
                  min={18}
                  max={120}
                  value={announcementDraft.fontSize}
                  onChange={(event) => setAnnouncementDraft((prev) => ({ ...prev, fontSize: Math.max(18, Number(event.target.value) || 36) }))}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-bold dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-500">Màu chữ</span>
                <input
                  type="color"
                  value={announcementDraft.color}
                  onChange={(event) => setAnnouncementDraft((prev) => ({ ...prev, color: event.target.value }))}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-500">Phông chữ</span>
                <select
                  value={announcementDraft.fontFamily}
                  onChange={(event) => setAnnouncementDraft((prev) => ({ ...prev, fontFamily: event.target.value }))}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-bold dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="Arial, sans-serif">Arial</option>
                  <option value="'Times New Roman', serif">Times New Roman</option>
                  <option value="Tahoma, sans-serif">Tahoma</option>
                  <option value="'Roboto', Arial, sans-serif">Roboto</option>
                  <option value="'Courier New', monospace">Courier New</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-500">Căn chữ</span>
                <select
                  value={announcementDraft.textAlign}
                  onChange={(event) => setAnnouncementDraft((prev) => ({ ...prev, textAlign: event.target.value as 'left' | 'center' | 'right' }))}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-bold dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="left">Trái</option>
                  <option value="center">Giữa</option>
                  <option value="right">Phải</option>
                </select>
              </label>
            </div>
          )}

          {canEditAnnouncement && (
            <textarea
              value={announcementDraft.text}
              onChange={(event) => setAnnouncementDraft((prev) => ({ ...prev, text: event.target.value }))}
              placeholder="Nhập hoặc paste nội dung thông báo cho khán giả..."
              className="mb-5 min-h-[220px] w-full rounded-2xl border border-zinc-200 bg-white p-4 text-base font-semibold leading-relaxed outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-950"
            />
          )}

          <div className="flex min-h-[420px] items-center justify-center rounded-3xl border border-zinc-150 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-950">
            {announcementDraft.text.trim() ? (
              <div
                className="w-full whitespace-pre-wrap break-words font-black leading-tight"
                style={{
                  color: announcementDraft.color,
                  fontFamily: announcementDraft.fontFamily,
                  fontSize: `${announcementDraft.fontSize * 0.5}px`,
                  textAlign: announcementDraft.textAlign,
                }}
              >
                {announcementDraft.text}
              </div>
            ) : (
              <div className="text-center text-sm font-bold text-zinc-400">
                Chưa có thông báo.
              </div>
            )}
          </div>
        </div>
      ) : selectedEventFilter === 'all' ? (
        <div className="space-y-8" id="tv-all-events-view">
          {eventList.map((evt) => {
            const stdByGrp = getEventStandings(evt);
            
            const evtGroups = Object.values(evt.groups || {});
            const evtMatches = evt.matches || [];
            const koMatches = sortKnockoutMatches(evtMatches.filter((m) => m.groupId === 'knockout'));
            const pendingMatches = balanceMatchesRestTime(evtMatches.filter((m) => m.status === 'pending'));
            const finishedMatches = evtMatches.filter((m) => m.status === 'finished').slice(-4);

            return (
              <div 
                key={evt.id} 
                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-805/80 rounded-3xl p-2 sm:p-5 md:p-6 shadow-sm space-y-6"
              >
                {/* Dải Banner của từng Nội dung */}
                <div className="flex items-center justify-between border-b border-zinc-150 dark:border-zinc-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="p-2 bg-blue-50 dark:bg-blue-950/50 rounded-xl text-blue-600 dark:text-blue-400">
                      <Trophy size={16} className="stroke-[2.5]" />
                    </span>
                    <div>
                      <h3 className="match-event-title font-extrabold text-zinc-900 dark:text-zinc-50 uppercase tracking-tight">
                        Cặp đấu: {evt.name}
                      </h3>
                      <p className="text-[10px] font-bold text-zinc-500">Môn: {getSportName(evt.sport_id, sports)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-bold text-zinc-500">
                    <span className="bg-zinc-100 dark:bg-zinc-950 px-2.5 py-1 rounded-lg">Đội: <strong className="text-zinc-850 dark:text-zinc-200">{Object.keys(evt.teams || {}).length}</strong></span>
                    <span className="bg-zinc-100 dark:bg-zinc-950 px-2.5 py-1 rounded-lg">Bảng: <strong className="text-zinc-850 dark:text-zinc-200">{evtGroups.length}</strong></span>
                    <span className="bg-zinc-100 dark:bg-zinc-950 px-2.5 py-1 rounded-lg">Trận: <strong className="text-zinc-850 dark:text-zinc-200">{evtMatches.length}</strong></span>
                  </div>
                </div>

                {isEventEmpty(evt) ? (
                  <div className="rounded-2xl border border-dashed border-zinc-250 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/30 py-10 text-center text-sm font-bold text-zinc-500">
                    Chưa có dữ liệu cho nội dung này
                  </div>
                ) : null}

                {/* Grid 3 phần chính cho nội dung */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  
                  {/* Cột 1: Bảng Xếp Hạng Vòng Bảng */}
                  <div className="space-y-3 bg-zinc-50/50 dark:bg-zinc-950/20 py-3 px-1.5 sm:px-4 rounded-2xl border border-zinc-150 dark:border-zinc-850">
                    <span className="match-section-title flex items-center gap-1.5 font-black text-zinc-400 uppercase tracking-wider" style={{ color: '#c225a2' }}>
                      <Layers size={13} /> Vòng bảng & Xếp hạng
                    </span>
                    {evtGroups.length === 0 ? (
                      <p className="text-[11px] text-zinc-400 py-6 text-center">Chưa chia bảng đấu.</p>
                    ) : (
                      <AutoScrollList maxHeight="350px" className="space-y-4">
                        {evtGroups.map((group: any) => {
                          const std = stdByGrp[group.id] || [];
                          return (
                            <StandingGroupCard
                              key={group.id}
                              group={group}
                              std={std}
                            />
                          );
                        })}
                      </AutoScrollList>
                    )}
                  </div>

                  {/* Cột 2: Tiến Độ Lịch Thi Đấu */}
                  <div className="space-y-3 bg-zinc-50/50 dark:bg-zinc-950/20 py-3 px-4 rounded-2xl border border-zinc-150 dark:border-zinc-850">
                    <span className="match-section-title flex items-center gap-1.5 font-black text-zinc-400 uppercase tracking-wider" style={{ borderColor: '#3fb536', color: '#b5117e' }}>
                      <Clock size={13} /> Lịch đấu & Điểm số mới nhất
                    </span>
                    
                    <AutoScrollList maxHeight="350px" className="space-y-1.5 pb-2">
                      {evtMatches.length === 0 ? (
                        <p className="text-[11px] text-zinc-400 py-6 text-center">Chưa có lịch thi đấu.</p>
                      ) : (
                        <div className="space-y-1">
                          {sortEventMatchesForTv(evtMatches).map((m, idx) => {
                            return (
                              <LiveMatchRow
                                key={m.id}
                                m={m}
                                teams={evt.teams || {}}
                                groups={evt.groups || {}}
                                absoluteIndex={idx + 1}
                              />
                            );
                          })}
                        </div>
                      )}
                    </AutoScrollList>
                  </div>

                  {/* Cột 3: Sơ đồ Knockout */}
                  <div className="space-y-3 bg-zinc-50/50 dark:bg-zinc-950/20 py-3 px-4 rounded-2xl border border-zinc-150 dark:border-zinc-850">
                    <span className="match-section-title flex items-center gap-1.5 font-black text-zinc-400 uppercase tracking-wider" style={{ color: '#c81d59' }}>
                      <GitCommit size={13} /> Sơ đồ Trực tiếp Knockout
                    </span>
                    
                    {koMatches.length === 0 ? (
                      <p className="text-[11px] text-zinc-400 py-6 text-center">Chưa lập sơ đồ Knockout.</p>
                    ) : (
                      <AutoScrollList maxHeight="350px" className="space-y-1.5 pb-2">
                        {Array.from(new Set(koMatches.map((m: any) => m.round))).sort((a: any,b: any)=>a-b).map((round: any) => {
                          const roundMatches = sortKnockoutMatches(koMatches.filter((m: any) => m.round === round));
                          const roundName = roundMatches[0]?.knockoutRoundName || 'Vòng';
                          return (
                            <KoRoundCard
                              key={round}
                              round={round}
                              roundMatches={roundMatches}
                              teams={evt.teams || {}}
                              groups={evt.groups || {}}
                              roundName={roundName}
                            />
                          );
                        })}
                      </AutoScrollList>
                    )}
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* HIỂN THỊ CHI TIẾT 1 NỘI DUNG THI ĐẤU (Single Specific Event View) */
        <div className="space-y-6" id="tv-single-event-view">
          {(() => {
            const currentEvt = events[selectedEventFilter];
            if (!currentEvt) return <div className="py-20 text-center text-zinc-550">Lỗi: Nội dung trống.</div>;

            const stdByGrp = getEventStandings(currentEvt);
            const evtGroups = Object.values(currentEvt.groups || {});
            const evtMatches = currentEvt.matches || [];
            const koMatches = sortKnockoutMatches(evtMatches.filter((m) => m.groupId === 'knockout'));
            const pendingMatches = balanceMatchesRestTime(evtMatches.filter((m) => m.status === 'pending'));
            const finishedMatches = evtMatches.filter((m) => m.status === 'finished').slice(-10);

            return (
              <>
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-black text-zinc-800 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
                  <span>{currentEvt.name}</span>
                  <span className="text-zinc-300">·</span>
                  <span className="text-blue-600 dark:text-blue-400">Môn: {getSportName(currentEvt.sport_id, sports)}</span>
                </div>
                {isEventEmpty(currentEvt) ? (
                  <div className="rounded-2xl border border-dashed border-zinc-250 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/30 py-10 text-center text-sm font-bold text-zinc-500">
                    Chưa có dữ liệu cho nội dung này
                  </div>
                ) : null}
                <style>{`
                  #bracket-fullscreen-${currentEvt.id}:fullscreen {
                    width: 100vw !important;
                    height: 100vh !important;
                    border-radius: 0 !important;
                    padding: 0 !important;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                  }
                `}</style>
                <div 
                  className="py-2 animate-fade-in relative block bg-white dark:bg-zinc-950 rounded-3xl w-full" 
                  style={{ height: '70vh', minHeight: '600px' }}
                  id={`bracket-fullscreen-${currentEvt.id}`}
                >
                  <div className="absolute top-4 right-4 z-50">
                  <button
                    onClick={() => {
                      const el = document.getElementById(`bracket-fullscreen-${currentEvt.id}`);
                      if (el) {
                        if (!document.fullscreenElement) {
                          el.requestFullscreen().catch(()=>{});
                        } else {
                          document.exitFullscreen().catch(()=>{});
                        }
                      }
                    }}
                    className="flex items-center gap-2 px-3 py-2 bg-white/90 dark:bg-zinc-800/90 backdrop-blur-sm border border-zinc-200 dark:border-zinc-700 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 shadow-sm transition-all"
                  >
                    <Maximize size={16} />
                    <span className="text-xs font-bold leading-none">Toàn màn hình</span>
                  </button>
                </div>
                <LiveBracket koMatches={koMatches} currentEvt={currentEvt} />
              </div>
              </>
            );
          })()}
        </div>
      )}

      {isShareQrOpen && publicTournamentUrl ? (
        <div
          className="fixed inset-0 z-[140] grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-qr-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsShareQrOpen(false);
          }}
        >
          <div
            className="relative rounded-lg border border-zinc-200 bg-white p-5 text-center shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 sm:p-6"
            style={{ width: 'min(92vw, 440px)', maxWidth: 'min(92vw, 440px)' }}
          >
            <button
              type="button"
              title="Đóng mã QR"
              onClick={() => setIsShareQrOpen(false)}
              className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              <X size={20} />
            </button>
            <p className="text-xs font-black uppercase tracking-widest text-blue-600">Chia sẻ giải đấu</p>
            <h2 id="share-qr-title" className="mt-1 pr-9 text-xl font-black text-zinc-950 dark:text-white">Quét mã để xem lịch và kết quả</h2>
            <div className="mx-auto mt-5 w-fit rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
              <QRCodeCanvas
                ref={qrCanvasRef}
                value={publicTournamentUrl}
                size={512}
                level="M"
                includeMargin
                className="h-auto max-w-full"
                style={{ width: 'clamp(240px, 25vw, 360px)', height: 'auto', maxWidth: '100%' }}
              />
            </div>
            <p className="mx-auto mt-3 max-w-md break-all text-xs font-semibold text-zinc-500">{publicTournamentUrl}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => void handleCopyQrImage()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700">
                <Copy size={16} /> Sao chép ảnh
              </button>
              <button type="button" onClick={() => void handleShareTournamentLink()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-300 px-4 text-sm font-black text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                <Link size={16} /> Sao chép link
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
