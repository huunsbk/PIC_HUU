/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Tournament, Team, Group, Match, AuditLog, TournamentSettings, SeedType, GroupStanding, ThirdPlaceStanding, EventData, Account } from './types';
import { generateRoundRobinMatches, calculateGroupStandings, calculateBestThirdPlaces, generateKnockoutMatchesSchema, balanceMatchesRestTime } from './utils/tournamentEngine';
import { supabase, checkSupabaseConnection } from './supabaseClient';

interface AppState {
  tournament: Tournament;
  teams: Record<string, Team>;
  groups: Record<string, Group>;
  matches: Match[];
  logs: AuditLog[];
  darkMode: boolean;
  selectedTab: string;
  activeGroupId: string | null;
  advanceSelectionMode: 'auto' | 'manual';
  manualQualifiedTeamIds: string[];
  events: Record<string, EventData>;
  currentEventId: string;
  isAdmin: boolean;
  setAdminStatus: (status: boolean) => void;
  supabaseConnected: boolean | null; // null = checking, true = online, false = using offline/cached data
  supabaseSyncError: string | null;
  isLoadingSupabase?: boolean;

  // Multi-tier accounts configuration
  accounts: Account[];
  currentUser: string | null;
  currentSessionId: string | null;
  userRole: 'guest' | 'admin1' | 'admin2' | 'admin3'; // guest = viewer, admin1 = root, admin2 = level 2, admin3 = level 3
  activeTenantId: string; // 'default' or username of level 2 account
  setAuthStatus: (role: 'guest' | 'admin1' | 'admin2' | 'admin3', username: string | null, tenantId: string, sessionId?: string) => Promise<void>;
  logout: () => Promise<void>;
  setTenantId: (tenantId: string) => Promise<void>;
  addAccount2: (acc: Account) => Promise<boolean>;
  updateAccount2: (acc: Account) => Promise<boolean>;
  deleteAccount2: (username: string) => Promise<boolean>;

  // Actions
  checkConnection: () => Promise<boolean>;
  checkAdminSession: () => Promise<void>;
  updateTournament: (t: Partial<Tournament>) => void;
  updateSettings: (s: Partial<TournamentSettings>) => void;
  
  // Event actions
  addEvent: (name: string) => void;
  deleteEvent: (id: string) => Promise<void>;
  renameEvent: (id: string, newName: string) => void;
  setCurrentEvent: (id: string) => void;
  
  // Teams actions
  addTeam: (name: string, seed: SeedType) => { success: boolean; message: string };
  deleteTeam: (id: string) => void;
  updateTeam: (id: string, name: string, seed: SeedType) => { success: boolean; message: string };
  importTeams: (csvContent: string) => { success: boolean; addedCount: number; errors: string[] };

  // Group actions
  setupGroups: (numGroups: number) => void;
  autoGroupTeams: (method: 'random' | 'seed', numGroups: number) => void;
  moveTeamToGroup: (teamId: string, targetGroupId: string | null) => void;
  clearAllGroups: () => void;

  // Match Actions
  generateMatchesForGroup: (groupId: string) => void;
  clearMatchesForGroup: (groupId: string) => void;
  updateMatchScore: (matchId: string, scoreA: number | null, scoreB: number | null) => void;
  updateMatchStatus: (matchId: string, status: 'pending' | 'playing' | 'finished') => void;
  resetMatchScore: (matchId: string) => void;
  generateAllSchedules: () => void;
  

  // Knockout Actions
  generateKnockoutBracket: (size: 4 | 8 | 16 | 32) => void;
  updateKnockoutScore: (matchId: string, scoreA: number | null, scoreB: number | null) => void;
  updateKnockoutParticipant: (matchId: string, slot: 'A' | 'B', teamNameOrId: string) => void;
  propagateKnockoutResets: (changedMatchIds: string[]) => void;
  clearKnockout: () => void;

  // UI Actions
  setDarkMode: (dark: boolean) => void;
  setSelectedTab: (tab: string) => void;
  setActiveGroupId: (id: string | null) => void;
  setAdvanceSelectionMode: (mode: 'auto' | 'manual') => void;
  toggleManualQualifiedTeam: (teamId: string) => void;
  clearManualQualifiedTeams: () => void;
  
  // System actions
  addLog: (action: string, details: string) => void;
  clearLogs: () => void;
  resetAll: () => void;
  initSupabase: () => Promise<void>;
  syncRealtimeMatch: (payload: any) => void;
}

const DEFAULT_SETTINGS: TournamentSettings = {
  winPoint: 2,
  lossPoint: 1,
  maxScore: 15,
  capScore: 17,
  advanceCount: 2,
};

const DEFAULT_TOURNAMENT: Tournament = {
  id: 't-1',
  name: 'Giải Vô Địch Pickleball NGÂN SƠN 2026 lần 1',
  organization: 'CLB Pickleball NGÂN SƠN',
  location: 'Doanh Thơ',
  date: '2026-06-30',
  settings: DEFAULT_SETTINGS,
};

const syncStateToSupabase = async (state: AppState, originalSet?: any) => {
  const errors: string[] = [];
  try {
    const tournamentId = state.tournament.id || 't-1';
    const activeTenantId = state.activeTenantId || 'default';
    const eventIds = Object.keys(state.events || {});
    
    // BẢO VỆ CHÉO: NGĂN CHẶN XÓA NHẦM DỮ LIỆU KHI CHUYỂN ĐỔI TENANT (RACE CONDITION CHECK)
    const hasTenantMismatch = eventIds.some(id => {
      if (activeTenantId === 'default') return id.includes('__');
      return !id.startsWith(`${activeTenantId}__`);
    });

    if (hasTenantMismatch) {
      console.warn(`[Supabase Sync] HỦY BỎ ĐỒNG BỘ: Phát hiện mismatch giữa activeTenantId (${activeTenantId}) và dữ liệu events. Đang trong quá trình chuyển đổi.`);
      return;
    }

    // Thu thập tất cả id trong Local State để tiến hành đồng bộ dọn dẹp
    const teamIdsInState: string[] = [];
    const groupIdsInState: string[] = [];
    const matchIdsInState: string[] = [];

    // Chuẩn bị dữ liệu snake_case sẵn sàng cho insertion
    const allGroups: any[] = [];
    const allTeams: any[] = [];
    const allMatches: any[] = [];

    Object.keys(state.events || {}).forEach(evtId => {
      const evt = state.events[evtId];
      if (evt) {
        // Thu thập và map Groups
        if (evt.groups) {
          Object.values(evt.groups).forEach(g => {
            groupIdsInState.push(g.id);
            allGroups.push({
              id: g.id,
              name: g.name,
              team_ids: Array.isArray(g.teamIds) ? g.teamIds : [],
              event_id: evtId,
              tenant_id: activeTenantId,
              tournament_id: tournamentId
            });
          });
        }
        
        // Thu thập và map Teams
        if (evt.teams) {
          Object.values(evt.teams).forEach(t => {
            teamIdsInState.push(t.id);
            allTeams.push({
              id: t.id,
              name: t.name,
              group_id: t.groupId || null,
              seed: t.seed || 'none',
              event_id: evtId,
              tenant_id: activeTenantId,
              tournament_id: tournamentId
            });
          });
        }
        
        // Thu thập và map Matches
        if (evt.matches) {
          evt.matches.forEach(m => {
            matchIdsInState.push(m.id);

            // Tự động detect nếu teamAId/teamBId thực chất là dạng CŨ (lưu text đại diện như "Thắng Vòng 32"), chuyển nó sang placeholder.
            const isTeamANotReal = m.teamAId && !evt.teams[m.teamAId];
            const isTeamBNotReal = m.teamBId && !evt.teams[m.teamBId];

            const realTeamAId = isTeamANotReal ? null : (m.teamAId || null);
            const realTeamBId = isTeamBNotReal ? null : (m.teamBId || null);
            
            const pH_A = isTeamANotReal ? m.teamAId : (m.placeholderA || null);
            const pH_B = isTeamBNotReal ? m.teamBId : (m.placeholderB || null);

            allMatches.push({
              id: m.id,
              group_id: m.groupId || null,
              team_a_id: realTeamAId,
              team_b_id: realTeamBId,
              score_a: m.scoreA !== undefined && m.scoreA !== null ? m.scoreA : null,
              score_b: m.scoreB !== undefined && m.scoreB !== null ? m.scoreB : null,
              winner_id: m.winnerId || null,
              status: m.status || 'pending',
              round: m.round,
              knockout_round_name: m.knockoutRoundName || null,
              knockout_match_id: m.knockoutMatchId || null,
              next_match_id: m.nextMatchId || null,
              next_match_slot: m.nextMatchSlot || null,
              placeholder_a: pH_A,
              placeholder_b: pH_B,
              event_id: evtId,
              tenant_id: activeTenantId,
              tournament_id: tournamentId
            });
          });
        }
      }
    });

    // Hàm phụ trợ khử trùng lặp (unique by ID) để triệt tiêu vĩnh viễn lỗi ON CONFLICT DO UPDATE command cannot affect row a second time
    const uniqueById = <T extends { id: string }>(arr: T[]): T[] => {
      const map = new Map<string, T>();
      arr.forEach(item => {
        if (item && item.id) {
          map.set(item.id, item);
        }
      });
      return Array.from(map.values());
    };

    const uniqueGroups = uniqueById(allGroups);
    const uniqueTeams = uniqueById(allTeams);
    const uniqueMatches = uniqueById(allMatches);

    console.log(`[Supabase Sync] Bắt đầu đồng bộ trực tuyến cho CSDL "${activeTenantId}". Đang dọn dẹp theo trình tự ngược...`);

    // ==========================================
    // THÌ 1: PRUNING PHASE (REVERSE DEPENDENCY ORDER)
    // ==========================================

    // 1. Dọn dẹp Matches dư thừa trước vì nó trỏ FK tới Teams, Groups, và Events (chỉ dọn dẹp thuộc tenant hiện tại)
    try {
      let mQuery = supabase.from('matches').delete();
      if (activeTenantId === 'default') {
        mQuery = mQuery.not('event_id', 'like', '%__%');
      } else {
        mQuery = mQuery.like('event_id', `${activeTenantId}__%`);
      }
      
      if (matchIdsInState.length > 0) {
        const { error: mDelErr } = await mQuery.not('id', 'in', `(${matchIdsInState.join(',')})`);
        if (mDelErr) {
          console.error("Lỗi tại bước dọn dẹp MATCHES:", mDelErr.message);
          errors.push(`Dọn dẹp trận đấu: ${mDelErr.message}`);
        }
      } else {
        const { error: mClearErr } = await mQuery;
        if (mClearErr) {
          console.error("Lỗi tại bước xóa sạch MATCHES:", mClearErr.message);
          errors.push(`Xóa sạch trận đấu: ${mClearErr.message}`);
        }
      }
    } catch (exc: any) {
      console.error("Lỗi tại bước dọn dẹp MATCHES (Ngoại lệ):", exc);
    }

    // 2. Dọn dẹp Teams dư thừa vì nó trỏ FK tới Groups và Events (chỉ dọn dẹp thuộc tenant hiện tại)
    try {
      let tQuery = supabase.from('teams').delete();
      if (activeTenantId === 'default') {
        tQuery = tQuery.not('event_id', 'like', '%__%');
      } else {
        tQuery = tQuery.like('event_id', `${activeTenantId}__%`);
      }
      
      if (teamIdsInState.length > 0) {
        const { error: tDelErr } = await tQuery.not('id', 'in', `(${teamIdsInState.join(',')})`);
        if (tDelErr) {
          console.error("Lỗi tại bước dọn dẹp TEAMS:", tDelErr.message);
          errors.push(`Dọn dẹp đội: ${tDelErr.message}`);
        }
      } else {
        const { error: tClearErr } = await tQuery;
        if (tClearErr) {
          console.error("Lỗi tại bước xóa sạch TEAMS:", tClearErr.message);
          errors.push(`Xóa sạch đội: ${tClearErr.message}`);
        }
      }
    } catch (exc: any) {
      console.error("Lỗi tại bước dọn dẹp TEAMS (Ngoại lệ):", exc);
    }

    // 3. Dọn dẹp Groups dư thừa vì nó trỏ FK tới Events (chỉ dọn dẹp thuộc tenant hiện tại)
    try {
      let gQuery = supabase.from('groups').delete();
      if (activeTenantId === 'default') {
        gQuery = gQuery.not('event_id', 'like', '%__%');
      } else {
        gQuery = gQuery.like('event_id', `${activeTenantId}__%`);
      }

      if (groupIdsInState.length > 0) {
        const { error: gDelErr } = await gQuery.not('id', 'in', `(${groupIdsInState.join(',')})`);
        if (gDelErr) {
          console.error("Lỗi tại bước dọn dẹp GROUPS:", gDelErr.message);
          errors.push(`Dọn dẹp bảng đấu: ${gDelErr.message}`);
        }
      } else {
        const { error: gClearErr } = await gQuery;
        if (gClearErr) {
          console.error("Lỗi tại bước xóa sạch GROUPS:", gClearErr.message);
          errors.push(`Xóa sạch bảng đấu: ${gClearErr.message}`);
        }
      }
    } catch (exc: any) {
      console.error("Lỗi tại bước dọn dẹp GROUPS (Ngoại lệ):", exc);
    }

    // 4. Dọn dẹp Events dư thừa (chỉ dọn dẹp thuộc tenant hiện tại)
    try {
      let eQuery = supabase.from('events').delete();
      if (activeTenantId === 'default') {
        eQuery = eQuery.not('id', 'like', '%__%');
      } else {
        eQuery = eQuery.like('id', `${activeTenantId}__%`);
      }

      if (eventIds.length > 0) {
        const { error: eDelErr } = await eQuery.not('id', 'in', `(${eventIds.join(',')})`);
        if (eDelErr) {
          console.error("Lỗi tại bước dọn dẹp EVENTS:", eDelErr.message);
          errors.push(`Dọn dẹp sự kiện: ${eDelErr.message}`);
        }
      } else {
        const { error: eClearErr } = await eQuery;
        if (eClearErr) {
          console.error("Lỗi tại bước xóa sạch EVENTS:", eClearErr.message);
          errors.push(`Xóa sạch sự kiện: ${eClearErr.message}`);
        }
      }
    } catch (exc: any) {
      console.error("Lỗi tại bước dọn dẹp EVENTS (Ngoại lệ):", exc);
    }


    // ==========================================
    // THÌ 2: UPSERT/INSERT PHASE (FORWARD ORDER)
    // ==========================================

    console.log(`[Supabase Sync] Đang ghi đè dữ liệu theo trình tự xuôi để bảo vệ Foreign Key...`);

    // Bước 1: Ghi dữ liệu vào bảng `tournament`
    try {
      const { error: tErr } = await supabase.from('tournament').upsert({
        id: tournamentId,
        name: state.tournament.name,
        organization: state.tournament.organization,
        location: state.tournament.location,
        date: state.tournament.date,
        settings: state.tournament.settings,
        current_event_id: state.currentEventId
      }, { onConflict: 'id' });
      if (tErr) {
        console.error("Lỗi tại bước 1 (tournament):", tErr.message, tErr.details);
        errors.push(`Giải đấu: ${tErr.message}`);
        return;
      }
    } catch (exc: any) {
      console.error("Lỗi tại bước 1 - tournament (Ngoại lệ):", exc);
      return;
    }

    // Bước 1.5: Đảm bảo dòng giải đấu cho Tenant đã tồn tại trên Supabase
    try {
      const { data: exist } = await supabase
        .from('tournament')
        .select('id')
        .eq('id', activeTenantId)
        .maybeSingle();

      if (!exist) {
        await supabase.from('tournament').insert({
          id: activeTenantId,
          name: `Giải đấu của ${activeTenantId}`,
          settings: DEFAULT_SETTINGS,
          tenant_id: activeTenantId
        });
      }
    } catch (err) {
      console.error("Lỗi khởi tạo Tenant Tournament:", err);
    }

    // Bước 2: Ghi dữ liệu vào bảng `events` (sau khi đã có tournament)
    try {
      const dbEventsArray = eventIds.map(evtId => {
        const evt = state.events[evtId];
        return {
          id: evtId,
          name: evt.name,
          settings: evt.settings || state.tournament.settings || DEFAULT_SETTINGS,
          active_group_id: (evt.activeGroupId && evt.activeGroupId !== 'knockout') ? evt.activeGroupId : null,
          advance_selection_mode: evt.advanceSelectionMode || 'auto',
          manual_qualified_team_ids: evt.manualQualifiedTeamIds || [],
          tenant_id: activeTenantId,
          tournament_id: tournamentId
        };
      });
      
      if (dbEventsArray.length > 0) {
        const { data: eData, error: eErr } = await supabase.from('events').upsert(dbEventsArray, { onConflict: 'id' }).select();
        if (eErr) {
          console.error(`[SYNC EVENTS FATAL] Lỗi tại bước 2 (events):`, eErr.message, eErr.details, "Payload:", dbEventsArray);
          errors.push(`Sự kiện: ${eErr.message}`);
          return; // Ngừng quá trình đồng bộ để bảo vệ toàn vẹn Foreign Key nếu events thất bại
        } else {
          console.log(`[SYNC EVENTS] Upserted ${eData?.length} events successfully.`, eData?.map((e: any) => e.id));
        }
      }
    } catch (exc: any) {
      console.error("Lỗi tại bước 2 - events (Ngoại lệ):", exc);
      return;
    }

    // Bước 3: Ghi dữ liệu vào bảng `groups` (sau khi đã có events)
    try {
      if (uniqueGroups.length > 0) {
        const { error: gErr } = await supabase.from('groups').upsert(uniqueGroups, { onConflict: 'id' });
        if (gErr) {
          console.error("Lỗi tại bước 3 (groups):", gErr.message, gErr.details);
          errors.push(`Bảng đấu: ${gErr.message}`);
        }
      }
    } catch (exc: any) {
      console.error("Lỗi tại bước 3 - groups (Ngoại lệ):", exc);
    }

    // Bước 4: Ghi dữ liệu vào bảng `teams` (sau khi đã có groups và events)
    try {
      if (uniqueTeams.length > 0) {
        const { error: tmErr } = await supabase.from('teams').upsert(uniqueTeams, { onConflict: 'id' });
        if (tmErr) {
          console.error("Lỗi tại bước 4 (teams):", tmErr.message, tmErr.details);
          errors.push(`Đội: ${tmErr.message}`);
        }
      }
    } catch (exc: any) {
      console.error("Lỗi tại bước 4 - teams (Ngoại lệ):", exc);
    }

    // Bước 5: Ghi dữ liệu vào bảng `matches` (sau khi đã có đầy đủ teams, groups, events)
    try {
      if (uniqueMatches.length > 0) {
        const { error: mErr } = await supabase.from('matches').upsert(uniqueMatches, { onConflict: 'id' });
        if (mErr) {
          console.error("Lỗi tại bước 5 (matches):", mErr.message, mErr.details);
          errors.push(`Trận đấu: ${mErr.message}`);
        }
      }
    } catch (exc: any) {
      console.error("Lỗi tại bước 5 - matches (Ngoại lệ):", exc);
    }

    if (errors.length === 0) {
      console.log(`[Supabase Sync] Đồng bộ thành công hoàn tất!`);
    }

  } catch (err: any) {
    errors.push(`Ngoại lệ đồng bộ Supabase: ${err.message || err}`);
    console.error('Ngoại lệ đồng bộ Supabase (Phát hiện ngoài tầm kiểm soát):', err);
  }

  // Cập nhật trạng thái thông báo lỗi đồng bộ Supabase lên Zustand Store
  if (originalSet) {
    if (errors.length > 0) {
      originalSet({ supabaseSyncError: errors.join('; ') });
    } else {
      originalSet({ supabaseSyncError: null });
    }
  }
};

