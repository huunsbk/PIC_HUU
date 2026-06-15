/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
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
  RefreshCw
} from 'lucide-react';

export default function App() {
  const tournament = useTournamentStore((state) => state.tournament);
  const darkMode = useTournamentStore((state) => state.darkMode);
  const setDarkMode = useTournamentStore((state) => state.setDarkMode);
  const selectedTab = useTournamentStore((state) => state.selectedTab);
  const setSelectedTab = useTournamentStore((state) => state.setSelectedTab);
  const isAdmin = useTournamentStore((state) => state.isAdmin);
  const setAdminStatus = useTournamentStore((state) => state.setAdminStatus);
  const initSupabase = useTournamentStore((state) => state.initSupabase);
  const supabaseConnected = useTournamentStore((state) => state.supabaseConnected);
  const currentUser = useTournamentStore((state) => state.currentUser);
  const currentEnterpriseUser = useTournamentStore((state) => state.currentEnterpriseUser);
  const userRole = useTournamentStore((state) => state.userRole);
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  const setAuthStatus = useTournamentStore((state) => state.setAuthStatus);
  const setTenantId = useTournamentStore((state) => state.setTenantId);
  const currentSessionId = useTournamentStore((state) => state.currentSessionId);

  const [isLoginOpen, setIsLoginOpen] = React.useState(false);
  const [isDbChanging, setIsDbChanging] = React.useState(false);

  const handleDbChange = async (newId: string) => {
    setIsDbChanging(true);
    try {
      await setTenantId(newId);
      const slugId = newId.replace(/_/g, '-');
      if (newId !== 'default') {
        window.location.hash = `/${slugId}`;
      } else {
        window.location.hash = '/';
      }
      setTimeout(() => {
        window.location.reload();
      }, 100);
    } catch (e) {
      console.error("Lỗi khi chuyển đổi CSDL:", e);
      setIsDbChanging(false);
    }
  };

  // Khởi tạo & đồng bộ dữ liệu từ Supabase trực tuyến khi khởi chạy ứng dụng
  // tích hợp tự động nhận diện phân rã dữ liệu (Tenant ID) qua tham số Đường dẫn / Query / Hash trên URL
  const initializedRef = React.useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const detectTenantFromUrl = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const qTenant = searchParams.get('g') || searchParams.get('tenant') || searchParams.get('id');
      if (qTenant) {
        return qTenant.trim().toLowerCase();
      }

      const hash = window.location.hash;
      if (hash) {
        const cleanHash = hash.replace(/^#\/?/, '').trim();
        if (cleanHash && !cleanHash.includes('/') && !['dashboard', 'teams', 'groups', 'scoreEntry', 'matches', 'standings', 'knockout', 'live', 'export', 'accounts', 'logs'].includes(cleanHash)) {
          return cleanHash.toLowerCase();
        }
      }

      const pathname = window.location.pathname;
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        for (let i = segments.length - 1; i >= 0; i--) {
          const seg = segments[i].toLowerCase();
          if (
            seg !== 'index.html' && 
            seg !== 'dist' && 
            seg !== 'pic_huu' && 
            seg !== 'pic-huu' &&
            !['dashboard', 'teams', 'groups', 'scoreEntry', 'matches', 'standings', 'knockout', 'live', 'export', 'accounts', 'logs'].includes(seg)
          ) {
            return seg;
          }
        }
      }
      return 'default';
    };

    const processUrlTenant = async () => {
      const detected = detectTenantFromUrl();
      const normalizedTenant = detected.replace(/-/g, '_'); 
      
      if (normalizedTenant !== activeTenantId) {
        console.log(`[URL] Phát hiện thay đổi CSDL: ${normalizedTenant} khác với ${activeTenantId}. Đang chuyển cấu hình...`);
        await setTenantId(normalizedTenant);
      } else {
        await initSupabase();
      }
    };

    processUrlTenant();
  }, [initSupabase, activeTenantId, setTenantId]);

  useEffect(() => {
    // Lắng nghe sự kiện Auth từ Supabase
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      const store = useTournamentStore.getState();
      
      if (event === 'SIGNED_OUT') {
        console.log('[Auth Listener] Phát hiện đăng xuất (SIGNED_OUT).');
        if (store.userRole !== 'guest' || store.currentUser !== null) {
          store.logout();
        }
      } else if (event === 'SIGNED_IN' && session?.user && store.userRole === 'guest') {
        // Option to handle reload or auto-login on new tab if needed.
        // For now, let AuthModal handle the sign in when user submits.
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Sử dụng Supabase Realtime WebSockets thay vì setInterval (Polling)
  // Chỉ nhận lượng dữ liệu đúng bằng 1 trận đấu thay vì toàn bộ DB
  useEffect(() => {
    let debounceTimer: number;
    const triggerFullSync = () => {
       window.clearTimeout(debounceTimer);
       debounceTimer = window.setTimeout(() => {
          useTournamentStore.getState().initSupabase();
       }, 2500); // Gộp các thay đổi cấu trúc (tránh spam)
    };

    const realtimeChannel = supabase.channel('public_db_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (payload) => {
          // Tối ưu RAM và CPU: Cập nhật trực tiếp 1 trận đấu vào Store mà không cần Reload
          useTournamentStore.getState().syncRealtimeMatch(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, triggerFullSync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, triggerFullSync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, triggerFullSync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament' }, triggerFullSync)
      .subscribe();

    return () => {
      supabase.removeChannel(realtimeChannel);
      window.clearTimeout(debounceTimer);
    };
  }, []);

  // Bảo mật phiên làm việc: Auto-Logout và xóa cache khi đóng trình duyệt
  useEffect(() => {
    if (!isAdmin) return;

    // Tự động đăng xuất sau 30 phút (1,800,000ms) không hoạt động
    let inactivityTimer: number;

    const resetTimer = () => {
      window.clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(() => {
        console.warn('Phiên làm việc đã hết hạn do không hoạt động.');
        alert('ĐÃ ĐĂNG XUẤT:\n\nVì sự an toàn của dữ liệu, hệ thống tự động đăng xuất nếu không có thao tác nào trong vòng 30 phút. Vui lòng đăng nhập lại.');
        useTournamentStore.getState().logout();
      }, 1800000);
    };

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(evt => document.addEventListener(evt, resetTimer));
    resetTimer(); // Bắt đầu đếm giờ ngay lập tức

    return () => {
      window.clearTimeout(inactivityTimer);
      events.forEach(evt => document.removeEventListener(evt, resetTimer));
    };
  }, [isAdmin]);

  const handleAdminAuth = () => {
    if (isAdmin) {
      useTournamentStore.getState().logout();
    } else {
      setIsLoginOpen(true);
    }
  };

  // Áp dụng lớp .dark lên thẻ HTML chính của Toàn giải
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const navItems = React.useMemo(() => {
    const allNavItems = [
      { id: 'dashboard', label: 'Trang chủ', icon: Trophy, permission: 'view_dashboard' },
      { id: 'teams', label: 'Quản lý đội', icon: Users, permission: 'manage_teams' },
      { id: 'groups', label: 'Chia bảng', icon: Layers, permission: 'manage_groups' },
      { id: 'scoreEntry', label: 'Nhập điểm', icon: Gamepad2, permission: 'enter_score' },
      { id: 'matches', label: 'Lịch & Kết quả', icon: CalendarDays, permission: 'manage_matches' },
      { id: 'standings', label: 'Tuyển chọn vòng trong', icon: FileSpreadsheet, permission: 'view_standings' },
      { id: 'knockout', label: 'Sơ đồ trực tiếp', icon: Network, permission: 'manage_knockout' },
      { id: 'live', label: 'Bảng trình chiếu TV', icon: Tv, permission: 'view_live' },
      { id: 'export', label: 'Xuất file', icon: FileDown, permission: 'export_data' },
      { id: 'logs', label: 'Nhật ký hệ thống', icon: ClipboardList, permission: 'view_logs' },
    ];
    
    // Always show live for guest if they don't have explicit permissions but userRole is guest. 
    // And actually, guest can see only 'live'.
    if (userRole === 'guest') {
      return allNavItems.filter(item => item.id === 'live');
    }

    return allNavItems.filter(item => useTournamentStore.getState().hasPermission(item.permission));
  }, [useTournamentStore.getState().permissions, userRole]);

  useEffect(() => {
    if (!navItems.find(item => item.id === selectedTab)) {
      if (navItems.length > 0) {
        setSelectedTab(navItems[0].id);
      }
    }
  }, [navItems, selectedTab, setSelectedTab]);

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans transition-colors duration-250">
      
      {/* Cấu trúc Grid 12 cột cho toàn màn hình: Cột Trái Sidebar tối, Cột Phải Content cực rộng */}
      <div className="flex flex-col lg:flex-row min-h-screen">
        
        {/* Sidebar kiểu mẫu Thể Thao Pro - Nền Navy tối Đậm [bg-[#0f172a] hoặc bg-[#111c30]] */}
        <aside className="w-full lg:w-64 bg-[#111c30] text-slate-200 flex flex-col shrink-0 border-r border-[#1e293b] print:hidden">
          {/* Logo & Brand Giải đấu */}
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

          {/* Menu Điều Hướng Chính */}
          <div className="flex-1 p-3 space-y-1 overflow-y-auto">
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-2.5 mb-2">
              Menu Vận Hành (Live)
            </p>
            <div className="space-y-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = selectedTab === item.id;
                
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      // Nếu bấm tab matches, reset active group trong store nếu chưa có
                      setSelectedTab(item.id);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold tracking-normal transition-all duration-150 text-left cursor-pointer group ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-md font-extrabold translate-x-1'
                        : 'text-slate-300 hover:bg-[#1e293b]/70 hover:text-white'
                    }`}
                    id={`nav-item-${item.id}`}
                  >
                    <Icon size={15} className={`transition-transform duration-150 group-hover:scale-110 ${isActive ? 'text-white stroke-[2.5]' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer Sidebar: Bản quyền & Giao diện sáng tối */}
          <div className="p-3.5 border-t border-[#1e293b] bg-[#0e1726]/80 flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                {supabaseConnected === null ? (
                  <>
                    <Zap size={10} className="text-zinc-400 fill-zinc-450 animate-spin" /> Kiểm tra kết nối...
                  </>
                ) : supabaseConnected ? (
                  <>
                    <Zap size={10} className="text-emerald-400 fill-emerald-400/20 animate-pulse" /> Trực tuyến Supabase
                  </>
                ) : (
                  <>
                    <Zap size={10} className="text-amber-500 fill-amber-505" /> Chế độ Ngoại tuyến
                  </>
                )}
              </span>
              <span className="text-[8px] text-slate-500 mt-0.5">Quốc Tế - 2026</span>
            </div>

            {/* Nút Đổi Sáng Tối */}
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded-xl bg-[#1e293b] hover:bg-slate-800 text-slate-350 hover:text-white transition-all cursor-pointer border border-slate-700/50"
              id="btn-toggle-darkmode"
              title="Đổi giao diện Sáng / Tối"
            >
              {darkMode ? <Sun size={13} className="text-amber-400 fill-amber-300/15" /> : <Moon size={13} />}
            </button>
          </div>
        </aside>

        {/* Nội dung Content chính bên phải */}
        <div className="flex-1 flex flex-col min-w-0">
          
          {/* Header Bar thông báo tên giải chuyên nghiệp */}
          <header className="sticky top-0 z-30 bg-white/95 dark:bg-zinc-900/90 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800/80 px-3 sm:px-5 py-2 sm:py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-start sm:justify-between gap-2 sm:gap-0 shadow-xs print:hidden">
            <div className="space-y-0.5">
              <p className="text-[8px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest leading-none">Cổng Điều Hành Trực Tuyến</p>
              <h2 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 max-w-full sm:max-w-2xl whitespace-normal break-words">
                {tournament.name || 'HỆ THỐNG QUẢN LÝ GIẢI ĐẤU PICKLEBALL'}
                <span className="text-[8px] bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400 font-bold px-1.5 py-0.5 rounded-full border border-red-200/60 dark:border-red-900/20">
                  STANDARD V2.6
                </span>
              </h2>
            </div>
            
            <div className="flex items-center gap-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              <span className="hidden sm:inline">BTC: <strong className="text-zinc-700 dark:text-zinc-300">{tournament.organization || 'Ban Tổ Chức'}</strong></span>
              <span className="h-3 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:inline"></span>
              <span className="bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-350 px-2 py-0.5 rounded-md font-bold text-[10px] border border-emerald-250">
                ● Trực Tiếp
              </span>
              <span className="h-3 w-px bg-zinc-200 dark:bg-zinc-800"></span>

              {isAdmin ? (
                <div className="flex items-center gap-2 text-xs">
                  {useTournamentStore.getState().hasPermission('*') && (
                    <span className="bg-indigo-50 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 px-2 py-0.5 rounded-md font-bold text-[10px] border border-indigo-200 flex items-center gap-1">
                      👑 Quyền cao nhất
                    </span>
                  )}
                  {useTournamentStore.getState().hasPermission('manage_tournaments') && !useTournamentStore.getState().hasPermission('*') && (
                    <span className="bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-350 px-2 py-0.5 rounded-md font-bold text-[10px] border border-emerald-250 flex items-center gap-1">
                      👤 BTC: @{currentUser}
                    </span>
                  )}
                  {useTournamentStore.getState().hasPermission('*') && (
                    <div className={`flex items-center gap-1.5 bg-slate-100 dark:bg-zinc-800 px-2.5 py-0.5 rounded-md text-[10px] border border-[#e2e8f0] dark:border-zinc-700 transition-all ${isDbChanging ? 'opacity-60 animate-pulse' : ''}`}>
                      <span className="text-zinc-500 font-bold uppercase tracking-wider text-[9px] flex items-center gap-1">
                        {isDbChanging && <RefreshCw size={10} className="animate-spin text-indigo-500 shrink-0" />}
                        Tạo tài khoản / Tenant ở Enterprise Dashboard.
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => useTournamentStore.getState().logout()}
                    className="cursor-pointer text-[10px] font-bold bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-red-650 dark:text-red-400 border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 rounded transition-colors"
                  >
                    Đăng xuất
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleAdminAuth}
                  className="cursor-pointer text-[10px] font-bold bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded border border-blue-700 shadow-xs flex items-center gap-1 transition-all"
                >
                  🔒 Đăng nhập Admin
                </button>
              )}
            </div>
          </header>

          {/* Outer Wrapper cho màn hình chính - Mở rộng toàn bộ chiều rộng (Full Width) */}
          <main className="flex-1 p-4 lg:p-6 w-full print:p-0 print:w-full" id="main-content-panel">
            {selectedTab !== 'live' && selectedTab !== 'logs' && selectedTab !== 'export' && selectedTab !== 'scoreEntry' && <EventBar />}
            
            <div className="animate-fade-in">
              {selectedTab === 'dashboard' && <Dashboard />}
              {selectedTab === 'teams' && <TeamManager />}
              {selectedTab === 'groups' && <GroupManager />}
              {selectedTab === 'scoreEntry' && <ScoreEntry />}
              {selectedTab === 'matches' && <SchedulerAndScoreKeeper />}
              {selectedTab === 'standings' && <Standings />}
              {selectedTab === 'knockout' && <KnockoutBracket />}
              {selectedTab === 'live' && <LiveDashboard />}
              {selectedTab === 'export' && <ExportManager />}
              {selectedTab === 'logs' && <AuditLogger />}
            </div>
          </main>

          {/* Footer chân bàn ăn mờ */}
          <footer className="py-3 border-t border-zinc-200/30 dark:border-zinc-900 text-center text-[11px] text-zinc-400 dark:text-zinc-550 font-bold tracking-wider uppercase select-none print:hidden">
            BẢN QUYỀN THUỘC VỀ NGUYỄN VĂN HỮU_NGÂN SƠN
          </footer>
        </div>

      </div>

      {/* Đăng nhập Admin Overlay */}
      <AuthModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} />
    </div>
  );
}
