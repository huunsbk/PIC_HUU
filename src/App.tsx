import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useParams, useNavigate, Navigate } from 'react-router-dom';
import { useTournamentStore } from './store';
import { supabase } from './supabaseClient';

// Importing Tab Components
import Dashboard from './components/Dashboard';
import TeamManager from './components/TeamManager';
import GroupManager from './components/GroupManager';
import ScoreEntry from './components/ScoreEntry';
import SchedulerAndScoreKeeper from './components/SchedulerAndScoreKeeper';
import Standings from './components/Standings';
import KnockoutBracket from './components/KnockoutBracket';
import LiveDashboard from './components/LiveDashboard';
import AuditLogger from './components/AuditLogger';
import EventBar from './components/EventBar';
import ExportManager from './components/ExportManager';
import AuthModal from './components/AuthModal';

import AccountManager from './components/AccountManager';
import EventManagementPage from './components/event-management-page';
import TournamentWorkspaceListPage from './components/TournamentWorkspaceListPage';
import TenantManagementPage from './components/TenantManagementPage';
import EventSwitcher from './components/event-switcher';
import { useEventsQuery } from './components/use-events-query';
import { getAuthHashErrorMessage } from './lib/authRedirect';

import {
  Trophy,
  Users,
  Layers,
  CalendarDays,
  FileSpreadsheet,
  Network,
  Tv,
  ClipboardList,
  Sun,
  Moon,
  Zap,
  Gamepad2,
  FileDown,
  ShieldAlert,
  UserCog,
  Building2,
  UserCircle
} from 'lucide-react';

