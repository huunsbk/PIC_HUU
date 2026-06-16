import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useParams, useNavigate, Outlet, Navigate } from 'react-router-dom';
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
import EventSwitcher from './components/event-switcher';

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
  UserCheck,
  ShieldAlert,
  User,
  Settings,
  RefreshCw,
  UserCog
} from 'lucide-react';

// Wrapper for Admin Workspace
function AdminWorkspace() {
  const { slug } = useParams();
  const setTenantId = useTournamentStore((state) => state.setTenantId);
  const activeTenantId = useTournamentStore(state => state.activeTenantId);
  const initSupabase = useTournamentStore(state => state.initSupabase);

  useEffect(() => {
    if (slug) {
       const tenantStr = slug.replace(/-/g, '_');
       if (activeTenantId !== tenantStr) {
          setTenantId(tenantStr);
       } else {
          initSupabase();
       }
    }
  }, [slug, activeTenantId, setTenantId, initSupabase]);

  return <TournamentShell />;
}

// Wrapper for Public Tournament
function PublicTournament() {
  const { slug } = useParams();
  const setTenantId = useTournamentStore((state) => state.setTenantId);
  const activeTenantId = useTournamentStore(state => state.activeTenantId);
  const initSupabase = useTournamentStore(state => state.initSupabase);
  const setSelectedTab = useTournamentStore(state => state.setSelectedTab);

  useEffect(() => {
    if (slug) {
       const tenantStr = slug.replace(/-/g, '_');
       if (activeTenantId !== tenantStr) {
          setTenantId(tenantStr).then(() => {
             // force public view
             if(useTournamentStore.getState().userRole === 'guest') setSelectedTab('live');
          });
       } else {
          initSupabase().then(() => {
             if(useTournamentStore.getState().userRole === 'guest') setSelectedTab('live');
          });
       }
    }
  }, [slug, activeTenantId, setTenantId, initSupabase, setSelectedTab]);

  return <TournamentShell />;
}

// Basic Wrapper for Enterprise / Login Page
function RootEntry() {
  const initSupabase = useTournamentStore(state => state.initSupabase);
  const setTenantId = useTournamentStore(state => state.setTenantId);
  
  useEffect(() => {
      setTenantId('default').then(() => {
         initSupabase();
      });
  }, [setTenantId, initSupabase]);

  return <TournamentShell />;
}

export default function App() {
  return (
    <BrowserRouter>
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

  const [isLoginOpen, setIsLoginOpen] = React.useState(false);

  // Sync Data Effect
  useEffect(() => {
    let debounceTimer: number;
    const triggerFullSync = () => {
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
    if (hasPermission("manage_events")) {
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
      { id: 'dashboard', label: 'Trang chủ', icon: Trophy, permission: 'view_dashboard', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'] },
      { id: 'teams', label: 'Quản lý đội', icon: Users, permission: 'manage_teams', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'] },
      { id: 'groups', label: 'Chia bảng', icon: Layers, permission: 'manage_groups', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'] },
      { id: 'scoreEntry', label: 'Nhập điểm', icon: Gamepad2, permission: 'enter_score', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE'] },
      { id: 'matches', label: 'Lịch & Kết quả', icon: CalendarDays, permission: 'manage_matches', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE'] },
      { id: 'standings', label: 'Tuyển chọn vòng trong', icon: FileSpreadsheet, permission: 'view_standings', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE'] },
      { id: 'knockout', label: 'Sơ đồ trực tiếp', icon: Network, permission: 'manage_knockout', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'] },
      { id: 'live', label: 'Bảng trình chiếu TV', icon: Tv, permission: 'view_live', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE', 'guest'] },
      { id: 'export', label: 'Xuất file', icon: FileDown, permission: 'export_data', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'] },
      { id: 'workspaces', label: 'Enterprise Workspaces', icon: Layers, permission: 'manage_system', roles: ['SUPER_ADMIN', 'TENANT_ADMIN'] },
      { id: 'events_center', label: 'Event Center', icon: CalendarDays, permission: 'manage_system', roles: ['SUPER_ADMIN', 'TENANT_ADMIN'] },
      { id: 'logs', label: 'Nhật ký hệ thống', icon: ClipboardList, permission: 'view_logs', roles: ['SUPER_ADMIN', 'TENANT_ADMIN'] },
      { id: 'accounts', label: 'Quản lý tài khoản', icon: UserCog, permission: 'manage_users', roles: ['SUPER_ADMIN', 'TENANT_ADMIN'] },
    ];
    
    if (userRole === 'guest') {
      return allNavItems.filter(item => item.id === 'live');
    }

    return allNavItems.filter(item => {
      if (hasPermission('*') || hasPermission('manage_tournaments')) return true;
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
            </div>
            
            <div className="flex items-center gap-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
               {hasPermission("manage_events") ? (
                <div className="flex items-center gap-2 text-xs">
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
            {selectedTab !== 'live' && selectedTab !== 'workspaces' && selectedTab !== 'events_center' && selectedTab !== 'logs' && selectedTab !== 'export' && selectedTab !== 'scoreEntry' && selectedTab !== 'accounts' && <EventBar />}
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
