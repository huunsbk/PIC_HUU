/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Tournament, Team, Group, Match, AuditLog, TournamentSettings, SeedType, GroupStanding, ThirdPlaceStanding, EventData, Account } from './types';
import { generateRoundRobinMatches, calculateGroupStandings, calculateBestThirdPlaces, generateKnockoutMatchesSchema, balanceMatchesRestTime, normalizeSlotKey } from './utils/tournamentEngine';
import { supabase, checkSupabaseConnection } from './supabaseClient';

const getBasePath = () => {
  const basePath = import.meta.env.BASE_URL || '/';
  return basePath.endsWith('/') ? basePath : `${basePath}/`;
};

const getTenantHashPath = (tenantId: string) => `#/${tenantId.replace(/_/g, '-')}`;

const getCurrentTenantHash = () => window.location.hash.replace(/^#\/?/, '').trim();

const isRouteWorkspacePath = () => {
  const basePath = getBasePath().replace(/\/$/, '');
  const appPath = window.location.pathname.startsWith(basePath)
    ? window.location.pathname.slice(basePath.length)
    : window.location.pathname;
  return appPath.startsWith('/admin/workspace/') || appPath.startsWith('/tournament/');
};

const navigateToTenantHash = (tenantId: string, reload = false) => {
  if (isRouteWorkspacePath()) return;
  const targetUrl = `${window.location.origin}${getBasePath()}${getTenantHashPath(tenantId)}`;
  if (window.location.href !== targetUrl) {
    window.location.href = targetUrl;
  }
  if (reload) {
    setTimeout(() => window.location.reload(), 100);
  }
};

const navigateToWorkspaceSlug = (slug: string) => {
  const targetUrl = `${window.location.origin}${getBasePath()}admin/workspace/${encodeURIComponent(slug)}`;
  if (window.location.href === targetUrl) return;
  window.history.replaceState(null, '', targetUrl);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

async function resolveWorkspaceSlugForTenant(tenantId: string) {
  if (!tenantId || tenantId === 'default') return null;

  const { data: tournamentData } = await supabase
    .from('tournament')
    .select('slug')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (tournamentData?.slug) return tournamentData.slug;

  const { data: tenantData } = await supabase
    .from('tenants')
    .select('slug')
    .eq('id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  return tenantData?.slug || null;
}

export async function getCurrentTenantId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('accounts').select('tenant_id').eq('user_id', user.id).single();
  return data?.tenant_id || null;
}

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
  currentUser: string | null;
  currentEnterpriseUser: any | null; // Will store full EnterpriseAccount details
  userRole: 'guest' | string;
  activeTenantId: string; // 'default' or UUID of tenant
  activeTenantName: string | null;
  activeTournamentId: string | null;
  setAuthStatus: (role: 'guest' | string, username: string | null, tenantId: string, enterpriseUser?: any) => Promise<void>;
  logout: () => Promise<void>;
  setTenantId: (tenantId: string) => Promise<void>;
  setWorkspaceContext: (context: { tenantId: string; tenantName?: string | null; tournamentId?: string | null; tournamentName?: string | null; tournamentSlug?: string | null; }) => Promise<void>;

  permissions: string[];
  hasPermission: (permissionName: string) => boolean;

  // Actions
  checkConnection: () => Promise<boolean>;
  updateTournament: (t: Partial<Tournament>) => Promise<void>;
  updateSettings: (s: Partial<TournamentSettings>) => Promise<void>;
  
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
  updateKnockoutManualBracket: (updatedKoMatches: Match[], numBestThirds?: number) => void;

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
  // Đồng bộ nguyên khối bằng Zustand đã bị loại bỏ theo yêu cầu của báo cáo Enterprise Architecture.
  // Quá trình chuyển đổi sang React Query + Supabase Realtime sẽ đảm bảo khả năng đáp ứng 1000+ concurrent users thay cho kiến trúc đồng bộ thủ công này.
  if (originalSet) {
    originalSet({ supabaseSyncError: null });
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
        if ((currentState.hasPermission('*') || currentState.permissions.length > 0) && hasActualDataChanges && !currentState.isLoadingSupabase) {
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
        
        // Quá trình ghi log xuống Supabase (audit_logs) đã được chuyển sang Database Triggers (audit_matches_changes)
        // theo chuẩn SaaS Enterprise, giúp bảo mật và chống RLS bypass thành công.
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
        permissions: [],
        hasPermission: (permissionName) => {
          const state = get();
          if (state.userRole === 'SUPER_ADMIN' || state.userRole === 'TENANT_ADMIN') return true;
          return state.permissions.includes(permissionName) || state.permissions.includes('*');
        },
        currentEventId: 'event-default',
        currentUser: null,
        currentEnterpriseUser: null,
        userRole: 'guest',
        activeTenantId: 'default',
        activeTenantName: null,
        activeTournamentId: null,
        isLoadingSupabase: false,
        setAuthStatus: async (role, username, tenantId, enterpriseUser) => {
          console.log('[Auth Setup] Bắt đầu thiết lập Auth.');
          const isWorkspaceRoute = isRouteWorkspacePath();
          const currentState = get();
          const selectedTabAfterAuth = (role === 'EVENT_ADMIN' || (enterpriseUser?.permissions?.includes('enter_scores') && !enterpriseUser?.permissions?.includes('*')))
            ? 'scoreEntry'
            : isWorkspaceRoute
              ? currentState.selectedTab
              : 'dashboard';
          const normalizedEnterpriseUser = enterpriseUser ? {
            ...enterpriseUser,
            role: enterpriseUser.role || role || enterpriseUser.role_name || 'guest',
            role_name: enterpriseUser.role_name || role || enterpriseUser.role || 'guest',
            permittedEventIds: enterpriseUser.permittedEventIds || enterpriseUser.event_ids || [],
          } : null;
          
          originalSet({
            userRole: role || 'guest',
            currentUser: username,
            currentEnterpriseUser: normalizedEnterpriseUser,
            activeTenantId: tenantId,
            activeTenantName: normalizedEnterpriseUser?.tenant?.name || currentState.activeTenantName || null,
            permissions: normalizedEnterpriseUser?.permissions || [],
            isAdmin: false /* deprecated */,
            selectedTab: selectedTabAfterAuth,
            isLoadingSupabase: true
          });

          if (normalizedEnterpriseUser && normalizedEnterpriseUser.id && tenantId !== 'default') {
            const workspaceSlug = await resolveWorkspaceSlugForTenant(tenantId);
            if (workspaceSlug) {
              navigateToWorkspaceSlug(workspaceSlug);
              originalSet({ isLoadingSupabase: false, supabaseConnected: true });
              return;
            }

            requestAnimationFrame(() => {
              if (isRouteWorkspacePath()) return;
              const expectedTenantHash = tenantId.replace(/_/g, '-');
              if (getCurrentTenantHash() !== expectedTenantHash || window.location.pathname !== getBasePath()) {
                navigateToTenantHash(tenantId);
              }
            });
          }
          
          if (isRouteWorkspacePath()) {
            originalSet({ isLoadingSupabase: false, supabaseConnected: true });
            return;
          }

          console.log('[Auth Setup] Đã đồng bộ cấu hình tài khoản. Đang khởi chạy tải lại cơ sở dữ liệu initSupabase()...');
          await get().initSupabase();
        },
        logout: async () => {
          // Guard to avoid recursive logout calls if already guest
          const state = get();
          if (state.userRole === 'guest' && !state.currentUser) {
            return;
          }

          const accountId = state.currentEnterpriseUser?.id;
          
          // Clear credentials synchronously first to avoid race conditions with auth listeners
          originalSet({
            userRole: 'guest',
            currentUser: null,
            currentEnterpriseUser: null,
            activeTenantId: 'default',
            activeTenantName: null,
            activeTournamentId: null,
            permissions: [],
            isAdmin: false,
          });
          
          // Reset URL hash so client isn't stuck on the active admin tenant path as guest on reload
          try {
            window.location.hash = '';
          } catch (e) {}

          try {
            await supabase.auth.signOut();
          } catch (e) {
            console.warn('Không thể hoàn tất đăng xuất phía Supabase.');
          }
          
          window.location.reload();
        },
        setTenantId: async (tenantId) => {
          const currentState = get();
          
          if (!currentState.hasPermission('*') && !currentState.hasPermission('switch_tenant')) {
            const allowedTenant = currentState.activeTenantId || 'default';
              
            // Normalize replacing - with _ to match mapping strategy in App.tsx
            const normalizedAllowed = allowedTenant.replace(/-/g, '_').toLowerCase();
            
            // Dứt khoát bắt buộc kết nối đúng dữ liệu của mình, không có ngoại lệ
            if (tenantId.toLowerCase() !== normalizedAllowed) { 
              console.warn(`Chuyển đổi CSDL không hợp lệ cho tài khoản này. Đã khóa để bảo vệ. Expected ${normalizedAllowed}, got ${tenantId.toLowerCase()}`);
              // Chuyển hướng người dùng về đúng khu vực của họ thay vì đăng xuất ngay lập tức gây khó chịu, nhưng nếu có hack cố tình thì chặn
              const expectedTenantHash = normalizedAllowed.replace(/_/g, '-');
              if (!isRouteWorkspacePath() && (getCurrentTenantHash() !== expectedTenantHash || window.location.pathname !== getBasePath())) {
                navigateToTenantHash(normalizedAllowed, true);
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
        setWorkspaceContext: async (context) => {
          const currentState = get();
          const currentTournament = currentState.tournament;
          const hasTournamentContext = Object.prototype.hasOwnProperty.call(context, 'tournamentId');
          const nextTournamentId = hasTournamentContext ? context.tournamentId || null : currentState.activeTournamentId || null;
          const nextTournamentName = nextTournamentId
            ? context.tournamentName || (nextTournamentId === currentTournament.id ? currentTournament.name : 'Chưa chọn giải')
            : 'Chưa có giải';
          const nextTournament = {
            ...currentTournament,
            id: nextTournamentId || '',
            name: nextTournamentName,
          };

          const isSameContext =
            currentState.activeTenantId === context.tenantId &&
            currentState.activeTenantName === (context.tenantName || null) &&
            currentState.activeTournamentId === nextTournamentId &&
            currentTournament.id === nextTournament.id &&
            currentTournament.name === nextTournament.name;

          if (isSameContext) {
            originalSet({ isLoadingSupabase: false, supabaseConnected: true });
            return;
          }

          originalSet({
            activeTenantId: context.tenantId,
            activeTenantName: context.tenantName || null,
            activeTournamentId: nextTournamentId,
            isLoadingSupabase: false,
            supabaseConnected: true,
            tournament: nextTournament,
          });
        },
        isAdmin: false,
        setAdminStatus: (status: boolean) => {
          if (status) {
            get().setAuthStatus('guest', null, 'default');
          } else {
            console.log('Force authentication layout reset');
          }
        },
        supabaseConnected: null,
        supabaseSyncError: null,
        checkConnection: async () => {
          const connected = await checkSupabaseConnection();
          set({ supabaseConnected: connected });
          return connected;
        },

        updateTournament: async (t) => {
          if (get().userRole === 'guest') return;
          const state = get();
          const updated = { ...state.tournament, ...t };
          const payload = {
            name: updated.name,
            organization: updated.organization,
            location: updated.location,
            date: updated.date,
            settings: updated.settings,
            current_event_id: state.currentEventId,
          };

          const { data, error } = await supabase
            .from('tournament')
            .update(payload)
            .eq('id', state.tournament.id)
            .select('id, name, organization, location, date, settings, current_event_id')
            .single();

          if (error) throw error;

          set({
            tournament: {
              id: data.id,
              name: data.name,
              organization: data.organization,
              location: data.location,
              date: data.date,
              settings: data.settings || DEFAULT_SETTINGS,
            },
            currentEventId: data.current_event_id || state.currentEventId,
          });
          logToStore('Cấu hình Giải', `Cập nhật thông tin tổng quan của giải đấu.`);
        },

        updateSettings: async (s) => {
          if (get().userRole === 'guest') return;
          const state = get();
          const updatedSettings = { ...state.tournament.settings, ...s };

          const { data, error } = await supabase
            .from('tournament')
            .update({ settings: updatedSettings })
            .eq('id', state.tournament.id)
            .select('id, name, organization, location, date, settings, current_event_id')
            .single();

          if (error) throw error;

          set({
            tournament: {
              id: data.id,
              name: data.name,
              organization: data.organization,
              location: data.location,
              date: data.date,
              settings: data.settings || updatedSettings,
            },
            currentEventId: data.current_event_id || state.currentEventId,
          });
          logToStore('Cấu hình Điểm', `Thay đổi cài đặt điểm chạm: ${JSON.stringify(s)}`);
        },

        addEvent: (name) => {
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') return;
          const event = get().events[id];
          if (!event) return;

          // 1. Xóa trên Supabase trước (theo thứ tự FK)
          // Đặt active_group_id thành null trước để gỡ bỏ ràng buộc khóa ngoại (nếu có)
          try {
            await supabase.from('events').update({ active_group_id: null }).eq('id', id);
            const deleteTimestamp = new Date().toISOString();
            const { error: e1 } = await supabase.from('matches').update({ deleted_at: deleteTimestamp }).eq('event_id', id);
            if (e1) throw e1;
            const { error: e2 } = await supabase.from('teams').update({ deleted_at: deleteTimestamp }).eq('event_id', id);
            if (e2) throw e2;
            const { error: e3 } = await supabase.from('groups').update({ deleted_at: deleteTimestamp }).eq('event_id', id);
            if (e3) throw e3;
            const { error: e4 } = await supabase.from('events').update({ deleted_at: deleteTimestamp }).eq('id', id);
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
          if (get().userRole === 'guest') return;
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
          if (!id) return;
          if (!get().events[id]) {
            set({
              currentEventId: id,
              teams: {},
              groups: {},
              matches: [],
              activeGroupId: null,
              advanceSelectionMode: 'auto',
              manualQualifiedTeamIds: [],
            });
            logToStore('Hệ Thống', `Chuyển sang nội dung thi đấu từ cơ sở dữ liệu: "${id}"`);
            return;
          }
          set({ currentEventId: id });
          logToStore('Hệ Thống', `Chuyển sang điều hành nội dung: "${get().events[id]?.name}"`);
        },

        addTeam: (name, seed) => {
          if (get().userRole === 'guest') {
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
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') {
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
          if (get().userRole === 'guest') {
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
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') return;
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
          // Ta tạo placeholders đại diện mang nhãn ví dụ "Hạng 1 Bảng A", "Hạng 2 Bảng B", v.v.
          // Nhưng nếu vòng bảng đã xong và sắp xếp hoàn chỉnh, ta đổ thẳng tên đội thật vào các placeholders này!
          const advList: { label: string; placeholder: string; sourceRank?: number; sourceGroupId?: string }[] = [];

          // Dưới đây là sơ đồ cơ bản lấy đội đi tiếp cho bracket 8 đội:
          // Trận 1: Hạng 1 Bảng A vs Hạng 2 Bảng B (hoặc đội hạng 3 xuất sắc)
          // Trận 2: Hạng 1 Bảng C vs Hạng 2 Bảng D
          // Trận 3: Hạng 1 Bảng B vs Hạng 2 Bảng A
          // Trận 4: Hạng 1 Bảng D vs Hạng 2 Bảng C (hoặc hoán vị hạt giống)
          
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

              // Nếu chưa thi đấu xong hoặc không tìm thấy đội, giữ nhãn hạng/suất theo đúng yêu cầu.
              return `Hạng ${rank} ${matchedGroup.name}`;
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
            return `Hạng 3 xuất sắc ${rank}`;
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
                getRealTeamOrPlaceholder('Bảng A', 1, 'Hạng 1 Bảng A'),
                getRealTeamOrPlaceholder('Bảng B', 2, 'Hạng 2 Bảng B'),
                getRealTeamOrPlaceholder('Bảng B', 1, 'Hạng 1 Bảng B'),
                getRealTeamOrPlaceholder('Bảng A', 2, 'Hạng 2 Bảng A')
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
                getRealTeamOrPlaceholder('Bảng A', 1, 'Hạng 1 Bảng A'),
                getThirdPlaceOrPlaceholder(2, 'Hạng 3 Xuất sắc 2'),
                
                getRealTeamOrPlaceholder('Bảng C', 1, 'Hạng 1 Bảng C'),
                getRealTeamOrPlaceholder('Bảng B', 2, 'Hạng 2 Bảng B'),

                getRealTeamOrPlaceholder('Bảng B', 1, 'Hạng 1 Bảng B'),
                getThirdPlaceOrPlaceholder(1, 'Hạng 3 Xuất sắc 1'),

                getRealTeamOrPlaceholder('Bảng D', 1, 'Hạng 1 Bảng D') || getRealTeamOrPlaceholder('Bảng A', 2, 'Hạng 2 Bảng A'),
                getRealTeamOrPlaceholder('Bảng C', 2, 'Hạng 2 Bảng C') || getRealTeamOrPlaceholder('Bảng B', 2, 'Hạng 2 Bảng B')
              );

              slotsData.forEach((placeholder, idx) => {
                advList.push({
                  label: `Slot ${idx + 1}`,
                  placeholder: placeholder,
                });
              });

            } else if (size === 16 || size === 32) {
              // Thuật toán chuẩn cho 16 ĐỘI (8 bảng) và 32 ĐỘI (16 bảng) 
              // Giải quyết bài toán Hạng 1 A vs Hạng 2 I (32 đội), Hạng 1 A vs Hạng 2 E (16 đội)
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

                const defaultNameA = `Hạng 1 ${groupNameA}`;
                const defaultNameB = `Hạng 2 ${groupNameB}`;

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
          if (get().userRole === 'guest') return;
          
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
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') return;
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

        updateKnockoutManualBracket: (updatedKoMatches, numBestThirds) => {
          if (get().userRole === 'guest') return;
          set((state) => {
            const nonKoMatches = state.matches.filter((m) => m.groupId !== 'knockout');
            const mergedMatches = [...nonKoMatches, ...updatedKoMatches];
            
            const settings = {
              ...state.tournament.settings,
              ...(numBestThirds !== undefined ? { numBestThirds } : {})
            };

            const updatedTournament = {
              ...state.tournament,
              settings
            };

            const curEvtId = state.currentEventId;
            const updatedEvents = { ...state.events };
            if (updatedEvents[curEvtId]) {
              updatedEvents[curEvtId] = {
                ...updatedEvents[curEvtId],
                matches: mergedMatches,
              };
            }

            return {
              matches: mergedMatches,
              tournament: updatedTournament,
              events: updatedEvents,
            };
          });
          logToStore('Sơ Đồ Thủ Công', 'Đã lưu lại sơ đồ phân nhánh KO được hiệu chỉnh thủ công.');
        },

        setDarkMode: (dark) => set({ darkMode: dark }),
        setSelectedTab: (tab) => set({ selectedTab: tab }),
        setActiveGroupId: (id) => set({ activeGroupId: id }),
        setAdvanceSelectionMode: (mode) => {
          if (get().userRole === 'guest') return;
          set({ advanceSelectionMode: mode });
          logToStore('Tuyển chọn', `Thay đổi chế độ tuyển chọn vòng trong thành: ${mode === 'auto' ? 'Tự động' : 'Tích chọn thủ công'}`);
        },
        toggleManualQualifiedTeam: (teamId) => {
          if (get().userRole === 'guest') return;
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
          if (get().userRole === 'guest') return;
          set({ manualQualifiedTeamIds: [] });
          logToStore('Tuyển chọn', `Xóa toàn bộ lựa chọn vé đi tiếp thủ công.`);
        },

        addLog: (action, details) => logToStore(action, details),
        clearLogs: () => {
          if (get().userRole === 'guest') return;
          set({ logs: [] });
        },

        resetAll: () => {
          if (get().userRole === 'guest') return;
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
              teamAId: normalizeSlotKey(m.team_a_id !== undefined ? m.team_a_id : (m.teamAId || null), state.events[eventId]?.groups),
              teamBId: normalizeSlotKey(m.team_b_id !== undefined ? m.team_b_id : (m.teamBId || null), state.events[eventId]?.groups),
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
                // Bỏ qua cho các tài khoản đang đăng nhập hợp lệ
                if (!cur.currentEnterpriseUser) {
                  if ((cur.hasPermission('*') || cur.permissions.length > 0) || cur.userRole !== 'guest' || cur.currentUser !== null) {
                    console.log('[AuthState] Nhận sự kiện SIGNED_OUT cho tài khoản standard. Đang đăng xuất...');
                    cur.logout();
                  }
                } else {
                  console.log(`[AuthState] Bỏ qua sự kiện SIGNED_OUT của quản trị viên ảo "${cur.userRole}" để bảo toàn trạng thái LocalStorage.`);
                }
              } else if (event === 'SIGNED_IN') {
                 // Trigger background refresh 
                 get().initSupabase();
              }
            });
          }
          
          const routedWorkspace = isRouteWorkspacePath();
          originalSet({ isLoadingSupabase: !routedWorkspace });
          
          // --- BẢO ĐẢM AUTH STATE ĐƯỢC ĐỒNG BỘ TRƯỚC TIÊN ---
          try {
             // 1. Phục hồi session nếu trạng thái trong Zustand là guest nhưng thực tế có phiên đang hoạt động
             const currentAuthUser = await supabase.auth.getUser();
             if (currentAuthUser.data?.user) {
                // Đã đăng nhập, tiến hành đồng bộ profile
                const { data: profileStr, error: accountError } = await supabase.rpc('get_current_profile');
                if (!accountError && profileStr) {
                   const accountData = typeof profileStr === 'string' ? JSON.parse(profileStr) : profileStr;
                   if (accountData.account_id && accountData.tenant_id && accountData.role) {
                      const mappedRole = accountData.role || 'guest';
                      const tenantIdStr = accountData.tenant_id || 'default';
                      const rp = accountData.role_permissions || [];
                      const ap = accountData.account_permissions || [];
                      const legacyPerms = accountData.permissions || [];
                      let fetchedPermissions = Array.from(new Set([...rp, ...ap, ...legacyPerms]));
                      const eventIds = accountData.event_ids || [];
                      const restoredEnterpriseUser = {
                        id: accountData.account_id,
                        username: accountData.username,
                        display_name: accountData.display_name,
                        tenant_id: tenantIdStr,
                        role: mappedRole,
                        role_name: mappedRole,
                        permissions: fetchedPermissions,
                        event_ids: eventIds,
                        permittedEventIds: eventIds
                      };

                      const routeState = get();
                      originalSet({
                        currentUser: {
                          id: accountData.account_id,
                          username: accountData.username,
                          displayName: accountData.display_name,
                        },
                        currentEnterpriseUser: restoredEnterpriseUser,
                        userRole: mappedRole,
                        activeTenantId: routedWorkspace ? routeState.activeTenantId : tenantIdStr,
                        permissions: fetchedPermissions,
                        isAdmin: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'].includes(mappedRole)
                      });
                   }
                }
             }
          } catch (err: any) {
             console.warn('Lỗi khi phục hồi session trước tiên.');
          }

          if (routedWorkspace) {
            originalSet({ supabaseConnected: true, isLoadingSupabase: false });
            return;
          }

          try {
            // Lấy trạng thái dữ liệu trong store cục bộ trước khi query (khôi phục từ localStorage)
            const localState = get();
            const realTenantId = await getCurrentTenantId();
            const activeTenantId = localState.activeTenantId || realTenantId || 'default';
            // Only add eq(tenant_id) if it is a real UUID! Default is invalid for UUID type.
            const validTenantUUID = activeTenantId !== 'default' ? activeTenantId : null;
            
            console.log(`[LegacyInit] Loading tenant-scoped fallback data for "${validTenantUUID || 'default'}" from Supabase...`);
            
            // 1. Đọc giải đấu (Tournament metadata) - Bảng cấu hình chung nhỏ gọn (no select *)
            const { data: tData, error: tError } = await supabase.from('tournament').select('id, name, organization, location, date, settings, current_event_id');
            if (tError) {
              if (tError.code === '42P01' || tError.message?.includes('relation') || tError.message?.includes('does not exist')) {
                console.warn('LƯU Ý: Các bảng dữ liệu chưa được khởi tạo trên Supabase. Đang chạy ở chế độ dự phòng Offline.');
                originalSet({ supabaseConnected: false });
                return;
              }
              throw tError;
            }

            // Lọc ra các giải đấu thông thường
            const regularTournaments = tData || [];

            // TÌNH HUỐNG 2: SUPABASE ĐÃ CÓ VỀ HOẶC CẦN KHỞI TẠO NỘI DUNG RIÊNG CHO TENANT
            const targetTid = localState.activeTournamentId || (localState.activeTenantId === 'default' ? 't-1' : localState.activeTenantId);
            let dbTournament = regularTournaments.find((rowId: any) => rowId.id === targetTid) || null;
            if (!dbTournament) {
              let tournamentDetailsName = DEFAULT_TOURNAMENT.name;
              if (localState.activeTenantId !== 'default') {
                if (localState.currentEnterpriseUser?.tenant?.name) {
                  tournamentDetailsName = localState.currentEnterpriseUser.tenant.name;
                } else {
                  // Fallback to fetch tenant info if current user isn't populated
                  try {
                    const { data: tenantData } = await supabase.from('tenants').select('name').eq('id', localState.activeTenantId).single();
                    if (tenantData) {
                      tournamentDetailsName = tenantData.name;
                    } else {
                      tournamentDetailsName = `Giải Pickleball thuộc Đơn Vị ${localState.activeTenantId}`;
                    }
                  } catch(e) {
                      tournamentDetailsName = `Giải Pickleball thuộc Đơn Vị ${localState.activeTenantId}`;
                  }
                }
              }

              const defaultObj = {
                id: targetTid,
                name: tournamentDetailsName,
                organization: localState.activeTenantId === 'default' ? DEFAULT_TOURNAMENT.organization : `Ban Tổ Chức ${localState.activeTenantId}`,
                location: DEFAULT_TOURNAMENT.location,
                date: DEFAULT_TOURNAMENT.date,
                settings: DEFAULT_SETTINGS,
                current_event_id: localState.activeTenantId === 'default' ? 'event-default' : `${localState.activeTenantId}__event-default`,
              };
              if (localState.hasPermission('manage_tenants') || localState.hasPermission('manage_tournaments') || localState.hasPermission('*')) {
                await supabase.from('tournament').insert([defaultObj]);
              }
              dbTournament = defaultObj;
            }

            const currentEventId = dbTournament.current_event_id || '';

            const tournamentState: Tournament = {
              id: dbTournament.id,
              name: dbTournament.name,
              organization: dbTournament.organization,
              location: dbTournament.location,
              date: dbTournament.date,
              settings: dbTournament.settings || DEFAULT_SETTINGS
            };

            // Lưu dữ liệu trực tuyến đồng bộ hoàn chỉnh vào Zustand store
            originalSet({
              tournament: tournamentState,
              activeTenantId,
              activeTournamentId: dbTournament.id,
              currentEventId: currentEventId,
              supabaseConnected: true,
              isLoadingSupabase: false,
              events: {},
              teams: {},
              groups: {},
              matches: [],
              logs: []
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
      partialize: (state) => Object.fromEntries(
        Object.entries(state).filter(([key]) => !['currentUser', 'currentEnterpriseUser', 'userRole', 'activeTenantId', 'permissions', 'isAdmin'].includes(key))
      ),
    }
  )
);

function tIdToNameOrId(id: string, teamsMap: Record<string, Team>): string {
  if (teamsMap[id]) return teamsMap[id].name;
  return id;
}