let isAuthListenerSetup = false;

export const useTournamentStore = create<AppState>()(
  persist(
    (originalSet, get) => {
      const set: typeof originalSet = (nextStateOrFn, replace) => {
        let hasActualDataChanges = false;
        originalSet((state) => {
          const nextState = typeof nextStateOrFn === 'function' ? (nextStateOrFn as Function)(state) : nextStateOrFn;
          
          const dataKeys = [
            'teams', 'groups', 'matches', 'tournament', 'events', 
            'currentEventId', 'activeGroupId', 'advanceSelectionMode', 
            'manualQualifiedTeamIds'
          ];
          hasActualDataChanges = Object.keys(nextState || {}).some(key => dataKeys.includes(key));

          const mergedState = { ...state, ...nextState };
          
          const activeId = mergedState.currentEventId || '';
          const events = { ...mergedState.events };
          
          if (activeId !== '' && !events[activeId] && activeId === 'event-default') {
            events[activeId] = {
              id: activeId,
              name: 'Đôi Nam Chuyên Nghiệp',
              teams: {},
              groups: {},
              matches: [],
              settings: mergedState.tournament?.settings || DEFAULT_SETTINGS,
              activeGroupId: null,
              advanceSelectionMode: 'auto',
              manualQualifiedTeamIds: []
            };
          }
          
          // Self-migration check (Đã sửa lỗi Tenant ID mismatch)
          if (
            activeId !== '' &&
            state.currentEventId === mergedState.currentEventId && // CHỈ MIGRATE NẾU KHÔNG ĐANG ĐỔI EVENT
            Object.keys(mergedState.teams || {}).length > 0 &&
            (!events[activeId] || Object.keys(events[activeId]?.teams || {}).length === 0)
          ) {
            if (!events[activeId]) {
              events[activeId] = {
                id: activeId,
                name: 'Nội dung mới',
                teams: {}, groups: {}, matches: [], settings: mergedState.tournament?.settings || DEFAULT_SETTINGS,
                activeGroupId: null, advanceSelectionMode: 'auto', manualQualifiedTeamIds: []
              };
            }
            events[activeId] = {
              ...events[activeId],
              teams: mergedState.teams,
              groups: mergedState.groups,
              matches: mergedState.matches,
              activeGroupId: mergedState.activeGroupId || null,
              advanceSelectionMode: mergedState.advanceSelectionMode || 'auto',
              manualQualifiedTeamIds: mergedState.manualQualifiedTeamIds || [],
              settings: mergedState.tournament?.settings || DEFAULT_SETTINGS,
            };
          }

          const hasFlatChanges = 
            'teams' in nextState ||
            'groups' in nextState ||
            'matches' in nextState ||
            'activeGroupId' in nextState ||
            'advanceSelectionMode' in nextState ||
            'manualQualifiedTeamIds' in nextState;

          const isTournamentSettingsChanged = nextState.tournament && nextState.tournament.settings;

          if (activeId !== '' && events[activeId] && (hasFlatChanges || isTournamentSettingsChanged)) {
            events[activeId] = {
              ...events[activeId],
              teams: mergedState.teams || {},
              groups: mergedState.groups || {},
              matches: mergedState.matches || [],
              activeGroupId: mergedState.activeGroupId || null,
              advanceSelectionMode: mergedState.advanceSelectionMode || 'auto',
              manualQualifiedTeamIds: mergedState.manualQualifiedTeamIds || [],
              settings: mergedState.tournament?.settings || events[activeId].settings || DEFAULT_SETTINGS,
            };
          }

          if ('currentEventId' in nextState) {
            const newActiveId = nextState.currentEventId;
            if (events[newActiveId]) {
              const targetEvent = events[newActiveId];
              return {
                ...mergedState,
                events,
                teams: targetEvent.teams || {},
                groups: targetEvent.groups || {},
                matches: targetEvent.matches || [],
                activeGroupId: targetEvent.activeGroupId || null,
                advanceSelectionMode: targetEvent.advanceSelectionMode || 'auto',
                manualQualifiedTeamIds: targetEvent.manualQualifiedTeamIds || [],
                tournament: {
                  ...mergedState.tournament,
                  settings: targetEvent.settings || mergedState.tournament?.settings || DEFAULT_SETTINGS
                }
              };
            }
          }

          return {
            ...mergedState,
            events,
          };
        }, replace);

        // Sync with Supabase on modifications if admin holds active session and not loading from database
        const currentState = get();
        if (currentState.isAdmin && hasActualDataChanges && !currentState.isLoadingSupabase) {
          syncStateToSupabase(currentState, originalSet);
        }
      };

      const getTimestampStr = () => {
        const d = new Date();
        return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + d.toLocaleDateString('vi-VN');
      };

      const logToStore = (action: string, details: string) => {
        const newLog: AuditLog = {
          timestamp: getTimestampStr(),
          action,
          details,
        };
        originalSet((state) => ({ logs: [newLog, ...state.logs].slice(0, 500) })); // Lưu tối đa 500 logs
        
        // Save audit activity stream concurrently if Admin is actively mutating data
        const currentState = get();
        if (currentState.isAdmin) {
          supabase.from('audit_logs').insert([{
            timestamp: newLog.timestamp,
            action: newLog.action,
            details: newLog.details,
            tenant_id: currentState.activeTenantId || 'default'
          }]).then();
        }
      };

      return {
        tournament: DEFAULT_TOURNAMENT,
        teams: {},
        groups: {},
        matches: [],
        logs: [],
        darkMode: false,
        selectedTab: 'dashboard',
        activeGroupId: null,
        advanceSelectionMode: 'auto',
        manualQualifiedTeamIds: [],
        events: {
          'event-default': {
            id: 'event-default',
            name: 'Đôi Nam Chuyên Nghiệp',
            teams: {},
            groups: {},
            matches: [],
            settings: DEFAULT_SETTINGS,
            activeGroupId: null,
            advanceSelectionMode: 'auto',
            manualQualifiedTeamIds: []
          }
        },
        currentEventId: 'event-default',
        accounts: [],
        currentUser: null,
        currentSessionId: null,
        userRole: 'guest',
        activeTenantId: 'default',
        isLoadingSupabase: false,
        setAuthStatus: async (role, username, tenantId, providedSessionId) => {
          const sessionId = providedSessionId || Date.now().toString() + Math.random().toString(36).substring(2, 9);
          console.log(`[Session Setup] Bắt đầu thiết lập Auth cho "${username}". Khởi tạo Session ID mới: "${sessionId}".`);
          
          originalSet({
            userRole: role,
            currentUser: username,
            currentSessionId: sessionId,
            activeTenantId: tenantId,
            isAdmin: role === 'admin1' || role === 'admin2' || role === 'admin3',
            selectedTab: role === 'admin3' ? 'scoreEntry' : 'dashboard',
            isLoadingSupabase: true
          });

          if (username && (role === 'admin2' || role === 'admin3')) {
            try {
              // Cập nhật session_id lên bảng tournament JSON (nguồn cấu hình tài khoản duy nhất) - Cần await đồng bộ để tránh race condition!
              console.log(`[Session Setup] Đang truy vấn accounts_config để thiết lập Session ID...`);
              const { data } = await supabase.from('tournament')
                .select('settings')
                .eq('id', 'accounts_config')
                .single();
              
              if (data && data.settings) {
                let arr: any[] = [];
                let wrapsInObj = false;
                
                if (Array.isArray(data.settings)) {
                  arr = data.settings;
                } else if (data.settings.accounts && Array.isArray(data.settings.accounts)) {
                  arr = data.settings.accounts;
                  wrapsInObj = true;
                }
                
                const updatedAccounts = arr.map((a: any) => 
                  a.username === username ? { ...a, session_id: sessionId } : a
                );
                
                console.log(`[Session Setup] Đang thực hiện ghi đồng bộ Session ID "${sessionId}" của "${username}" lên cơ sở dữ liệu...`);
                const { error: upsertErr } = await supabase.from('tournament')
                  .upsert({
                    id: 'accounts_config',
                    name: 'Cấu hình tài khoản cấp 2',
                    organization: 'Hệ thống',
                    location: '',
                    date: '',
                    settings: wrapsInObj ? { accounts: updatedAccounts } : updatedAccounts
                  });
                
                if (upsertErr) {
                  console.error('[Session Setup] Ghi Session ID thất bại:', upsertErr);
                } else {
                  console.log(`[Session Setup] Lưu Session ID "${sessionId}" lên DB thành công.`);
                }
              } else {
                console.warn('[Session Setup] Không tìm thấy dữ liệu accounts_config trong CSDL để cập nhật.');
              }
            } catch (e) {
              console.error('[Session Setup] Lỗi trong quá trình kết nối lưu Session ID:', e);
            }
              
            // Đảm bảo URL trên trình duyệt đồng bộ với tenant được cấp quyền, tránh nhầm lẫn
            requestAnimationFrame(() => {
              const expectedHash = '/' + tenantId.replace(/_/g, '-');
              if (window.location.hash.replace(/^#\/?/, '').trim() !== tenantId.replace(/_/g, '-')) {
                window.location.hash = expectedHash;
              }
            });
          }
          
          console.log('[Session Setup] Đã đồng bộ cấu hình tài khoản. Đang khởi chạy tải lại cơ sở dữ liệu initSupabase()...');
          await get().initSupabase();
        },
        logout: async () => {
          // Guard to avoid recursive logout calls if already guest
          const state = get();
          if (state.userRole === 'guest' && !state.isAdmin && !state.currentUser) {
            return;
          }
          
          // Clear credentials synchronously first to avoid race conditions with auth listeners
          originalSet({
            userRole: 'guest',
            currentUser: null,
            currentSessionId: null,
            activeTenantId: 'default',
            isAdmin: false,
          });
          
          // Reset URL hash so client isn't stuck on the active admin tenant path as guest on reload
          try {
            window.location.hash = '';
          } catch (e) {}

          try {
            await supabase.auth.signOut();
          } catch (e) {
            console.warn('Error signing out during manual logout:', e);
          }
          
          localStorage.removeItem('pickleball-tournament-cache');
          sessionStorage.removeItem('pickleball-tournament-cache'); // clean up any old sessionStorage cache too
          window.location.reload();
        },
        setTenantId: async (tenantId) => {
          const currentState = get();
          
          if (currentState.userRole === 'admin2' || currentState.userRole === 'admin3') {
            const allowedTenant = currentState.userRole === 'admin3' ? 
              currentState.accounts.find(a => a.username === currentState.currentUser)?.parentTenantId || 'default' : 
              currentState.currentUser;
              
            // Normalize replacing - with _ to match mapping strategy in App.tsx
            const normalizedAllowed = allowedTenant.replace(/-/g, '_').toLowerCase();
            
            // Dứt khoát bắt buộc kết nối đúng dữ liệu của mình, không có ngoại lệ
            if (tenantId.toLowerCase() !== normalizedAllowed) { 
              console.warn(`Chuyển đổi CSDL không hợp lệ cho tài khoản này. Đã khóa để bảo vệ. Expected ${normalizedAllowed}, got ${tenantId.toLowerCase()}`);
              // Chuyển hướng người dùng về đúng khu vực của họ thay vì đăng xuất ngay lập tức gây khó chịu, nhưng nếu có hack cố tình thì chặn
              const expectedHash = '/' + normalizedAllowed.replace(/_/g, '-');
              if (window.location.hash.replace(/^#\/?/, '').trim() !== normalizedAllowed.replace(/_/g, '-')) {
                window.location.hash = expectedHash;
                setTimeout(() => window.location.reload(), 100);
                return;
              }
              // Fallback an toàn
              currentState.logout();
              return;
            }
          }
          
          originalSet({ activeTenantId: tenantId, isLoadingSupabase: true });
          await get().initSupabase();
        },
         addAccount2: async (acc) => {
          const nextAccounts = [...get().accounts, acc];
          set({ accounts: nextAccounts });
          let success = false;
          try {
            const { error } = await supabase.from('tournament').upsert({
              id: 'accounts_config',
              name: 'Cấu hình tài khoản cấp 2',
              organization: 'Hệ thống',
              location: '',
              date: '',
              settings: { accounts: nextAccounts },
              current_event_id: ''
            });
            if (!error) success = true;
          } catch (e) {
            console.error('Lỗi khi lưu cấu hình tài khoản:', e);
          }
          return success;
        },
        updateAccount2: async (acc) => {
          const nextAccounts = get().accounts.map(a => a.username === acc.username ? acc : a);
          set({ accounts: nextAccounts });
          let success = false;
          try {
            const { error } = await supabase.from('tournament').upsert({
              id: 'accounts_config',
              name: 'Cấu hình tài khoản cấp 2',
              organization: 'Hệ thống',
              location: '',
              date: '',
              settings: { accounts: nextAccounts },
              current_event_id: ''
            });
            if (!error) success = true;
          } catch (e) {
            console.error('Lỗi khi cập nhật cấu hình tài khoản:', e);
          }
          return success;
        },
        deleteAccount2: async (username) => {
          const nextAccounts = get().accounts.filter(a => a.username !== username);
          set({ accounts: nextAccounts });
          let success = false;
          try {
            const { error } = await supabase.from('tournament').upsert({
              id: 'accounts_config',
              name: 'Cấu hình tài khoản cấp 2',
              organization: 'Hệ thống',
              location: '',
              date: '',
              settings: { accounts: nextAccounts },
              current_event_id: ''
            });
            if (!error) success = true;
          } catch (e) {
            console.error('Lỗi khi xóa cấu hình tài khoản:', e);
          }
          return success;
        },
        isAdmin: false,
        setAdminStatus: (status: boolean) => {
          if (!status) {
            get().setAuthStatus('guest', null, 'default');
          } else {
            set({ isAdmin: true, userRole: 'admin2' });
          }
        },
        supabaseConnected: null,
        supabaseSyncError: null,
        checkConnection: async () => {
          const connected = await checkSupabaseConnection();
          set({ supabaseConnected: connected });
          return connected;
        },
        checkAdminSession: async () => {
          const state = get();
          if ((state.userRole === 'admin2' || state.userRole === 'admin3') && state.currentUser && state.currentSessionId) {
            try {
              let latestDbSessionId = null;
              
              // Đọc từ cấu hình JSON của bảng tournament (nguồn cấu hình tài khoản duy nhất)
              const { data: tData } = await supabase.from('tournament').select('settings').eq('id', 'accounts_config').single();
              if (tData && tData.settings) {
                let arr: any[] = [];
                if (Array.isArray(tData.settings)) {
                  arr = tData.settings;
                } else if (tData.settings.accounts && Array.isArray(tData.settings.accounts)) {
                  arr = tData.settings.accounts;
                }
                const acc = arr.find((a: any) => a.username === state.currentUser);
                if (acc && acc.session_id) {
                  latestDbSessionId = acc.session_id;
                }
              }

              console.log(`[SingleSession Audit - checkAdminSession] Polling check:`, {
                username: state.currentUser,
                localSessionId: state.currentSessionId,
                dbSessionId: latestDbSessionId,
                status: latestDbSessionId === state.currentSessionId ? 'MATCH (Valid)' : (latestDbSessionId ? 'MISMATCH (Invalid)' : 'NO_SESSION_IN_DB')
              });

              if (latestDbSessionId && latestDbSessionId !== state.currentSessionId) {
                console.warn(`[SingleSession Audit] Phát hiện đăng nhập song song qua polling:`, {
                  username: state.currentUser,
                  localSessionId: state.currentSessionId,
                  dbSessionId: latestDbSessionId,
                  reason: 'Mismatch between memory session state and database session config.'
                });
                alert(`CẢNH BÁO: KẾT NỐI BỊ NGẮT\n\nTài khoản "${state.currentUser}" vừa được đăng nhập thành công ở thiết bị hoặc trình duyệt khác.\n\nNhằm bảo vệ tính toàn vẹn dữ liệu lúc nhập điểm, hệ thống chỉ cho phép 1 tài khoản hoạt động trên 1 thiết bị/1 trình duyệt ở cùng một thời điểm.\n\nPhiên làm việc này sẽ được đăng xuất tự động.`);
                get().logout();
              }
            } catch(e) {
              console.warn('[SingleSession Audit - checkAdminSession] Gặp lỗi kiểm tra phiên đăng nhập:', e);
            }
          }
        },

        updateTournament: (t) => {
          if (!get().isAdmin) return;
          set((state) => {
            const updated = { ...state.tournament, ...t };
            return { tournament: updated };
          });
          logToStore('Cấu hình Giải', `Cập nhật thông tin tổng quan của giải đấu.`);
        },

        updateSettings: (s) => {
          if (!get().isAdmin) return;
          set((state) => {
            const updatedSettings = { ...state.tournament.settings, ...s };
            const updated = { ...state.tournament, settings: updatedSettings };
            return { tournament: updated };
          });
          logToStore('Cấu hình Điểm', `Thay đổi cài đặt điểm chạm: ${JSON.stringify(s)}`);
        },

        addEvent: (name) => {
          if (!get().isAdmin) return;
          const tenantPrefix = get().activeTenantId === 'default' ? '' : `${get().activeTenantId}__`;
          const id = `${tenantPrefix}event-${Math.random().toString(36).substring(2, 9)}`;
          const trimmedName = name.trim() || 'Nội dung mới';
          set((state) => {
            const nextEvents = { ...state.events };
            nextEvents[id] = {
              id,
              name: trimmedName,
              teams: {},
              groups: {},
              matches: [],
              settings: state.tournament?.settings || DEFAULT_SETTINGS,
              activeGroupId: null,
              advanceSelectionMode: 'auto',
              manualQualifiedTeamIds: []
            };
            return {
              events: nextEvents,
              currentEventId: id,
              teams: {},
              groups: {},
              matches: [],
              activeGroupId: null,
              advanceSelectionMode: 'auto',
              manualQualifiedTeamIds: []
            };
          });
          logToStore('Nội Dung', `Thêm nội dung thi đấu mới: "${trimmedName}"`);
        },

        deleteEvent: async (id) => {
          if (!get().isAdmin) return;
          const event = get().events[id];
          if (!event) return;

          // 1. Xóa trên Supabase trước (theo thứ tự FK)
          // Đặt active_group_id thành null trước để gỡ bỏ ràng buộc khóa ngoại (nếu có)
          try {
            await supabase.from('events').update({ active_group_id: null }).eq('id', id);
            const { error: e1 } = await supabase.from('matches').delete().eq('event_id', id);
            if (e1) throw e1;
            const { error: e2 } = await supabase.from('teams').delete().eq('event_id', id);
            if (e2) throw e2;
            const { error: e3 } = await supabase.from('groups').delete().eq('event_id', id);
            if (e3) throw e3;
            const { error: e4 } = await supabase.from('events').delete().eq('id', id);
            if (e4) throw e4;
          } catch (err) {
            console.error("Lỗi xóa dữ liệu liên quan trên Supabase:", err);
          }

          // 2. Cập nhật State Zustand
          set((state) => {
            const nextEvents = { ...state.events };
            delete nextEvents[id];
            
            let nextActiveId = state.currentEventId;
            if (state.currentEventId === id) {
              const keys = Object.keys(nextEvents);
              nextActiveId = keys.length > 0 ? keys[0] : '';
            }
            
            // Cập nhật lại state với event mới
            const activeEvent = nextEvents[nextActiveId];
            return {
              events: nextEvents,
              currentEventId: nextActiveId,
              teams: activeEvent?.teams || {},
              groups: activeEvent?.groups || {},
              matches: activeEvent?.matches || [],
              activeGroupId: activeEvent?.activeGroupId || null
            };
          });
          
          logToStore('Nội Dung', `Xóa vĩnh viễn nội dung: "${event.name}" và toàn bộ dữ liệu liên quan.`);
        },

        renameEvent: (id, newName) => {
          if (!get().isAdmin) return;
          const trimmed = newName.trim();
          if (!trimmed) return;
          const oldName = get().events[id]?.name || id;

          set((state) => {
            const nextEvents = { ...state.events };
            if (nextEvents[id]) {
              nextEvents[id] = {
                ...nextEvents[id],
                name: trimmed
              };
            }
            return { events: nextEvents };
          });
          logToStore('Nội Dung', `Đổi tên nội dung thi đấu từ "${oldName}" thành "${trimmed}"`);
        },

        setCurrentEvent: (id) => {
          if (!get().events[id]) return;
          set({ currentEventId: id });
          logToStore('Hệ Thống', `Chuyển sang điều hành nội dung: "${get().events[id]?.name}"`);
        },

        addTeam: (name, seed) => {
          if (!get().isAdmin) {
            return { success: false, message: 'Yêu cầu quyền Admin để thêm đội.' };
          }
          if (!get().currentEventId) {
            return { success: false, message: 'Không có nội dung thi đấu nào được chọn. Vui lòng tạo Nội dung mới trước.' };
          }
          const trimmedName = name.trim();
          if (!trimmedName) {
            return { success: false, message: 'Tên đội không được rỗng.' };
          }

          const existing = Object.values(get().teams).find(
            (t) => t.name.toLowerCase() === trimmedName.toLowerCase()
          );
          if (existing) {
            return { success: false, message: `Đội "${trimmedName}" đã tồn tại trên hệ thống.` };
          }

          const id = `team-${Math.random().toString(36).substring(2, 9)}`;
          const newTeam: Team = {
            id,
            name: trimmedName,
            groupId: null,
            seed,
          };

          set((state) => ({
            teams: { ...state.teams, [id]: newTeam },
          }));

          logToStore('Quản lý Đội', `Thêm đội mới: "${trimmedName}" (Hạt giống: ${seed === 'none' ? 'Không' : seed})`);
          return { success: true, message: 'Thêm đội thành công.' };
        },

        deleteTeam: (id) => {
          if (!get().isAdmin) return;
          const team = get().teams[id];
          if (!team) return;

          const teamGroupId = team.groupId;

          set((state) => {
            // Xóa đội khỏi danh sách map
            const nextTeams = { ...state.teams };
            delete nextTeams[id];

            // Xóa đội khỏi bảng đấu thuộc về (nếu có)
            const nextGroups = { ...state.groups };
            if (teamGroupId && nextGroups[teamGroupId]) {
              nextGroups[teamGroupId] = {
                ...nextGroups[teamGroupId],
                teamIds: nextGroups[teamGroupId].teamIds.filter((tId) => tId !== id),
              };
            }

            // Xóa các trận đấu có sự tham gia của đội này
            const nextMatches = state.matches.filter(
              (m) => m.teamAId !== id && m.teamBId !== id
            );

            return {
              teams: nextTeams,
              groups: nextGroups,
              matches: nextMatches,
            };
          });

          logToStore('Quản lý Đội', `Xóa đội: "${team.name}". Tự động gỡ khỏi bảng đấu & hủy các trận đấu có liên quan.`);
        },

        updateTeam: (id, name, seed) => {
          if (!get().isAdmin) {
            return { success: false, message: 'Yêu cầu quyền Admin để sửa thông tin đội.' };
          }
          const trimmedName = name.trim();
          if (!trimmedName) {
            return { success: false, message: 'Tên đội không được rỗng.' };
          }

          const existing = Object.values(get().teams).find(
            (t) => t.id !== id && t.name.toLowerCase() === trimmedName.toLowerCase()
          );
          if (existing) {
            return { success: false, message: `Tên đội "${trimmedName}" bị trùng với đội đã có.` };
          }

          const oldTeam = get().teams[id];
          if (!oldTeam) return { success: false, message: 'Không tìm thấy thông tin đội.' };

          set((state) => {
            const updated = { ...state.teams[id], name: trimmedName, seed };
            return {
              teams: { ...state.teams, [id]: updated },
            };
          });

          logToStore('Quản lý Đội', `Sửa thông tin đội: "${oldTeam.name}" -> "${trimmedName}" (Hạt giống: ${seed})`);
          return { success: true, message: 'Sửa thông tin đội thành công.' };
        },

        importTeams: (csvContent) => {
          if (!get().isAdmin) {
            return { success: false, addedCount: 0, errors: ['Yêu cầu quyền Admin để nhập danh sách từ file.'] };
          }
          if (!csvContent.trim()) {
            return { success: false, addedCount: 0, errors: ['Nội dung file trống.'] };
          }

          const lines = csvContent.split(/\r?\n/);
          let addedCount = 0;
          const errors: string[] = [];
          const currentTeams = Object.values(get().teams);

          set((state) => {
            const nextTeams = { ...state.teams };

            lines.forEach((line, idx) => {
              const cleaned = line.trim();
              if (!cleaned || idx === 0 && (cleaned.toLowerCase().includes('tên') || cleaned.toLowerCase().includes('name') || cleaned.toLowerCase().includes('stt'))) {
                // Bỏ qua dòng tiêu đề hoặc dòng rỗng
                return;
              }

              // Định dạng dòng: "STT,Tên đội,Hạt giống" hoặc chỉ có "Tên đội" hoặc phân tách bằng tab/phẩy
              let parts = cleaned.split(/,|	/);
              let teamName = '';
              let seedStr: SeedType = 'none';

              if (parts.length === 1) {
                teamName = parts[0].trim();
              } else if (parts.length === 2) {
                // Kiểm tra xem cột đầu là STT số không
                if (!isNaN(Number(parts[0].trim()))) {
                  teamName = parts[1].trim();
                } else {
                  teamName = parts[0].trim();
                  const potentialSeed = parts[1].trim();
                  if (['1', '2', '3', '4'].includes(potentialSeed)) {
                    seedStr = potentialSeed as SeedType;
                  }
                }
              } else if (parts.length >= 3) {
                teamName = parts[1].trim();
                const potentialSeed = parts[2].trim();
                if (['1', '2', '3', '4'].includes(potentialSeed)) {
                  seedStr = potentialSeed as SeedType;
                }
              }

              // Làm sạch dấu ngoặc kép bọc quanh tên đội
              teamName = teamName.replace(/^["']|["']$/g, '').trim();

              if (!teamName) return;

              const isDup = Object.values(nextTeams).some(
                (t) => t.name.toLowerCase() === teamName.toLowerCase()
              );

              if (isDup) {
                errors.push(`Dòng ${idx + 1}: Trùng tên đội "${teamName}" nên bỏ qua.`);
                return;
              }

              const id = `team-${Math.random().toString(36).substring(2, 9)}`;
              nextTeams[id] = {
                id,
                name: teamName,
                groupId: null,
                seed: seedStr,
              };
              addedCount++;
            });

            return { teams: nextTeams };
          });

          if (addedCount > 0) {
            logToStore('Nhập Đội', `Nhập thành công ${addedCount} đội từ file Excel/CSV mẫu.`);
          }
          return { success: true, addedCount, errors };
        },

        setupGroups: (numGroups) => {
          if (!get().isAdmin) return;
          if (numGroups < 1 || numGroups > 32) return;

          const getGroupName = (index: number) => {
            let name = '';
            let temp = index;
            while (temp >= 0) {
              name = String.fromCharCode((temp % 26) + 65) + name;
              temp = Math.floor(temp / 26) - 1;
            }
            return `Bảng ${name}`;
          };

          set((state) => {
            const nextGroups: Record<string, Group> = {};
            const teamIds = Object.keys(state.teams);
            
            // Xóa sạch thông tin bảng đấu cũ của các đội
            const nextTeams = { ...state.teams };
            teamIds.forEach((tId) => {
              nextTeams[tId].groupId = null;
            });

            // Tạo các bảng mới tinh
            const activeEventId = state.currentEventId || 'event-default';
            for (let i = 0; i < numGroups; i++) {
              const gId = `group-${i + 1}-${activeEventId}`;
              const gName = getGroupName(i);
              nextGroups[gId] = {
                id: gId,
                name: gName,
                teamIds: [],
              };
            }
            
            // Xóa tất cả các trận đấu vòng bảng cũ
            const nextMatches = state.matches.filter((m) => m.groupId === 'knockout');

            return {
              groups: nextGroups,
              teams: nextTeams,
              matches: nextMatches,
              activeGroupId: Object.keys(nextGroups)[0] || null,
            };
          });

          logToStore('Phân Bảng', `Tạo ${numGroups} bảng đấu trống mới (Bảng A, B...). Đã đặt lại lịch thi đấu vòng bảng.`);
        },

        autoGroupTeams: (method, numGroups) => {
          if (!get().isAdmin) return;
          if (numGroups < 1 || numGroups > 32) return;
          const allTeams = Object.values(get().teams);
          if (allTeams.length === 0) return;

          const activeEventId = get().currentEventId || 'event-default';

          const getGroupName = (index: number) => {
            let name = '';
            let temp = index;
            while (temp >= 0) {
              name = String.fromCharCode((temp % 26) + 65) + name;
              temp = Math.floor(temp / 26) - 1;
            }
            return `Bảng ${name}`;
          };

          // Khởi tạo bảng rỗng với Event ID duy nhất
          const groupList: Group[] = Array.from({ length: numGroups }, (_, idx) => ({
            id: `group-${idx + 1}-${activeEventId}`,
            name: getGroupName(idx),
            teamIds: [],
          }));

          // Sắp xếp đội
          let targetTeams = [...allTeams];

          if (method === 'random') {
            // Trộn ngẫu nhiên
            targetTeams.sort(() => Math.random() - 0.5);
            targetTeams.forEach((team, index) => {
              const grpIdx = index % numGroups;
              groupList[grpIdx].teamIds.push(team.id);
            });
          } else {
            // Phân bổ theo hạt giống chuyên nghiệp
            const seed1 = targetTeams.filter((t) => t.seed === '1').sort(() => Math.random() - 0.5);
            const seed2 = targetTeams.filter((t) => t.seed === '2').sort(() => Math.random() - 0.5);
            const seed3 = targetTeams.filter((t) => t.seed === '3').sort(() => Math.random() - 0.5);
            const seed4 = targetTeams.filter((t) => t.seed === '4').sort(() => Math.random() - 0.5);
            const noSeed = targetTeams.filter((t) => t.seed === 'none').sort(() => Math.random() - 0.5);

            let pointer = 0;
            const distribute = (list: Team[]) => {
              list.forEach((team) => {
                groupList[pointer].teamIds.push(team.id);
                pointer = (pointer + 1) % numGroups;
              });
            };

            distribute(seed1);
            distribute(seed2);
            distribute(seed3);
            distribute(seed4);
            distribute(noSeed);
          }

          set((state) => {
            const nextGroups: Record<string, Group> = {};
            const nextTeams = { ...state.teams };

            groupList.forEach((g) => {
              nextGroups[g.id] = g;
              g.teamIds.forEach((tId) => {
                if (nextTeams[tId]) {
                  nextTeams[tId].groupId = g.id;
                }
              });
            });

            // Đặt lại các trận đấu vòng bảng cũ
            const nextMatches = state.matches.filter((m) => m.groupId === 'knockout');

            return {
              groups: nextGroups,
              teams: nextTeams,
              matches: nextMatches,
              activeGroupId: groupList[0]?.id || null,
            };
          });

          logToStore('Chia Bảng', `Tự động phân bổ ${allTeams.length} đội vào ${numGroups} bảng đấu theo thể thức [${method === 'random' ? 'Ngẫu nhiên' : 'Hạt giống chuyên nghiệp UEFA'}].`);
        },

        moveTeamToGroup: (teamId, targetGroupId) => {
          if (!get().isAdmin) return;
          const team = get().teams[teamId];
          if (!team) return;

          const sourceGroupId = team.groupId;
          if (sourceGroupId === targetGroupId) return;

          set((state) => {
            const nextTeams = { ...state.teams };
            nextTeams[teamId] = { ...nextTeams[teamId], groupId: targetGroupId };

            const nextGroups = { ...state.groups };

            // Gỡ khỏi bảng nguồn
            if (sourceGroupId && nextGroups[sourceGroupId]) {
              nextGroups[sourceGroupId] = {
                ...nextGroups[sourceGroupId],
                teamIds: nextGroups[sourceGroupId].teamIds.filter((id) => id !== teamId),
              };
            }

            // Thêm vào bảng đích
            if (targetGroupId && nextGroups[targetGroupId]) {
              nextGroups[targetGroupId] = {
                ...nextGroups[targetGroupId],
                teamIds: [...nextGroups[targetGroupId].teamIds, teamId],
              };
            }

            // ĐỒNG BỘ DỮ LIỆU: Khi chuyển đội, toàn bộ lịch và kết quả đấu của các bảng liên quan phải được reset
            // để tránh dữ liệu rác, đảm bảo tính tái tính toán chuẩn.
            const nextMatches = state.matches.filter(
              (m) => m.groupId !== sourceGroupId && m.groupId !== targetGroupId
            );

            return {
              teams: nextTeams,
              groups: nextGroups,
              matches: nextMatches,
            };
          });

          const srcLabel = sourceGroupId ? get().groups[sourceGroupId]?.name : 'Không bảng';
          const destLabel = targetGroupId ? get().groups[targetGroupId]?.name : 'Không bảng';
          logToStore(
            'Chuyển Đội',
            `Kéo thả chuyển đội "${team.name}" từ [${srcLabel}] sang [${destLabel}]. Lịch thi đấu vòng tròn của 2 bảng này đã tự động được dọn dẹp để tái tính toán.`
          );
        },

        clearAllGroups: () => {
          if (!get().isAdmin) return;
          set((state) => {
            const nextGroups: Record<string, Group> = {};
            const nextTeams = { ...state.teams };
            
            Object.keys(nextTeams).forEach((tId) => {
              nextTeams[tId].groupId = null;
            });

            // Xóa lịch bảng, giữ lại knockout nếu có
            const nextMatches = state.matches.filter((m) => m.groupId === 'knockout');

            return {
              groups: nextGroups,
              teams: nextTeams,
              matches: nextMatches,
              activeGroupId: null,
            };
          });
          logToStore('Xóa Bảng', 'Giải tán toàn bộ các bảng đấu cấu hình.');
        },

        generateMatchesForGroup: (groupId) => {
          if (!get().isAdmin) return;
          const group = get().groups[groupId];
          if (!group || group.teamIds.length === 0) return;

          const settings = get().tournament.settings;
          const generated = generateRoundRobinMatches(groupId, group.teamIds, settings);

          set((state) => {
            // Lọc bỏ trận đấu cũ của bảng này
            const otherMatches = state.matches.filter((m) => m.groupId !== groupId);
            const knockoutMatches = otherMatches.filter((m) => m.groupId === 'knockout');
            const otherGroupMatches = otherMatches.filter((m) => m.groupId !== 'knockout');
            
            // Sơ đồ sắp xếp toàn bộ trận đấu vòng bảng tối ưu khoảng nghỉ
            const balancedAllGroupMatches = balanceMatchesRestTime([...otherGroupMatches, ...generated]);
            const finalMatchesList = [...balancedAllGroupMatches, ...knockoutMatches];

            // Cập nhật cả trong events của currentEventId
            const curEvtId = state.currentEventId;
            const updatedEvents = { ...state.events };
            if (updatedEvents[curEvtId]) {
              updatedEvents[curEvtId] = {
                ...updatedEvents[curEvtId],
                matches: finalMatchesList
              };
            }

            return {
              matches: finalMatchesList,
              events: updatedEvents,
            };
          });

          logToStore('Lập Lịch', `Khởi tạo lịch đấu vòng tròn cho [${group.name}] gồm ${generated.length} trận đấu.`);
        },

        clearMatchesForGroup: (groupId) => {
          if (!get().isAdmin) return;
          const group = get().groups[groupId];
          set((state) => {
            const finalMatchesList = state.matches.filter((m) => m.groupId !== groupId);

            // Cập nhật cả trong events của currentEventId
            const curEvtId = state.currentEventId;
            const updatedEvents = { ...state.events };
            if (updatedEvents[curEvtId]) {
              updatedEvents[curEvtId] = {
                ...updatedEvents[curEvtId],
                matches: finalMatchesList
              };
            }

            return {
              matches: finalMatchesList,
              events: updatedEvents,
            };
          });
          if (group) {
            logToStore('Dọn Lịch', `Hủy toàn bộ lịch thi đấu và điểm số của bảng [${group.name}].`);
          }
        },

        updateMatchStatus: (matchId, status) => {
          if (!get().isAdmin) return;
          set((state) => {
            const matchesCopy = state.matches.map((m) => {
              if (m.id !== matchId) return m;
              return { ...m, status };
            });

            // Update in specific event
            const eventUpdates: Record<string, any> = {};
            // find which event this match belongs to
            let targetEventId: string | undefined;
            Object.values(state.events).forEach(evt => {
              if (evt.matches?.some(em => em.id === matchId)) {
                targetEventId = evt.id;
              }
            });
            
            if (targetEventId) {
              const evt = state.events[targetEventId];
              eventUpdates[targetEventId] = {
                ...evt,
                matches: (evt.matches || []).map(em => em.id === matchId ? { ...em, status } : em)
              };
            }

            return {
              matches: matchesCopy,
              events: { ...state.events, ...eventUpdates },
            };
          });
        },

        updateMatchScore: (matchId, scoreA, scoreB) => {
          if (!get().isAdmin) return;
          set((state) => {
            const matchesCopy = state.matches.map((m) => {
              if (m.id !== matchId) return m;

              if (scoreA === null || scoreB === null) {
                return { ...m, scoreA: null, scoreB: null, winnerId: null, status: 'pending' as const };
              }

              let winnerId: string | null = null;
              if (scoreA > scoreB) {
                winnerId = m.teamAId;
              } else if (scoreB > scoreA) {
                winnerId = m.teamBId;
              }

              return {
                ...m,
                scoreA,
                scoreB,
                winnerId,
                status: 'finished' as const,
              };
            });

            const eventUpdates: Record<string, any> = {};
            let targetEventId: string | undefined;
            Object.values(state.events).forEach(evt => {
              if (evt.matches?.some(em => em.id === matchId)) {
                targetEventId = evt.id;
              }
            });
            
            if (targetEventId) {
              const evt = state.events[targetEventId];
              eventUpdates[targetEventId] = {
                ...evt,
                matches: evt.matches.map((em: any) => em.id === matchId ? { 
                  ...em,
                  scoreA: scoreA,
                  scoreB: scoreB,
                  winnerId: (scoreA !== null && scoreB !== null) ? (scoreA > scoreB ? em.teamAId : (scoreB > scoreA ? em.teamBId : null)) : null,
                  status: (scoreA !== null && scoreB !== null) ? 'finished' : 'pending'
                } : em)
              };
            }

            return { 
                matches: matchesCopy,
                events: { ...state.events, ...eventUpdates }
            };
          });

          const m = get().matches.find((x) => x.id === matchId);
          if (m && scoreA !== null && scoreB !== null) {
            const tA = m.teamAId ? get().teams[m.teamAId]?.name : (m.placeholderA || 'Đội A');
            const tB = m.teamBId ? get().teams[m.teamBId]?.name : (m.placeholderB || 'Đội B');
            logToStore('Cập Nhật Điểm', `Cập nhật kết quả trận đấu: [${tA}] ${scoreA} - ${scoreB} [${tB}].`);
          }
        },

        resetMatchScore: (matchId) => {
          if (!get().isAdmin) return;
          const m = get().matches.find((x) => x.id === matchId);
          set((state) => {
            const matchesCopy = state.matches.map((x) => {
              if (x.id !== matchId) return x;
              return { ...x, scoreA: null, scoreB: null, winnerId: null, status: 'pending' as const };
            });

            const curEvtId = state.currentEventId;
            const updatedEvents = { ...state.events };
            if (updatedEvents[curEvtId]) {
              updatedEvents[curEvtId] = {
                ...updatedEvents[curEvtId],
                matches: matchesCopy,
              };
            }

            return {
              matches: matchesCopy,
              events: updatedEvents,
            };
          });
          if (m) {
            const tA = m.teamAId ? get().teams[m.teamAId]?.name : (m.placeholderA || 'Đội A');
            const tB = m.teamBId ? get().teams[m.teamBId]?.name : (m.placeholderB || 'Đội B');
            logToStore('Hủy Kết Quả', `Đặt lại trận đấu về trạng thái chưa diễn ra: ${tA} gặp ${tB}.`);
          }
        },

         generateAllSchedules: () => {
          if (!get().isAdmin) return;
          const groupsMap = get().groups;
          const groupIdsList = Object.keys(groupsMap);
          if (groupIdsList.length === 0) return;

          const settings = get().tournament.settings;
          let allGeneratedMatches: Match[] = [];

          groupIdsList.forEach((groupId) => {
            const group = groupsMap[groupId];
            if (group && group.teamIds && group.teamIds.length > 0) {
              const generated = generateRoundRobinMatches(groupId, group.teamIds, settings);
              allGeneratedMatches = [...allGeneratedMatches, ...generated];
            }
          });

          set((state) => {
            // Giữ lại các trận knockout
            const knockoutMatches = state.matches.filter((m) => m.groupId === 'knockout');
            
            // Cân bằng khoảng nghỉ cho các trận vòng bảng mới tạo
            const balancedAllGroupMatches = balanceMatchesRestTime(allGeneratedMatches);
            const finalMatchesList = [...balancedAllGroupMatches, ...knockoutMatches];

            // Cập nhật vào event hiện tại
            const currentEventId = state.currentEventId;
            const updatedEvents = { ...state.events };
            if (updatedEvents[currentEventId]) {
              updatedEvents[currentEventId] = {
                ...updatedEvents[currentEventId],
                matches: finalMatchesList,
              };
            }

            return {
              matches: finalMatchesList,
              events: updatedEvents,
            };
          });

          logToStore('Lập Lịch', `Khởi tạo nhanh lịch toàn giải thành công.`);
        },

        generateKnockoutBracket: (size) => {
          if (!get().isAdmin) return;
          // 1. Tính toán bảng xếp hạng của các bảng
          const standingsByGroup: Record<string, GroupStanding[]> = {};
          const groupsMap = get().groups;
          const teamsMap = get().teams;
          const matches = get().matches;
          const settings = get().tournament.settings;

          const groupIdsList = Object.keys(groupsMap);
          
          groupIdsList.forEach((gId) => {
            const g = groupsMap[gId];
            const groupMatches = matches.filter((m) => m.groupId === gId);
            standingsByGroup[gId] = calculateGroupStandings(gId, g.teamIds, groupMatches, teamsMap, settings);
          });

          // 2. Chuyển đổi tên bảng để xuất bảng hạng 3
          const groupNamesMap: Record<string, string> = {};
          groupIdsList.forEach((gid) => {
            groupNamesMap[gid] = groupsMap[gid].name;
          });

          const bestThirds = calculateBestThirdPlaces(standingsByGroup, matches, settings, groupNamesMap);

          // 3. Chuẩn bị danh sách đội đi tiếp dựa trên Rank kết quả vòng bảng
          // Ta tạo placeholders đại diện mang nhãn ví dụ "Nhất Bảng A", "Nhì Bảng B", v.v.
          // Nhưng nếu vòng bảng đã xong và sắp xếp hoàn chỉnh, ta đổ thẳng tên đội thật vào các placeholders này!
          const advList: { label: string; placeholder: string; sourceRank?: number; sourceGroupId?: string }[] = [];

          // Dưới đây là sơ đồ cơ bản lấy đội đi tiếp cho bracket 8 đội:
          // Trận 1: Nhất Bảng A vs Nhì Bảng B (hoặc Đội hạng 3 tốt nhất)
          // Trận 2: Nhất Bảng C vs Nhì Bảng D
          // Trận 3: Nhất Bảng B vs Nhì Bảng A
          // Trận 4: Nhất Bảng D vs Nhì Bảng C (hoặc hoán vị hạt giống)
          
          // Tạo một danh sách các slots cho vòng loại trực tiếp
          // Chúng ta sẽ gán các đội thật trong Group Standings nếu có
          const getRealTeamOrPlaceholder = (gLabel: string, rank: number, backupName: string): string => {
            // Xem gLabel có tương ứng với bảng nào không (vd "Bảng A" -> group-1)
            const matchedGroup = Object.values(groupsMap).find(g => g.name.toLowerCase() === gLabel.toLowerCase());
            if (matchedGroup) {
              // Kiểm tra xem vòng bảng của bảng này đã thi đấu xong chưa
              const groupMatches = matches.filter((m) => m.groupId === matchedGroup.id);
              const isGroupFinished = groupMatches.length > 0 && groupMatches.every(m => m.status === 'finished');
              
              if (isGroupFinished) {
                const standing = standingsByGroup[matchedGroup.id];
                const foundItem = standing ? standing.find(s => s.rank === rank) : null;
                if (foundItem) {
                  return tIdToNameOrId(foundItem.teamId, teamsMap);
                }
              }

              // Nếu chưa thi đấu xong hoặc không tìm thấy đội, hiển thị Nhất/Nhì/Ba [Tên Bảng] theo đúng yêu cầu
              const rankWords: Record<number, string> = { 1: 'Nhất', 2: 'Nhì', 3: 'Ba' };
              const prefix = rankWords[rank] || `Hạng ${rank}`;
              return `${prefix} ${matchedGroup.name}`;
            }
            return backupName;
          };

          const getThirdPlaceOrPlaceholder = (rank: number, backupName: string): string => {
            const groupMatches = matches.filter((m) => m.groupId !== 'knockout');
            const allGroupMatchesFinished = groupMatches.length > 0 && groupMatches.every(m => m.status === 'finished');
            
            if (allGroupMatchesFinished) {
              const cand = bestThirds.find(c => c.rank === rank);
              if (cand) {
                return teamsMap[cand.teamId]?.name || cand.teamName;
              }
            }
            // Hiển thị "Ba Xuất Sắc" nếu chưa có kết quả vòng bảng
            return `Ba ${rank <= 2 ? 'bảng' : ''} xuất sắc ${rank}`;
          };

          const slotsData: string[] = [];

          if (get().advanceSelectionMode === 'manual') {
            const manualIds = get().manualQualifiedTeamIds || [];
            for (let i = 0; i < size; i++) {
              if (i < manualIds.length) {
                slotsData.push(teamsMap[manualIds[i]]?.name || `Đội ${i + 1}`);
              } else {
                slotsData.push(`Chờ tích thêm vé...`);
              }
            }
            slotsData.forEach((placeholder, idx) => {
              advList.push({
                label: `Slot ${idx + 1}`,
                placeholder: placeholder,
              });
            });
          } else {
            if (size === 4) {
              // 4 ĐỘI
              slotsData.push(
                getRealTeamOrPlaceholder('Bảng A', 1, 'Nhất Bảng A'),
                getRealTeamOrPlaceholder('Bảng B', 2, 'Nhì Bảng B'),
                getRealTeamOrPlaceholder('Bảng B', 1, 'Nhất Bảng B'),
                getRealTeamOrPlaceholder('Bảng A', 2, 'Nhì Bảng A')
              );

              slotsData.forEach((placeholder, idx) => {
                advList.push({
                  label: `Slot ${idx + 1}`,
                  placeholder: placeholder,
                });
              });

            } else if (size === 8) {
              // Cân bằng cho 2-4 bảng đấu rộng rãi
              slotsData.push(
                getRealTeamOrPlaceholder('Bảng A', 1, 'Nhất Bảng A'),
                getThirdPlaceOrPlaceholder(2, 'Hạng 3 Xuất sắc 2'),
                
                getRealTeamOrPlaceholder('Bảng C', 1, 'Nhất Bảng C'),
                getRealTeamOrPlaceholder('Bảng B', 2, 'Nhì Bảng B'),

                getRealTeamOrPlaceholder('Bảng B', 1, 'Nhất Bảng B'),
                getThirdPlaceOrPlaceholder(1, 'Hạng 3 Xuất sắc 1'),

                getRealTeamOrPlaceholder('Bảng D', 1, 'Nhất Bảng D') || getRealTeamOrPlaceholder('Bảng A', 2, 'Nhì Bảng A'),
                getRealTeamOrPlaceholder('Bảng C', 2, 'Nhì Bảng C') || getRealTeamOrPlaceholder('Bảng B', 2, 'Nhì Bảng B')
              );

              slotsData.forEach((placeholder, idx) => {
                advList.push({
                  label: `Slot ${idx + 1}`,
                  placeholder: placeholder,
                });
              });

            } else if (size === 16 || size === 32) {
              // Thuật toán chuẩn cho 16 ĐỘI (8 bảng) và 32 ĐỘI (16 bảng) 
              // Giải quyết bài toán Nhất A vs Nhì I (32 đội), Nhất A vs Nhì E (16 đội)
              const groupsList = Object.values(groupsMap);
              const numGroups = size / 2; // 8 cho 16 đội, 16 cho 32 đội
              const half = numGroups / 2;

              for (let i = 0; i < numGroups; i++) {
                let idxA = i;
                let idxB = i < half ? i + half : i - half;

                // Tránh lỗi nếu số lượng group tạo ra chưa đủ
                const safeIdxA = idxA % (groupsList.length || 1);
                const safeIdxB = idxB % (groupsList.length || 1);

                const gA = groupsList[safeIdxA];
                const gB = groupsList[safeIdxB];

                const groupNameA = gA ? gA.name : String.fromCharCode(65 + idxA);
                const groupNameB = gB ? gB.name : String.fromCharCode(65 + idxB);

                const defaultNameA = `Nhất ${groupNameA}`;
                const defaultNameB = `Nhì ${groupNameB}`;

                const placeholderA = gA 
                  ? getRealTeamOrPlaceholder(gA.name, 1, defaultNameA) 
                  : defaultNameA;

                const placeholderB = gB 
                  ? getRealTeamOrPlaceholder(gB.name, 2, defaultNameB) 
                  : defaultNameB;

                advList.push(
                  { label: `Trận ${i+1}-A`, placeholder: placeholderA },
                  { label: `Trận ${i+1}-B`, placeholder: placeholderB }
                );
              }
            } else {
              // 24 Teams or other...
            }
          }

          const koMatches = generateRoundRobinMatches ? generateKnockoutMatchesSchema(size, advList) : [];

          set((state) => {
            const filtered = state.matches.filter((m) => m.groupId !== 'knockout');
            const finalMatchesList = [...filtered, ...koMatches];

            const curEvtId = state.currentEventId;
            const updatedEvents = { ...state.events };
            if (updatedEvents[curEvtId]) {
              updatedEvents[curEvtId] = {
                ...updatedEvents[curEvtId],
                matches: finalMatchesList,
              };
            }

            return {
              matches: finalMatchesList,
              events: updatedEvents,
            };
          });

          logToStore(
            'Nhánh Loại Trực Tiếp',
            `Khởi tạo thành công Sơ đồ thi đấu trực tiếp (Knockout) quy mô ${size} đội, tự động điền các đội vượt qua vòng bảng dựa theo bảng xếp hạng hiện tại.`
          );
        },

        updateKnockoutScore: (matchId, scoreA, scoreB) => {
          if (!get().isAdmin) return;
          
          set((state) => {
            const matchesMap = new Map<string, Match>();
            state.matches.forEach((m) => {
              matchesMap.set(m.id, { ...m });
            });

            const currentMatch = matchesMap.get(matchId);
            if (!currentMatch) return state;

            if (scoreA === null || scoreB === null) {
              currentMatch.scoreA = null;
              currentMatch.scoreB = null;
              currentMatch.winnerId = null;
              currentMatch.status = 'pending';
            } else {
              const winner = scoreA > scoreB ? currentMatch.teamAId : currentMatch.teamBId;
              currentMatch.scoreA = scoreA;
              currentMatch.scoreB = scoreB;
              currentMatch.winnerId = winner;
              currentMatch.status = 'finished';
            }

            // Propagate winner / null recursively down the tree
            const queue = [matchId];
            const visited = new Set<string>();

            while (queue.length > 0) {
              const currentId = queue.shift()!;
              if (visited.has(currentId)) continue;
              visited.add(currentId);

              const m = matchesMap.get(currentId);
              if (!m) continue;

              const nextId = m.nextMatchId;
              if (nextId) {
                const nextMatch = matchesMap.get(nextId);
                if (nextMatch) {
                  const winnerOfCurrent = m.winnerId;
                  const slot = m.nextMatchSlot || 'A';

                  if (slot === 'A') {
                    nextMatch.teamAId = winnerOfCurrent;
                  } else {
                    nextMatch.teamBId = winnerOfCurrent;
                  }

                  // If winner is null, we must also reset the downstream match and queue it
                  if (!winnerOfCurrent) {
                    nextMatch.scoreA = null;
                    nextMatch.scoreB = null;
                    nextMatch.winnerId = null;
                    nextMatch.status = 'pending';
                    queue.push(nextId);
                  } else {
                    // If nextMatch was finished, reset if winner is no longer compatible
                    if (nextMatch.status === 'finished') {
                      if (nextMatch.winnerId !== nextMatch.teamAId && nextMatch.winnerId !== nextMatch.teamBId) {
                        nextMatch.scoreA = null;
                        nextMatch.scoreB = null;
                        nextMatch.winnerId = null;
                        nextMatch.status = 'pending';
                        queue.push(nextId);
                      }
                    }
                  }
                }
              }
            }

            const updatedMatches = Array.from(matchesMap.values());
            const curEvtId = state.currentEventId;
            const updatedEvents = { ...state.events };
            if (updatedEvents[curEvtId]) {
              updatedEvents[curEvtId] = {
                ...updatedEvents[curEvtId],
                matches: updatedMatches,
              };
            }

            return {
              matches: updatedMatches,
              events: updatedEvents,
            };
          });

          // Log
          const updatedTarget = get().matches.find((x) => x.id === matchId);
          if (updatedTarget && scoreA !== null && scoreB !== null) {
            const tA = updatedTarget.teamAId ? get().teams[updatedTarget.teamAId]?.name : 'Đội A';
            const tB = updatedTarget.teamBId ? get().teams[updatedTarget.teamBId]?.name : 'Đội B';

            logToStore(
              'Điểm Loại Trực Tiếp',
              `Trận [${updatedTarget.knockoutRoundName} - ${updatedTarget.knockoutMatchId}]: ${tA} ${scoreA} - ${scoreB} ${tB}.`
            );
          }
        },

        updateKnockoutParticipant: (matchId, slot, teamNameOrId) => {
          if (!get().isAdmin) return;
          set((state) => {
            const updated = state.matches.map((m) => {
              if (m.id !== matchId) return m;
              const nextM = { ...m };
              if (slot === 'A') {
                nextM.teamAId = teamNameOrId.trim();
              } else {
                nextM.teamBId = teamNameOrId.trim();
              }
              // Reset điểm khi có thay đổi đấu thủ
              nextM.scoreA = null;
              nextM.scoreB = null;
              nextM.winnerId = null;
              nextM.status = 'pending';
              return nextM;
            });

            const curEvtId = state.currentEventId;
            const updatedEvents = { ...state.events };
            if (updatedEvents[curEvtId]) {
              updatedEvents[curEvtId] = {
                ...updatedEvents[curEvtId],
                matches: updated,
              };
            }

            return {
              matches: updated,
              events: updatedEvents,
            };
          });
          const m = get().matches.find((x) => x.id === matchId);
          if (m) {
            logToStore(
              'Điều Chỉnh Trực Tiếp',
              `Sửa thủ công đấu thủ tại trận [${m.knockoutRoundName}] - Nhánh Slot ${slot} thành "${teamNameOrId}".`
            );
          }
        },

        propagateKnockoutResets: (changedMatchIds) => {
          if (!get().isAdmin) return;
          if (changedMatchIds.length === 0) return;

          set((state) => {
            const matchesMap = new Map<string, Match>();
            state.matches.forEach((m) => {
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

              // 1. Reset current match scores, winner, and status
              currentMatch.scoreA = null;
              currentMatch.scoreB = null;
              currentMatch.winnerId = null;
              currentMatch.status = 'pending';

              // 2. Find downstream match and reset/propagate
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

            const updatedMatchesList = Array.from(matchesMap.values());
            const curEvtId = state.currentEventId;
            const updatedEvents = { ...state.events };
            if (updatedEvents[curEvtId]) {
              updatedEvents[curEvtId] = {
                ...updatedEvents[curEvtId],
                matches: updatedMatchesList,
              };
            }

            return {
              matches: updatedMatchesList,
              events: updatedEvents,
            };
          });

          logToStore('Điều Chỉnh Trực Tiếp', `Đã dọn dẹp các nhánh hạ nguồn bị ảnh hưởng do thay đổi sơ đồ thi đấu.`);
        },

        clearKnockout: () => {
          if (!get().isAdmin) return;
          set((state) => {
            const finalMatchesList = state.matches.filter((m) => m.groupId !== 'knockout');

            const curEvtId = state.currentEventId;
            const updatedEvents = { ...state.events };
            if (updatedEvents[curEvtId]) {
              updatedEvents[curEvtId] = {
                ...updatedEvents[curEvtId],
                matches: finalMatchesList,
              };
            }

            return {
              matches: finalMatchesList,
              events: updatedEvents,
            };
          });
          logToStore('Xóa Nhánh', 'Đã xóa bỏ toàn bộ sơ đồ đấu loại trực tiếp (Knockout).');
        },

        setDarkMode: (dark) => set({ darkMode: dark }),
        setSelectedTab: (tab) => set({ selectedTab: tab }),
        setActiveGroupId: (id) => set({ activeGroupId: id }),
        setAdvanceSelectionMode: (mode) => {
          if (!get().isAdmin) return;
          set({ advanceSelectionMode: mode });
          logToStore('Tuyển chọn', `Thay đổi chế độ tuyển chọn vòng trong thành: ${mode === 'auto' ? 'Tự động' : 'Tích chọn thủ công'}`);
        },
        toggleManualQualifiedTeam: (teamId) => {
          if (!get().isAdmin) return;
          set((state) => {
            const current = state.manualQualifiedTeamIds || [];
            const isExist = current.includes(teamId);
            const nextList = isExist ? current.filter((id) => id !== teamId) : [...current, teamId];
            return { manualQualifiedTeamIds: nextList };
          });
          const tName = get().teams[teamId]?.name || teamId;
          const status = get().manualQualifiedTeamIds.includes(teamId) ? 'vé đi tiếp' : 'gỡ vé';
          logToStore('Tuyển chọn', `Thay đổi trạng thái đấu thủ "${tName}" thành ${status}.`);
        },
        clearManualQualifiedTeams: () => {
          if (!get().isAdmin) return;
          set({ manualQualifiedTeamIds: [] });
          logToStore('Tuyển chọn', `Xóa toàn bộ lựa chọn vé đi tiếp thủ công.`);
        },

        addLog: (action, details) => logToStore(action, details),
        clearLogs: () => {
          if (!get().isAdmin) return;
          set({ logs: [] });
        },

        resetAll: () => {
          if (!get().isAdmin) return;
          set({
            tournament: DEFAULT_TOURNAMENT,
            teams: {},
            groups: {},
            matches: [],
            logs: [],
            darkMode: false,
            selectedTab: 'dashboard',
            activeGroupId: null,
            advanceSelectionMode: 'auto',
            manualQualifiedTeamIds: [],
            events: {
              'event-default': {
                id: 'event-default',
                name: 'Đôi Nam Chuyên Nghiệp',
                teams: {},
                groups: {},
                matches: [],
                settings: DEFAULT_SETTINGS,
                activeGroupId: null,
                advanceSelectionMode: 'auto',
                manualQualifiedTeamIds: []
              }
            },
            currentEventId: 'event-default',
          });
          logToStore('Hệ Thống', 'Đã thiết lập lại toàn bộ dữ liệu ứng dụng về trạng thái mặc định ban đầu.');
        },

        syncRealtimeMatch: (payload) => {
          let m: any = null;
          if (payload.eventType === 'DELETE') {
             m = payload.old;
          } else {
             m = payload.new;
          }
          if (!m || !m.id) return;

          set((state) => {
            // Sự kiện Xóa có thể không chứa event_id trong old, ta quét tất cả matches của tất cả events
            if (payload.eventType === 'DELETE') {
              const nextEvents = { ...state.events };
              Object.keys(nextEvents).forEach(eventId => {
                const matchesList = nextEvents[eventId].matches.filter(oldM => oldM.id !== m.id);
                nextEvents[eventId] = { ...nextEvents[eventId], matches: matchesList };
              });
              const activeMatches = nextEvents[state.currentEventId]?.matches || [];
              return { events: nextEvents, matches: activeMatches };
            }

            const eventId = m.event_id || m.eventId;
            if (!eventId || !state.events[eventId]) return state;

            let finalGroupId = m.group_id !== undefined ? m.group_id : (m.groupId || null);
            if (finalGroupId && finalGroupId !== 'knockout' && !finalGroupId.endsWith(`-${eventId}`)) {
              finalGroupId = `${finalGroupId}-${eventId}`;
            }

            const updatedMatch: Match = {
              id: m.id,
              groupId: finalGroupId,
              teamAId: m.team_a_id !== undefined ? m.team_a_id : (m.teamAId || null),
              teamBId: m.team_b_id !== undefined ? m.team_b_id : (m.teamBId || null),
              scoreA: m.score_a !== undefined && m.score_a !== null ? m.score_a : (m.scoreA !== undefined && m.scoreA !== null ? m.scoreA : null),
              scoreB: m.score_b !== undefined && m.score_b !== null ? m.score_b : (m.scoreB !== undefined && m.scoreB !== null ? m.scoreB : null),
              winnerId: m.winner_id !== undefined ? m.winner_id : (m.winnerId || null),
              status: m.status,
              round: m.round,
              knockoutRoundName: m.knockout_round_name !== undefined ? m.knockout_round_name : (m.knockoutRoundName || null),
              knockoutMatchId: m.knockout_match_id !== undefined ? m.knockout_match_id : (m.knockoutMatchId || null),
              nextMatchId: m.next_match_id !== undefined ? m.next_match_id : (m.nextMatchId || null),
              nextMatchSlot: m.next_match_slot !== undefined ? m.next_match_slot : (m.nextMatchSlot || null)
            };

            const nextEvents = { ...state.events };
            let matchesList = [...nextEvents[eventId].matches];
            
            const existingIdx = matchesList.findIndex(oldM => oldM.id === updatedMatch.id);
            if (existingIdx >= 0) {
              matchesList[existingIdx] = { ...matchesList[existingIdx], ...updatedMatch };
            } else {
              matchesList.push(updatedMatch);
            }

            nextEvents[eventId] = {
              ...nextEvents[eventId],
              matches: matchesList
            };

            return {
              events: nextEvents,
              matches: state.currentEventId === eventId ? matchesList : state.matches
            };
          });
        },

        initSupabase: async () => {
          if (!isAuthListenerSetup) {
            isAuthListenerSetup = true;
            supabase.auth.onAuthStateChange((event) => {
              if (event === 'SIGNED_OUT') {
                const cur = get();
                // Bỏ qua cho các tài khoản quản trị ảo (admin1, admin2, admin3) để tránh false-positives khi nạp lại trang
                if (cur.userRole !== 'admin1' && cur.userRole !== 'admin2' && cur.userRole !== 'admin3') {
                  if (cur.isAdmin || cur.userRole !== 'guest' || cur.currentUser !== null) {
                    console.log('[AuthState] Nhận sự kiện SIGNED_OUT cho tài khoản standard. Đang đăng xuất...');
                    cur.logout();
                  }
                } else {
                  console.log(`[AuthState] Bỏ qua sự kiện SIGNED_OUT của quản trị viên ảo "${cur.userRole}" để bảo toàn trạng thái LocalStorage.`);
                }
              }
            });
          }
          
          originalSet({ isLoadingSupabase: true });
          try {
            // Lấy trạng thái dữ liệu trong store cục bộ trước khi query (khôi phục từ localStorage)
            const localState = get();
            const activeTenantId = localState.activeTenantId || 'default';
            console.log(`Khởi tạo và đồng bộ dữ liệu cho CSDL phân rã: "${activeTenantId}" từ Supabase...`);
            
            const hasLocalTeams = Object.keys(localState.teams || {}).length > 0;
            const hasLocalMatches = (localState.matches || []).length > 0;
            const hasLocalData = hasLocalTeams || hasLocalMatches;

            // 1. Đọc giải đấu (Tournament metadata) - Bảng cấu hình chung nhỏ gọn
            const { data: tData, error: tError } = await supabase.from('tournament').select('*');
            if (tError) {
              if (tError.code === '42P01' || tError.message?.includes('relation') || tError.message?.includes('does not exist')) {
                console.warn('LƯU Ý: Các bảng dữ liệu chưa được khởi tạo trên Supabase. Đang chạy ở chế độ dự phòng Offline.');
                originalSet({ supabaseConnected: false });
                return;
              }
              throw tError;
            }

            // Tải danh sách tài khoản từ cấu hình JSON 'accounts_config' trong tournament (nguồn cấu hình tài khoản duy nhất)
            let loadedAccounts: Account[] = [];
            let forceLogout = false;
            try {
              const accountsConfigRow = (tData || []).find((row: any) => row.id === 'accounts_config');
              let jsonAccounts: Account[] = [];
              if (accountsConfigRow && accountsConfigRow.settings) {
                if (Array.isArray(accountsConfigRow.settings)) {
                  jsonAccounts = accountsConfigRow.settings;
                } else if (accountsConfigRow.settings.accounts && Array.isArray(accountsConfigRow.settings.accounts)) {
                  jsonAccounts = accountsConfigRow.settings.accounts;
                }
              }
              
              loadedAccounts = jsonAccounts.map((row: any) => ({
                username: row.username,
                password: row.password,
                displayName: row.display_name || row.displayName,
                tournamentName: row.tournament_name || row.tournamentName,
                session_id: row.session_id,
                role: row.role || 'admin2',
                parentTenantId: row.parent_tenant_id || row.parentTenantId || 'default',
                permittedEventIds: row.permitted_event_ids || row.permittedEventIds || []
              }));

              // Kiểm tra bảo mật phiên đăng nhập (chỉ áp dụng cho admin2 và admin3)
              if ((localState.userRole === 'admin2' || localState.userRole === 'admin3') && localState.currentUser) {
                const myLatestDbAccount = loadedAccounts.find(a => a.username === localState.currentUser);
                const dbSessionId = myLatestDbAccount?.session_id;
                const localSessionId = localState.currentSessionId;
                
                console.log(`[SingleSession Audit - initSupabase] Trạng thái kiểm tra:`, {
                  username: localState.currentUser,
                  role: localState.userRole,
                  localSessionId,
                  dbSessionId,
                  status: dbSessionId === localSessionId ? 'MATCH (Valid)' : (dbSessionId ? 'MISMATCH (Invalid)' : 'NO_SESSION_IN_DB')
                });

                if (dbSessionId && dbSessionId !== localSessionId) {
                  console.warn(`[SingleSession Audit] Phát hiện xung đột phiên cho "${localState.currentUser}": CSDL là "${dbSessionId}" nhưng cục bộ là "${localSessionId}".`);
                  forceLogout = true;
                }
              }
            } catch (e) {
              console.warn('Lỗi phân tích tài khoản từ JSON:', e);
            }
            originalSet({ accounts: loadedAccounts });
            
            if (forceLogout) {
              console.warn('Phát hiện đăng nhập song song. Tự động đăng xuất phiên làm việc cũ.');
              alert(`CẢNH BÁO: KẾT NỐI BỊ NGẮT\n\nTài khoản "${localState.currentUser}" vừa được đăng nhập thành công ở thiết bị hoặc trình duyệt khác.\n\nNhằm bảo vệ tính toàn vẹn dữ liệu lúc nhập điểm, hệ thống chỉ cho phép 1 tài khoản hoạt động trên 1 thiết bị/1 tab trình duyệt ở cùng một thời điểm.\n\nPhiên làm việc này sẽ được đăng xuất tự động.`);
              get().logout();
              return; // Ngừng quá trình initSupabase
            }

            // Lọc ra các giải đấu thông thường (bỏ qua bản ghi cấu hình tài khoản)
            const regularTournaments = (tData || []).filter((row: any) => row.id !== 'accounts_config');

            // 2. Đọc danh sách sự kiện - TRUY VẤN LỌC TRỰC TIẾP Ở DB LEVEL ĐỂ TỐI ƯU HÓA QUY MÔ LỚN
            let eData: any[] | null = null;
            try {
              let eQuery = supabase.from('events').select('*');
              if (activeTenantId === 'default') {
                eQuery = eQuery.not('id', 'like', '%__%');
              } else {
                eQuery = eQuery.like('id', `${activeTenantId}__%`);
              }
              const res = await eQuery;
              if (res.error) throw res.error;
              eData = res.data;
            } catch (err) {
              throw err;
            }

            // 3. Đọc dữ liệu teams - TRUY VẤN LỌC TRỰC TIẾP Ở DB LEVEL
            let teamData: any[] | null = null;
            try {
              let tQuery = supabase.from('teams').select('*');
              if (activeTenantId === 'default') {
                tQuery = tQuery.not('event_id', 'like', '%__%');
              } else {
                tQuery = tQuery.like('event_id', `${activeTenantId}__%`);
              }
              const res = await tQuery;
              if (res.error) throw res.error;
              teamData = res.data;
            } catch (err) {
              throw err;
            }

            // 4. Đọc dữ liệu groups - TRUY VẤN LỌC TRỰC TIẾP Ở DB LEVEL
            let groupData: any[] | null = null;
            try {
              let gQuery = supabase.from('groups').select('*');
              if (activeTenantId === 'default') {
                gQuery = gQuery.not('event_id', 'like', '%__%');
              } else {
                gQuery = gQuery.like('event_id', `${activeTenantId}__%`);
              }
              const res = await gQuery;
              if (res.error) throw res.error;
              groupData = res.data;
            } catch (err) {
              throw err;
            }

            // 5. Đọc dữ liệu matches - TRUY VẤN LỌC TRỰC TIẾP Ở DB LEVEL
            let matchData: any[] | null = null;
            try {
              let mQuery = supabase.from('matches').select('*');
              if (activeTenantId === 'default') {
                mQuery = mQuery.not('event_id', 'like', '%__%');
              } else {
                mQuery = mQuery.like('event_id', `${activeTenantId}__%`);
              }
              const res = await mQuery;
              if (res.error) throw res.error;
              matchData = res.data;
            } catch (err) {
              throw err;
            }

            // 6. Đọc kết hoạt logs - TRUY VẤN LỌC TRỰC TIẾP Ở DB LEVEL (Có Defensive Fallback)
            let logData: any[] | null = null;
            try {
              const res = await supabase.from('audit_logs').select('*').eq('tenant_id', activeTenantId).order('id', { ascending: false }).limit(200);
              if (res.error) {
                if (res.error.code === '42703' || res.error.message?.includes('tenant_id')) {
                  const fallbackRes = await supabase.from('audit_logs').select('*').order('id', { ascending: false }).limit(200);
                  logData = fallbackRes.data || [];
                } else {
                  logData = [];
                }
              } else {
                logData = res.data;
              }
            } catch (err) {
              logData = [];
            }

            const hasRemoteData = (teamData && teamData.length > 0) || (matchData && matchData.length > 0);

            // TÌNH HUỐNG 1: TRÊN CLOUD TRỐNG HOÀN TOÀN NHƯNG DƯỚI CLIENT LẠI CÓ SẴN DỮ LIỆU
            // CỰC KỲ QUAN TRỌNG: Chỉ tự động đồng bộ (push) dữ liệu cũ lên cho tenant mặc định ('default') khi khởi chạy lần đầu tiên.
            // Ngăn chặn triệt để tình trạng lệch hoặc sao chép rác dữ liệu từ tenant cũ sang tenant mới tinh khi đổi view CSDL!
            if (activeTenantId === 'default' && !hasRemoteData && hasLocalData) {
              if (localState.isAdmin) {
                console.log('Phát hiện cơ sỡ dữ liệu mặc định trống, đang đồng bộ dữ liệu Local Cache lên cloud...');
                await syncStateToSupabase(localState);
                
                // Đồng bộ mảng logs ban đầu nếu có
                if (localState.logs && localState.logs.length > 0) {
                  const initialLogs = localState.logs.slice(0, 100).map(l => ({
                    timestamp: l.timestamp,
                    action: l.action,
                    details: l.details,
                    tenant_id: 'default'
                  }));
                  await supabase.from('audit_logs').insert(initialLogs);
                }

                originalSet({ supabaseConnected: true });
                console.log('Tự động nạp dữ liệu ban đầu lên Supabase trực tuyến thành công!');
                return;
              } else {
                console.log('Cơ sở dữ liệu Supabase online trống, hiển thị tạm thời trạng thái Local Cache đệm.');
                originalSet({ supabaseConnected: true });
                return;
              }
            }

            // TÌNH HUỐNG 2: SUPABASE ĐÃ CÓ VỀ HOẶC CẦN KHỞI TẠO NỘI DUNG RIÊNG CHO TENANT
            const targetTid = localState.activeTenantId === 'default' ? 't-1' : localState.activeTenantId;
            let dbTournament = regularTournaments.find((rowId: any) => rowId.id === targetTid) || null;
            const isFirstTime = !dbTournament;
            if (!dbTournament) {
              let tournamentDetailsName = DEFAULT_TOURNAMENT.name;
              if (localState.activeTenantId !== 'default') {
                const acc = loadedAccounts.find((a: any) => a.username === localState.activeTenantId);
                if (acc && acc.tournamentName) {
                  tournamentDetailsName = acc.tournamentName;
                } else {
                  tournamentDetailsName = `Giải Pickleball thuộc Đơn Vị ${localState.activeTenantId}`;
                }
              }

              const defaultObj = {
                id: targetTid,
                name: tournamentDetailsName,
                organization: localState.activeTenantId === 'default' ? DEFAULT_TOURNAMENT.organization : `Ban Tổ Chức ${localState.activeTenantId}`,
                location: DEFAULT_TOURNAMENT.location,
                date: DEFAULT_TOURNAMENT.date,
                settings: DEFAULT_SETTINGS,
                current_event_id: localState.activeTenantId === 'default' ? 'event-default' : `${localState.activeTenantId}__event-default`
              };
              if (localState.userRole === 'admin1' || localState.userRole === 'admin2') {
                await supabase.from('tournament').insert([defaultObj]);
              }
              dbTournament = defaultObj;
            }

            // Lọc danh sách sự kiện dựa trên activeTenantId để đảm bảo sự tách biệt dữ liệu hoàn hảo
            let dbEvents = eData ? eData.filter((evt: any) => {
              if (localState.activeTenantId === 'default') {
                return !evt.id.includes('__');
              } else {
                return evt.id.startsWith(`${localState.activeTenantId}__`);
              }
            }) : [];
            
            if (dbEvents.length === 0 && isFirstTime) {
              const defaultEvtId = localState.activeTenantId === 'default' ? 'event-default' : `${localState.activeTenantId}__event-default`;
              const defaultEvt = {
                id: defaultEvtId,
                name: 'Đôi Nam Chuyên Nghiệp',
                settings: DEFAULT_SETTINGS,
                active_group_id: null,
                advance_selection_mode: 'auto',
                manual_qualified_team_ids: [],
                tenant_id: activeTenantId
              };
              if (localState.userRole === 'admin1' || localState.userRole === 'admin2') {
                const { error: insErr } = await supabase.from('events').insert([defaultEvt]);
                if (insErr) {
                  console.error("Lỗi khi tạo Event mặc định trên Supabase:", insErr.message, insErr.details);
                }
              }
              dbEvents = [defaultEvt];
            }

            // Lấy tập hợp các ID sự kiện hợp lệ của Tenant này
            const activeEventIds = new Set(dbEvents.map((evt: any) => evt.id));

            // Chỉ lấy các teams, groups, matches thuộc các sự kiện hợp lệ của tenant này
            const tenantTeams = (teamData || []).filter((t: any) => activeEventIds.has(t.event_id || t.eventId));
            const tenantGroups = (groupData || []).filter((g: any) => activeEventIds.has(g.event_id || g.eventId));
            const tenantMatches = (matchData || []).filter((m: any) => activeEventIds.has(m.event_id || m.eventId));

            // Khởi tạo cấu trúc map của events
            const eventsRecord: Record<string, EventData> = {};
            dbEvents.forEach(evt => {
              let activeGroupId = evt.active_group_id !== undefined ? evt.active_group_id : (evt.activeGroupId || null);
              if (activeGroupId && activeGroupId !== 'knockout' && !activeGroupId.endsWith(`-${evt.id}`)) {
                activeGroupId = `${activeGroupId}-${evt.id}`;
              }

              const advanceSelectionMode = evt.advance_selection_mode !== undefined ? evt.advance_selection_mode : (evt.advanceSelectionMode || 'auto');
              const manualQualifiedTeamIds = evt.manual_qualified_team_ids !== undefined ? evt.manual_qualified_team_ids : (evt.manualQualifiedTeamIds || []);

              eventsRecord[evt.id] = {
                id: evt.id,
                name: evt.name,
                settings: evt.settings || DEFAULT_SETTINGS,
                activeGroupId: activeGroupId,
                advanceSelectionMode: advanceSelectionMode,
                manualQualifiedTeamIds: manualQualifiedTeamIds,
                teams: {},
                groups: {},
                matches: []
              };
            });

            // Nạp thông tin Đội (teams)
            tenantTeams.forEach(t => {
              const eventId = t.event_id || t.eventId;
              if (eventsRecord[eventId]) {
                let finalGroupId = t.group_id !== undefined ? t.group_id : (t.groupId || null);
                if (finalGroupId && finalGroupId !== 'knockout' && !finalGroupId.endsWith(`-${eventId}`)) {
                  finalGroupId = `${finalGroupId}-${eventId}`;
                }
                eventsRecord[eventId].teams[t.id] = {
                  id: t.id,
                  name: t.name,
                  groupId: finalGroupId,
                  seed: t.seed || 'none'
                };
              }
            });

            // Nạp thông tin Nhóm/Bảng đấu (groups)
            tenantGroups.forEach(g => {
              const eventId = g.event_id || g.eventId;
              if (eventsRecord[eventId]) {
                let finalGroupId = g.id;
                if (!finalGroupId.endsWith(`-${eventId}`)) {
                  finalGroupId = `${finalGroupId}-${eventId}`;
                }

                // Tối ưu hóa chuyên nghiệp: Tự động khôi phục và tính toán các đội thuộc bảng đấu từ dữ liệu 'teams' (đã nạp ở bước trên),
                // tham khảo thông qua trường group_id để triệt tiêu vĩnh viễn việc bất đồng bộ hoặc lệch dữ liệu JSONB.
                const fallbackTeamIds = Object.values(eventsRecord[eventId].teams)
                  .filter(t => t.groupId === finalGroupId)
                  .map(t => t.id);

                const dbTeamIds = g.team_ids !== undefined ? g.team_ids : (g.teamIds || []);
                const teamIds = Array.isArray(dbTeamIds) && dbTeamIds.length > 0 ? dbTeamIds : fallbackTeamIds;

                eventsRecord[eventId].groups[finalGroupId] = {
                  id: finalGroupId,
                  name: g.name,
                  teamIds: teamIds
                };
              }
            });

            // Nạp thông tin Trận đấu (matches)
            tenantMatches.forEach(m => {
              const eventId = m.event_id || m.eventId;
              if (eventsRecord[eventId]) {
                let finalGroupId = m.group_id !== undefined ? m.group_id : (m.groupId || null);
                if (finalGroupId && finalGroupId !== 'knockout' && !finalGroupId.endsWith(`-${eventId}`)) {
                  finalGroupId = `${finalGroupId}-${eventId}`;
                }

                eventsRecord[eventId].matches.push({
                  id: m.id,
                  groupId: finalGroupId,
                  teamAId: m.team_a_id !== undefined ? m.team_a_id : (m.teamAId || null),
                  teamBId: m.team_b_id !== undefined ? m.team_b_id : (m.teamBId || null),
                  scoreA: m.score_a !== undefined && m.score_a !== null ? m.score_a : (m.scoreA !== undefined && m.scoreA !== null ? m.scoreA : null),
                  scoreB: m.score_b !== undefined && m.score_b !== null ? m.score_b : (m.scoreB !== undefined && m.scoreB !== null ? m.scoreB : null),
                  winnerId: m.winner_id !== undefined ? m.winner_id : (m.winnerId || null),
                  status: m.status,
                  round: m.round,
                  knockoutRoundName: m.knockout_round_name !== undefined ? m.knockout_round_name : (m.knockoutRoundName || null),
                  knockoutMatchId: m.knockout_match_id !== undefined ? m.knockout_match_id : (m.knockoutMatchId || null),
                  nextMatchId: m.next_match_id !== undefined ? m.next_match_id : (m.nextMatchId || null),
                  nextMatchSlot: m.next_match_slot !== undefined ? m.next_match_slot : (m.nextMatchSlot || null),
                  placeholderA: m.placeholder_a !== undefined ? m.placeholder_a : (m.placeholderA || null),
                  placeholderB: m.placeholder_b !== undefined ? m.placeholder_b : (m.placeholderB || null)
                });
              }
            });

            // Thiết lập sự kiện hiện tại
            let currentEventId = dbTournament.current_event_id || dbTournament.currentEventId || '';
            let activeEvent = eventsRecord[currentEventId] || Object.values(eventsRecord)[0];
            
            if (!activeEvent) {
              activeEvent = {
                id: '',
                name: '',
                settings: DEFAULT_SETTINGS,
                activeGroupId: null,
                advanceSelectionMode: 'auto',
                manualQualifiedTeamIds: [],
                teams: {},
                groups: {},
                matches: []
              };
            }

            const tournamentState: Tournament = {
              id: dbTournament.id,
              name: dbTournament.name,
              organization: dbTournament.organization,
              location: dbTournament.location,
              date: dbTournament.date,
              settings: activeEvent.id ? (activeEvent.settings || dbTournament.settings || DEFAULT_SETTINGS) : (dbTournament.settings || DEFAULT_SETTINGS)
            };

            const logsState: AuditLog[] = (logData || []).map(l => ({
              timestamp: l.timestamp,
              action: l.action,
              details: l.details
            }));

            // Lưu dữ liệu trực tuyến đồng bộ hoàn chỉnh vào Zustand store
            originalSet({
              tournament: tournamentState,
              events: eventsRecord,
              currentEventId: activeEvent.id,
              teams: activeEvent.teams,
              groups: activeEvent.groups,
              matches: activeEvent.matches,
              activeGroupId: activeEvent.activeGroupId,
              advanceSelectionMode: activeEvent.advanceSelectionMode,
              manualQualifiedTeamIds: activeEvent.manualQualifiedTeamIds,
              logs: logsState,
              supabaseConnected: true,
              isLoadingSupabase: false,
            });

            console.log('Nạp dữ liệu trực tuyến từ Supabase thành công!');
          } catch (e) {
            console.error('Lỗi khi đồng bộ từ Supabase, chuyển sang chế độ dự phòng Local:', e);
            originalSet({
              supabaseConnected: false,
              isLoadingSupabase: false,
            });
          }
        },
      };
    },
    {
      name: 'pickleball-tournament-cache', // Khóa lưu trữ LocalStorage để đồng bộ giữa các tab
      storage: createJSONStorage(() => localStorage),
    }
  )
);

function tIdToNameOrId(id: string, teamsMap: Record<string, Team>): string {
  if (teamsMap[id]) return teamsMap[id].name;
  return id;
}