function isRouteWorkspacePathname() {
  const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const appPath = window.location.pathname.startsWith(basePath)
    ? window.location.pathname.slice(basePath.length)
    : window.location.pathname;
  return appPath.startsWith('/admin/workspace/') || appPath.startsWith('/tournament/');
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// Wrapper for Admin Workspace
function AdminWorkspace() {
  const { slug } = useParams();
  const setWorkspaceContext = useTournamentStore((state) => state.setWorkspaceContext);
  const activeTenantId = useTournamentStore(state => state.activeTenantId);
  const activeTournamentId = useTournamentStore(state => state.activeTournamentId);
  const userRole = useTournamentStore(state => state.userRole);
  const initSupabase = useTournamentStore(state => state.initSupabase);
  const setSelectedTab = useTournamentStore(state => state.setSelectedTab);

  useEffect(() => {
    let isCancelled = false;
    const loadWorkspace = async () => {
      if (!slug) return;
      const routeSlug = decodeURIComponent(slug);
      let tenantOrTournamentId = routeSlug;
      let tournamentId = routeSlug;

      const { data: tenantByRouteSlug } = await supabase
        .from('tenants')
        .select('id, name, slug')
        .eq('slug', routeSlug)
        .is('deleted_at', null)
        .maybeSingle();

      let tenantByRouteId = null as null | { id: string; name: string; slug: string };
      if (!tenantByRouteSlug && isUuid(routeSlug)) {
        const { data } = await supabase
          .from('tenants')
          .select('id, name, slug')
          .eq('id', routeSlug)
          .is('deleted_at', null)
          .maybeSingle();
        tenantByRouteId = data;
      }

      const tenantByRoute = tenantByRouteSlug || tenantByRouteId;

      if (tenantByRoute) {
        const { data: latestTournament } = await supabase
          .from('tournament')
          .select('id, tenant_id, slug, name')
          .eq('tenant_id', tenantByRoute.id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!latestTournament) {
          if (!isCancelled && activeTenantId !== tenantByRoute.id) {
            await setWorkspaceContext({
              tenantId: tenantByRoute.id,
              tenantName: tenantByRoute.name,
              tournamentId: null,
              tournamentName: null,
              tournamentSlug: null,
            });
          }
          if (!isCancelled) setSelectedTab('workspaces');
          return;
        }

        tenantOrTournamentId = tenantByRoute.id;
        tournamentId = latestTournament.id;
        if (!isCancelled) {
          await setWorkspaceContext({
            tenantId: tenantByRoute.id,
            tenantName: tenantByRoute.name,
            tournamentId: latestTournament.id,
            tournamentName: latestTournament.name,
            tournamentSlug: latestTournament.slug,
          });
        }
        return;
      }

      const { data: workspaceContext, error: workspaceContextError } = await supabase.rpc('get_workspace_context_v1', {
        p_slug: routeSlug,
      });

      if (!workspaceContextError && workspaceContext?.tenant_id && workspaceContext?.tournament_id) {
        if (!isCancelled) {
          await setWorkspaceContext({
            tenantId: workspaceContext.tenant_id,
            tenantName: workspaceContext.tenant_name,
            tournamentId: workspaceContext.tournament_id,
            tournamentName: workspaceContext.tournament_name,
            tournamentSlug: workspaceContext.tournament_slug,
          });
        }
        return;
      }

      const { data: bySlug } = await supabase
        .from('tournament')
        .select('id, tenant_id, slug, name')
        .eq('slug', routeSlug)
        .maybeSingle();

      if (bySlug) {
        tenantOrTournamentId = bySlug.tenant_id || bySlug.id;
        tournamentId = bySlug.id;
      } else {
        const { data: byId } = await supabase
          .from('tournament')
          .select('id, tenant_id, slug, name')
          .eq('id', routeSlug)
          .maybeSingle();
        if (byId) {
          tenantOrTournamentId = byId.tenant_id || byId.id;
          tournamentId = byId.id;
        }
      }

      if (isCancelled) return;
      if (activeTenantId !== tenantOrTournamentId || activeTournamentId !== tournamentId) {
        await setWorkspaceContext({
          tenantId: tenantOrTournamentId,
          tournamentId,
          tournamentName: bySlug?.name,
          tournamentSlug: bySlug?.slug,
        });
      } else {
        initSupabase();
      }
    };

    loadWorkspace();
    return () => {
      isCancelled = true;
    };
  }, [slug, activeTenantId, activeTournamentId, userRole, setWorkspaceContext, initSupabase, setSelectedTab]);

  return <TournamentShell />;
}

// Wrapper for Public Tournament
function PublicTournament() {
  const { slug } = useParams();
  const setWorkspaceContext = useTournamentStore((state) => state.setWorkspaceContext);
  const activeTenantId = useTournamentStore(state => state.activeTenantId);
  const activeTournamentId = useTournamentStore(state => state.activeTournamentId);
  const userRole = useTournamentStore(state => state.userRole);
  const initSupabase = useTournamentStore(state => state.initSupabase);
  const setSelectedTab = useTournamentStore(state => state.setSelectedTab);

  useEffect(() => {
    let isCancelled = false;
    const loadTournament = async () => {
    if (slug) {
       const routeSlug = decodeURIComponent(slug);
       let tenantOrTournamentId = routeSlug;
       let tournamentId = routeSlug;
       const { data: workspaceContext, error: workspaceContextError } = await supabase.rpc('get_workspace_context_v1', {
         p_slug: routeSlug,
       });
       if (!workspaceContextError && workspaceContext?.tenant_id && workspaceContext?.tournament_id) {
          if (!isCancelled) {
            await setWorkspaceContext({
              tenantId: workspaceContext.tenant_id,
              tenantName: workspaceContext.tenant_name,
              tournamentId: workspaceContext.tournament_id,
              tournamentName: workspaceContext.tournament_name,
              tournamentSlug: workspaceContext.tournament_slug,
            });
            if(useTournamentStore.getState().userRole === 'guest') setSelectedTab('live');
          }
          return;
       }
       const { data: bySlug } = await supabase
         .from('tournament')
         .select('id, tenant_id, slug, name')
         .eq('slug', routeSlug)
         .maybeSingle();
       if (bySlug) {
          tenantOrTournamentId = bySlug.tenant_id || bySlug.id;
          tournamentId = bySlug.id;
       } else {
          const { data: byId } = await supabase
            .from('tournament')
            .select('id, tenant_id, slug, name')
            .eq('id', routeSlug)
            .maybeSingle();
          if (byId) {
            tenantOrTournamentId = byId.tenant_id || byId.id;
            tournamentId = byId.id;
          }
       }
       if (isCancelled) return;
       if (activeTenantId !== tenantOrTournamentId || activeTournamentId !== tournamentId) {
          setWorkspaceContext({ tenantId: tenantOrTournamentId, tournamentId }).then(() => {
             if(useTournamentStore.getState().userRole === 'guest') setSelectedTab('live');
          });
       } else {
          initSupabase().then(() => {
             if(useTournamentStore.getState().userRole === 'guest') setSelectedTab('live');
          });
       }
    }
    };

    loadTournament();
    return () => {
      isCancelled = true;
    };
  }, [slug, activeTenantId, activeTournamentId, userRole, setWorkspaceContext, initSupabase, setSelectedTab]);

  return <TournamentShell />;
}

// Basic Wrapper for Enterprise / Login Page
function RootEntry() {
  const initSupabase = useTournamentStore(state => state.initSupabase);
  const setTenantId = useTournamentStore(state => state.setTenantId);
  const navigate = useNavigate();
  
  useEffect(() => {
      const legacyHash = window.location.hash.replace(/^#\/?/, '').trim();
      if (legacyHash) {
        supabase
          .from('tournament')
          .select('id, slug')
          .eq('id', legacyHash)
          .maybeSingle()
          .then(async ({ data }) => {
            if (data?.slug) {
              navigate(`/admin/workspace/${data.slug}`, { replace: true });
              return;
            }

            if (isUuid(legacyHash)) {
              const { data: tenant } = await supabase
                .from('tenants')
                .select('slug')
                .eq('id', legacyHash)
                .is('deleted_at', null)
                .maybeSingle();
              if (tenant?.slug) {
                navigate(`/admin/workspace/${tenant.slug}`, { replace: true });
                return;
              }
            }

            navigate('/', { replace: true });
          });
        return;
      }
      setTenantId('default').then(() => {
         initSupabase();
      });
  }, [setTenantId, initSupabase, navigate]);

  return <TournamentShell />;
}

export default function App() {
  const [authHashError, setAuthHashError] = React.useState<string | null>(null);

  useEffect(() => {
    const message = getAuthHashErrorMessage();
    if (!message) return;

    setAuthHashError(message);
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  }, []);

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {authHashError && (
        <div className="fixed left-4 right-4 top-4 z-[90] mx-auto max-w-2xl rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800 shadow-lg dark:border-red-900/40 dark:bg-red-950 dark:text-red-200">
          <div className="flex items-start justify-between gap-3">
            <span>{authHashError}</span>
            <button
              type="button"
              onClick={() => setAuthHashError(null)}
              className="shrink-0 rounded-md px-2 py-1 text-red-700 hover:bg-red-100 dark:text-red-200 dark:hover:bg-red-900/50"
            >
              Đóng
            </button>
          </div>
        </div>
      )}
      <Routes>
        <Route path="/" element={<RootEntry />} />
        <Route path="/admin/workspace/:slug" element={<AdminWorkspace />} />
        <Route path="/tournament/:slug" element={<PublicTournament />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function TournamentShell() {
  const tournament = useTournamentStore((state) => state.tournament);
  const darkMode = useTournamentStore((state) => state.darkMode);
  const setDarkMode = useTournamentStore((state) => state.setDarkMode);
  const selectedTab = useTournamentStore((state) => state.selectedTab);
  const setSelectedTab = useTournamentStore((state) => state.setSelectedTab);
  const hasPermission = useTournamentStore((state) => state.hasPermission);
  const supabaseConnected = useTournamentStore((state) => state.supabaseConnected);
  const currentUser = useTournamentStore((state) => state.currentUser);
  const currentEnterpriseUser = useTournamentStore((state) => state.currentEnterpriseUser);
  const userRole = useTournamentStore((state) => state.userRole);
  const permissions = useTournamentStore((state) => state.permissions);
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const activeTenantName = useTournamentStore((state) => state.activeTenantName);
  const currentEventId = useTournamentStore((state) => state.currentEventId);
  const { data: headerEvents = [] } = useEventsQuery();
  const currentHeaderEvent = headerEvents.find((event: any) => event.id === currentEventId) || headerEvents[0];
  const isAuthenticated = !!currentEnterpriseUser || userRole !== 'guest' || !!currentUser;
  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: 'Quản trị hệ thống',
    TENANT_ADMIN: 'Quản trị đơn vị',
    EVENT_ADMIN: 'Quản trị giải đấu',
    REFEREE: 'Trọng tài',
    VIEWER: 'Người xem',
    guest: 'Khách',
  };
  const profileName =
    currentEnterpriseUser?.displayName ||
    currentEnterpriseUser?.display_name ||
    currentEnterpriseUser?.username ||
    currentUser ||
    'Chưa đăng nhập';
  const profileRole = roleLabels[currentEnterpriseUser?.role_name || currentEnterpriseUser?.role || userRole] || currentEnterpriseUser?.role_name || currentEnterpriseUser?.role || userRole;
  const profileTournamentName = tournament.name || 'Chưa chọn giải';

  const [isLoginOpen, setIsLoginOpen] = React.useState(false);

  // Sync Data Effect
  useEffect(() => {
    let debounceTimer: number;
    const triggerFullSync = () => {
       if (isRouteWorkspacePathname()) return;
       window.clearTimeout(debounceTimer);
       debounceTimer = window.setTimeout(() => {
          useTournamentStore.getState().initSupabase();
       }, 2500); 
    };

    const realtimeChannel = supabase.channel('public_db_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (payload) => {
          useTournamentStore.getState().syncRealtimeMatch(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, triggerFullSync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, triggerFullSync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, triggerFullSync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament' }, triggerFullSync)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'active_sessions' }, (payload) => {
          const state = useTournamentStore.getState();
          if (state.currentEnterpriseUser && payload.old.account_id === state.currentEnterpriseUser.id) {
             state.logout();
          }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(realtimeChannel);
      window.clearTimeout(debounceTimer);
    };
  }, []);

  // Bảo mật phiên làm việc: Auto-Logout
  useEffect(() => {
    if (!hasPermission("manage_events")) return;
    let inactivityTimer: number;
    const resetTimer = () => {
      window.clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(() => {
        alert('ĐÃ ĐĂNG XUẤT do không hoạt động trong 30 phút.');
        useTournamentStore.getState().logout();
      }, 1800000);
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(evt => document.addEventListener(evt, resetTimer));
    resetTimer(); 
    return () => {
      window.clearTimeout(inactivityTimer);
      events.forEach(evt => document.removeEventListener(evt, resetTimer));
    };
  }, [hasPermission]);

  const handleAdminAuth = () => {
    if (isAuthenticated) {
      useTournamentStore.getState().logout();
    } else {
      setIsLoginOpen(true);
    }
  };

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const navItems = React.useMemo(() => {
    const allNavItems = [
      { id: 'dashboard', label: 'Tổng quan giải', icon: Trophy, permission: 'view_public', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'] },
      { id: 'teams', label: 'Quản lý đội', icon: Users, permission: 'manage_teams', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'] },
      { id: 'groups', label: 'Chia bảng', icon: Layers, permission: 'manage_groups', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'] },
      { id: 'scoreEntry', label: 'Nhập điểm', icon: Gamepad2, permission: 'enter_scores', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE'] },
      { id: 'matches', label: 'Lịch & Kết quả', icon: CalendarDays, permission: 'manage_matches', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE'] },
      { id: 'standings', label: 'Xếp hạng & Vào vòng trong', icon: FileSpreadsheet, permission: 'view_public', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE'] },
      { id: 'knockout', label: 'Sơ đồ Knockout', icon: Network, permission: 'manage_matches', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'] },
      { id: 'live', label: 'Bảng trình chiếu TV', icon: Tv, permission: 'view_public', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE', 'guest'] },
      { id: 'export', label: 'Xuất file', icon: FileDown, permission: 'view_public', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'] },
      { id: 'tenants', label: 'Quản lý đơn vị', icon: Building2, permission: 'manage_tenants', roles: ['SUPER_ADMIN'] },
      { id: 'workspaces', label: 'Quản lý giải đấu', icon: Layers, permission: 'manage_tournaments', roles: ['SUPER_ADMIN', 'TENANT_ADMIN'] },
      { id: 'events_center', label: 'Nội dung thi đấu', icon: CalendarDays, permission: 'manage_events', roles: ['SUPER_ADMIN', 'TENANT_ADMIN'] },
      { id: 'logs', label: 'Nhật ký hệ thống', icon: ClipboardList, permission: 'view_audit_logs', roles: ['SUPER_ADMIN', 'TENANT_ADMIN'] },
      { id: 'accounts', label: 'Quản lý tài khoản', icon: UserCog, permission: 'manage_accounts', roles: ['SUPER_ADMIN', 'TENANT_ADMIN'] },
    ];
    
    if (userRole === 'guest') {
      return allNavItems.filter(item => item.id === 'live');
    }

    return allNavItems.filter(item => {
      if (!item.roles.includes(userRole)) return false;
      if (hasPermission('*')) return true;
      return hasPermission(item.permission) || hasPermission('*');
    });
  }, [permissions, userRole, hasPermission]);

  useEffect(() => {
    if (!navItems.find(item => item.id === selectedTab)) {
      if (navItems.length > 0) {
        setSelectedTab(navItems[0].id);
      }
    }
  }, [navItems, selectedTab, setSelectedTab]);

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans transition-colors duration-250">
      <div className="flex flex-col lg:flex-row min-h-screen">
        <aside className="w-full lg:w-64 bg-[#111c30] text-slate-200 flex flex-col shrink-0 border-r border-[#1e293b] print:hidden">
          <div className="p-4 border-b border-[#1e293b] flex items-center gap-2.5">
            <div className="bg-blue-600 p-2 rounded-xl text-white shadow-md animate-pulse">
              <Trophy size={18} className="stroke-[2.5]" id="logo-badge" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-tight text-white leading-tight uppercase font-display flex items-center gap-1">
                NGUYỄN VĂN HỮU
              </h1>
              <p className="text-[9px] text-slate-400 font-medium tracking-wide">Điều Hành Giải Chuyên Nghiệp</p>
            </div>
          </div>

          <div className="flex-1 p-3 space-y-1 overflow-y-auto">
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-2.5 mb-2">Menu</p>
            <div className="space-y-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = selectedTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedTab(item.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold tracking-normal transition-all duration-150 text-left cursor-pointer group ${
                      isActive ? 'bg-blue-600 text-white shadow-md font-extrabold translate-x-1' : 'text-slate-300 hover:bg-[#1e293b]/70 hover:text-white'
                    }`}
                  >
                    <Icon size={15} className={`transition-transform duration-150 group-hover:scale-110 ${isActive ? 'text-white stroke-[2.5]' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-3.5 border-t border-[#1e293b] bg-[#0e1726]/80 flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                {supabaseConnected === null ? <><Zap size={10} className="animate-spin" /> ...</> : supabaseConnected ? <><Zap size={10} className="text-emerald-400" /> Trực tuyến</> : <><Zap size={10} className="text-amber-500" /> Ngoại tuyến</>}
              </span>
            </div>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded-xl bg-[#1e293b] hover:bg-slate-800 text-slate-350 hover:text-white transition-all cursor-pointer border border-slate-700/50"
            >
              {darkMode ? <Sun size={13} className="text-amber-400 fill-amber-300/15" /> : <Moon size={13} />}
            </button>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-30 bg-white/95 dark:bg-zinc-900/90 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800/80 px-3 sm:px-5 py-2 sm:py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-start sm:justify-between gap-2 sm:gap-0 shadow-xs print:hidden">
            <div className="space-y-0.5">
              <p className="text-[8px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest leading-none">Cổng Điều Hành Trực Tuyến</p>
              <h2 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 max-w-full sm:max-w-2xl whitespace-normal break-words">
                {tournament.name || 'HỆ THỐNG QUẢN LÝ GIẢI ĐẤU PICKLEBALL'}
              </h2>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold text-zinc-500 dark:text-zinc-400">
                <span>Đơn vị: {activeTenantName || currentEnterpriseUser?.tenant?.name || activeTenantId || 'Chưa chọn'}</span>
                <span>Giải: {tournament.name || 'Chưa chọn'}</span>
                <span>Nội dung thi đấu: {currentHeaderEvent?.name || 'Chưa chọn'}</span>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center justify-end gap-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
               {isAuthenticated ? (
                <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                  <div className="flex max-w-[260px] items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-left shadow-xs dark:border-zinc-800 dark:bg-zinc-950/70">
                    <UserCircle size={18} className="shrink-0 text-blue-600 dark:text-blue-400" />
                    <div className="min-w-0 leading-tight">
                      <p className="truncate text-[11px] font-black text-zinc-900 dark:text-zinc-100">{profileName}</p>
                      <p className="truncate text-[10px] font-bold text-zinc-500 dark:text-zinc-400">{profileRole}</p>
                      <p className="truncate text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">Giải: {profileTournamentName}</p>
                    </div>
                  </div>
                  <EventSwitcher />
                  <button onClick={() => useTournamentStore.getState().logout()} className="cursor-pointer text-[10px] font-bold bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-red-650 dark:text-red-400 border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 rounded transition-colors">
                    Đăng xuất
                  </button>
                </div>
              ) : (
                <button onClick={handleAdminAuth} className="cursor-pointer text-[10px] font-bold bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded border border-blue-700 shadow-xs flex items-center gap-1 transition-all">
                  🔒 Đăng nhập Admin
                </button>
              )}
            </div>
          </header>

          <main className="flex-1 p-4 lg:p-6 w-full print:p-0 print:w-full" id="main-content-panel">
            {selectedTab !== 'live' && selectedTab !== 'tenants' && selectedTab !== 'workspaces' && selectedTab !== 'events_center' && selectedTab !== 'logs' && selectedTab !== 'export' && selectedTab !== 'scoreEntry' && selectedTab !== 'accounts' && <EventBar />}
            <div className="animate-fade-in">
              {(() => {
                const isTabAllowed = navItems.some(item => item.id === selectedTab);
                if (!isTabAllowed) {
                  return (
                    <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-zinc-900 rounded-xl border border-red-100 dark:border-red-900/30">
                      <ShieldAlert className="w-12 h-12 text-red-500 mb-4" />
                      <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Truy Cập Bị Từ Chối</h3>
                    </div>
                  );
                }

                return (
                  <>
                    {selectedTab === 'dashboard' && <Dashboard />}
                    {selectedTab === 'teams' && <TeamManager />}
                    {selectedTab === 'groups' && <GroupManager />}
                    {selectedTab === 'scoreEntry' && <ScoreEntry />}
                    {selectedTab === 'matches' && <SchedulerAndScoreKeeper />}
                    {selectedTab === 'standings' && <Standings />}
                    {selectedTab === 'knockout' && <KnockoutBracket />}
                    {selectedTab === 'live' && <LiveDashboard />}
                    {selectedTab === 'export' && <ExportManager />}
                    {selectedTab === 'tenants' && <TenantManagementPage />}
                    {selectedTab === 'workspaces' && <TournamentWorkspaceListPage />}
                    {selectedTab === 'events_center' && <EventManagementPage />}
                    {selectedTab === 'logs' && <AuditLogger />}
                    {selectedTab === 'accounts' && <AccountManager />}
                  </>
                );
              })()}
            </div>
          </main>
        </div>
      </div>
      <AuthModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} />
    </div>
  );
}
