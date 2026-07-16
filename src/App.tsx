import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useParams, useNavigate, useLocation, Navigate } from 'react-router-dom';
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
import DeletedItemsManager from './components/DeletedItemsManager';
import CommercialUnlockPage from './components/CommercialUnlockPage';
import CommercialSubscriptionPage from './components/CommercialSubscriptionPage';
import PaymentReviewManager from './components/PaymentReviewManager';
import EventSwitcher from './components/event-switcher';
import { useEventsQuery } from './components/use-events-query';
import { getAuthHashErrorMessage, isSupabaseAuthCallbackHash } from './lib/authRedirect';
import { resolveWorkspaceAccess } from './lib/auth/workspaceAccessService';
import { ensureMySelfServiceWorkspace, getCommercialAccessState } from './lib/api/commercial';

import {
  Trophy,
  Users,
  Layers,
  CalendarDays,
  FileSpreadsheet,
  Network,
  ClipboardList,
  Sun,
  Moon,
  Zap,
  Gamepad2,
  FileDown,
  ShieldAlert,
  UserCog,
  Building2,
  UserCircle,
  Settings,
  Presentation,
  Wrench,
  ListChecks,
  Trash2,
  KeyRound,
  CreditCard,
} from 'lucide-react';

function isRouteWorkspacePathname() {
  const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const appPath = window.location.pathname.startsWith(basePath)
    ? window.location.pathname.slice(basePath.length)
    : window.location.pathname;
  return appPath.startsWith('/admin/workspace/') || appPath.startsWith('/admin/workspaces') || appPath.startsWith('/tournament/');
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const TAB_GROUP_ALIASES: Record<string, string> = {
  teams: 'content',
  groups: 'content',
  events_center: 'content',
  matches: 'operations',
  scoreEntry: 'operations',
  standings: 'rankings',
  knockout: 'rankings',
  tenants: 'admin',
  accounts: 'admin',
  logs: 'admin',
  export: 'admin',
  deleted: 'admin',
  payments: 'admin',
};

const panelShellClass = 'rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900';

function WorkspaceTabs({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; icon: React.ElementType; disabled?: boolean }>;
  activeTab: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-950">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={`flex min-h-9 items-center gap-2 rounded-lg px-3 py-2 text-xs font-black transition-all ${
              active
                ? 'bg-white text-blue-700 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-blue-300 dark:ring-zinc-800'
                : 'text-zinc-600 hover:bg-white/80 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'
            } ${tab.disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'}`}
          >
            <Icon size={15} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title?: string; description?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">{eyebrow}</p>
      {title && <h1 className="text-xl font-black tracking-tight text-zinc-950 dark:text-zinc-50">{title}</h1>}
      {description && <p className="max-w-3xl text-sm font-medium text-zinc-500 dark:text-zinc-400">{description}</p>}
    </div>
  );
}

function ContentWorkspace() {
  const selectedTab = useTournamentStore((state) => state.selectedTab);
  const [activeSubTab, setActiveSubTab] = React.useState(() =>
    ['events_center', 'teams', 'groups', 'matches'].includes(selectedTab) ? selectedTab : 'events_center'
  );

  useEffect(() => {
    if (['events_center', 'teams', 'groups', 'matches'].includes(selectedTab)) {
      setActiveSubTab(selectedTab);
    }
  }, [selectedTab]);

  return (
    <div className="space-y-4">
      <div className={panelShellClass}>
        <div className="space-y-4 p-4">
          <SectionHeader
            eyebrow="Thiết lập nội dung"
          />
          <WorkspaceTabs
            activeTab={activeSubTab}
            onChange={setActiveSubTab}
            tabs={[
              { id: 'events_center', label: 'Cấu hình nội dung', icon: Settings },
              { id: 'teams', label: 'Đội thi đấu', icon: Users },
              { id: 'groups', label: 'Chia bảng', icon: Layers },
              { id: 'matches', label: 'Lịch vòng bảng', icon: CalendarDays },
            ]}
          />
          {activeSubTab !== 'events_center' && <EventBar />}
        </div>
      </div>
      {activeSubTab === 'events_center' && <EventManagementPage />}
      {activeSubTab === 'teams' && <TeamManager />}
      {activeSubTab === 'groups' && <GroupManager />}
      {activeSubTab === 'matches' && <SchedulerAndScoreKeeper />}
    </div>
  );
}

function OperationsWorkspace() {
  const selectedTab = useTournamentStore((state) => state.selectedTab);
  const [activeSubTab, setActiveSubTab] = React.useState(() =>
    ['scoreEntry', 'matches'].includes(selectedTab) ? selectedTab : 'scoreEntry'
  );

  useEffect(() => {
    if (['scoreEntry', 'matches'].includes(selectedTab)) {
      setActiveSubTab(selectedTab);
    }
  }, [selectedTab]);

  return (
    <div className="space-y-4">
      <div className={panelShellClass}>
        <div className="space-y-3 p-3">
          <SectionHeader
            eyebrow="Vận hành thi đấu"
            title=""
          />
          <WorkspaceTabs
            activeTab={activeSubTab}
            onChange={setActiveSubTab}
            tabs={[
              { id: 'scoreEntry', label: 'Panel nhập điểm', icon: Gamepad2 },
              { id: 'matches', label: 'Lịch & kết quả', icon: CalendarDays },
            ]}
          />
        </div>
      </div>
      {activeSubTab === 'scoreEntry' && <ScoreEntry />}
      {activeSubTab === 'matches' && <SchedulerAndScoreKeeper />}
    </div>
  );
}

function RankingKnockoutWorkspace() {
  const selectedTab = useTournamentStore((state) => state.selectedTab);
  const [activeSubTab, setActiveSubTab] = React.useState(() =>
    ['standings', 'knockout'].includes(selectedTab) ? selectedTab : 'standings'
  );

  useEffect(() => {
    if (['standings', 'knockout'].includes(selectedTab)) {
      setActiveSubTab(selectedTab);
    }
  }, [selectedTab]);

  return (
    <div className="space-y-4">
      <div className={panelShellClass}>
        <div className="space-y-4 p-4">
          <SectionHeader
            eyebrow="Vào vòng trong"
            title="Xếp hạng & Knockout"
            description="Xem thứ hạng vòng bảng, cấu hình slot và quản lý sơ đồ knockout của nội dung đang chọn."
          />
          <WorkspaceTabs
            activeTab={activeSubTab}
            onChange={setActiveSubTab}
            tabs={[
              { id: 'standings', label: 'Xếp hạng bảng', icon: FileSpreadsheet },
              { id: 'knockout', label: 'Sơ đồ KO', icon: Network },
            ]}
          />
          <EventBar />
        </div>
      </div>
      {activeSubTab === 'standings' && <Standings />}
      {activeSubTab === 'knockout' && <KnockoutBracket />}
    </div>
  );
}

function AdminWorkspacePanel() {
  const selectedTab = useTournamentStore((state) => state.selectedTab);
  const hasPermission = useTournamentStore((state) => state.hasPermission);
  const userRole = useTournamentStore((state) => state.userRole);
  const canManageTenants = userRole === 'SUPER_ADMIN' && (hasPermission('*') || hasPermission('manage_tenants'));
  const canManageTournaments = hasPermission('*') || hasPermission('manage_tournaments');
  const canManageAccounts = hasPermission('*') || hasPermission('manage_accounts') || hasPermission('manage_referees');
  const canManageDeleted = canManageTournaments || hasPermission('*') || hasPermission('manage_events');
  const canViewLogs = hasPermission('*') || hasPermission('view_audit_logs');
  const canReviewPayments = userRole === 'SUPER_ADMIN';
  const adminTabs = [
    { id: 'tenants', label: 'Đơn vị', icon: Building2, disabled: !canManageTenants },
    { id: 'workspaces', label: 'Giải đấu', icon: Layers, disabled: !canManageTournaments },
    { id: 'accounts', label: 'Tài khoản', icon: UserCog, disabled: !canManageAccounts },
    { id: 'payments', label: 'Thanh toán', icon: CreditCard, disabled: !canReviewPayments },
    { id: 'deleted', label: 'Đã xóa', icon: Trash2, disabled: !canManageDeleted },
    { id: 'logs', label: 'Nhật ký', icon: ClipboardList, disabled: !canViewLogs },
    { id: 'export', label: 'Xuất file', icon: FileDown, disabled: false },
  ];
  const firstAllowed = adminTabs.find((tab) => !tab.disabled)?.id || 'workspaces';
  const [activeSubTab, setActiveSubTab] = React.useState(() =>
    adminTabs.some((tab) => tab.id === selectedTab && !tab.disabled) ? selectedTab : firstAllowed
  );

  useEffect(() => {
    if (adminTabs.some((tab) => tab.id === selectedTab && !tab.disabled)) {
      setActiveSubTab(selectedTab);
    }
  }, [selectedTab, adminTabs]);

  return (
    <div className="space-y-4">
      <div className={panelShellClass}>
        <div className="space-y-4 p-4">
          <SectionHeader
            eyebrow="Thiết lập hệ thống"
            title="Quản trị"
            description="Quản lý đơn vị, giải đấu, tài khoản, phân quyền và nhật ký hệ thống."
          />
          <WorkspaceTabs tabs={adminTabs} activeTab={activeSubTab} onChange={setActiveSubTab} />
        </div>
      </div>
      {activeSubTab === 'tenants' && <TenantManagementPage />}
      {activeSubTab === 'workspaces' && <TournamentWorkspaceListPage />}
      {activeSubTab === 'accounts' && <AccountManager />}
      {activeSubTab === 'payments' && <PaymentReviewManager />}
      {activeSubTab === 'deleted' && <DeletedItemsManager />}
      {activeSubTab === 'logs' && <AuditLogger />}
      {activeSubTab === 'export' && <ExportManager />}
    </div>
  );
}

// Wrapper for Admin Workspace
function AdminWorkspace() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const setWorkspaceContext = useTournamentStore((state) => state.setWorkspaceContext);
  const activeTenantId = useTournamentStore(state => state.activeTenantId);
  const activeTournamentId = useTournamentStore(state => state.activeTournamentId);
  const userRole = useTournamentStore(state => state.userRole);
  const setSelectedTab = useTournamentStore(state => state.setSelectedTab);
  const currentEnterpriseUser = useTournamentStore(state => state.currentEnterpriseUser);
  const setAuthAccessState = useTournamentStore(state => state.setAuthAccessState);
  const clearWorkspaceContext = useTournamentStore(state => state.clearWorkspaceContext);

  useEffect(() => {
    let isCancelled = false;
    const loadWorkspace = async () => {
      if (!slug) return;
      if (currentEnterpriseUser?.tenant_type === 'self_service_customer'
          && currentEnterpriseUser?.business_access_active === false) {
        setSelectedTab('unlock');
        navigate('/unlock', { replace: true });
        return;
      }
      const routeSlug = decodeURIComponent(slug);
      setAuthAccessState('ACCESS_LOADING');

      const access = await resolveWorkspaceAccess({
        routeSlug,
        role: userRole,
        tenantId: currentEnterpriseUser?.tenant_id || activeTenantId,
      });

      if (isCancelled) return;

      if (!access.allowed || !access.pendingContext) {
        setAuthAccessState(access.reason === 'guest' ? 'UNAUTHENTICATED' : 'WORKSPACE_SELECT_REQUIRED');
        clearWorkspaceContext();
        setSelectedTab('workspaces');
        navigate('/admin/workspaces', { replace: true });
        return;
      }

      setAuthAccessState('WORKSPACE_ACCESS_CONFIRMED');
      const context = access.pendingContext;

      if (activeTenantId !== context.tenantId || activeTournamentId !== context.tournamentId) {
        setAuthAccessState('WORKSPACE_CONTEXT_LOADING');
        await setWorkspaceContext({
          tenantId: context.tenantId,
          tenantName: context.tenantName,
          tournamentId: context.tournamentId,
          tournamentName: context.tournamentName,
          tournamentSlug: context.tournamentSlug,
        });
      } else {
        setAuthAccessState('WORKSPACE_CONTEXT_READY');
      }

      const currentTab = useTournamentStore.getState().selectedTab;
      if (['workspaces', 'unlock', 'subscription'].includes(currentTab)) {
        setSelectedTab(
          currentEnterpriseUser?.tenant_type === 'self_service_customer'
            ? 'content'
            : 'dashboard',
        );
      }
    };

    loadWorkspace();
    return () => {
      isCancelled = true;
    };
  }, [slug, activeTenantId, activeTournamentId, userRole, currentEnterpriseUser?.tenant_id, currentEnterpriseUser?.tenant_type, currentEnterpriseUser?.business_access_active, setWorkspaceContext, setSelectedTab, setAuthAccessState, clearWorkspaceContext, navigate]);

  return <TournamentShell />;
}

function WorkspaceDirectory() {
  const navigate = useNavigate();
  const setSelectedTab = useTournamentStore((state) => state.setSelectedTab);
  const setWorkspaceContext = useTournamentStore((state) => state.setWorkspaceContext);
  const currentEnterpriseUser = useTournamentStore((state) => state.currentEnterpriseUser);

  useEffect(() => {
    let cancelled = false;
    setSelectedTab('workspaces');
    if (!currentEnterpriseUser?.tenant_id) return;

    void setWorkspaceContext({
      tenantId: currentEnterpriseUser.tenant_id,
      tenantName: currentEnterpriseUser.tenant?.name || null,
      tournamentId: null,
    });

    if (currentEnterpriseUser.tenant_type === 'self_service_customer'
        && currentEnterpriseUser.business_access_active !== false) {
      void ensureMySelfServiceWorkspace()
        .then((result) => {
          if (!cancelled) {
            navigate(`/admin/workspace/${encodeURIComponent(result.workspace.slug)}`, { replace: true });
          }
        })
        .catch((error) => {
          console.error('Không thể mở giải self-service đã được cấp.', error);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [
    currentEnterpriseUser?.tenant_id,
    currentEnterpriseUser?.tenant?.name,
    currentEnterpriseUser?.tenant_type,
    currentEnterpriseUser?.business_access_active,
    navigate,
    setSelectedTab,
    setWorkspaceContext,
  ]);

  return <TournamentShell />;
}

function CommercialUnlockEntry() {
  const setSelectedTab = useTournamentStore((state) => state.setSelectedTab);
  React.useEffect(() => setSelectedTab('unlock'), [setSelectedTab]);
  return <TournamentShell />;
}

function CommercialSubscriptionEntry() {
  const setSelectedTab = useTournamentStore((state) => state.setSelectedTab);
  React.useEffect(() => setSelectedTab('subscription'), [setSelectedTab]);
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
  const currentEnterpriseUser = useTournamentStore(state => state.currentEnterpriseUser);
  const navigate = useNavigate();
  const [authInitialized, setAuthInitialized] = React.useState(false);
  
  useEffect(() => {
      const legacyHash = window.location.hash.replace(/^#\/?/, '').trim();
      if (legacyHash && !isSupabaseAuthCallbackHash()) {
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

      let cancelled = false;
      initSupabase().finally(() => {
        if (!cancelled) setAuthInitialized(true);
      });
      return () => {
        cancelled = true;
      };
  }, [initSupabase, navigate]);

  useEffect(() => {
    if (!authInitialized || !currentEnterpriseUser) return;
    let cancelled = false;

    const routeAuthenticatedUser = async () => {
      if (currentEnterpriseUser.tenant_type !== 'self_service_customer') {
        navigate('/admin/workspaces', { replace: true });
        return;
      }
      if (currentEnterpriseUser.business_access_active === false) {
        navigate('/unlock', { replace: true });
        return;
      }

      try {
        const result = await ensureMySelfServiceWorkspace();
        if (!cancelled) {
          navigate(`/admin/workspace/${encodeURIComponent(result.workspace.slug)}`, { replace: true });
        }
      } catch (error) {
        console.error('Không thể chuẩn bị giải self-service sau đăng nhập.', error);
        if (!cancelled) navigate('/admin/workspaces', { replace: true });
      }
    };

    void routeAuthenticatedUser();
    return () => {
      cancelled = true;
    };
  }, [
    authInitialized,
    currentEnterpriseUser?.id,
    currentEnterpriseUser?.tenant_type,
    currentEnterpriseUser?.business_access_active,
    navigate,
  ]);

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
        <Route path="/admin/workspaces" element={<WorkspaceDirectory />} />
        <Route path="/admin/workspace/:slug" element={<AdminWorkspace />} />
        <Route path="/unlock" element={<CommercialUnlockEntry />} />
        <Route path="/subscription" element={<CommercialSubscriptionEntry />} />
        <Route path="/tournament/:slug" element={<PublicTournament />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function TournamentShell() {
  const navigate = useNavigate();
  const location = useLocation();
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
  const authAccessState = useTournamentStore((state) => state.authAccessState);
  const setCommercialAccessState = useTournamentStore((state) => state.setCommercialAccessState);
  const { data: headerEvents = [] } = useEventsQuery();
  const currentHeaderEvent = headerEvents.find((event: any) => event.id === currentEventId) || headerEvents[0];
  const isAuthenticated = !!currentEnterpriseUser || userRole !== 'guest' || !!currentUser;
  const commercialLocked = currentEnterpriseUser?.tenant_type === 'self_service_customer'
    && currentEnterpriseUser?.business_access_active === false;
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

  const openOperationalTab = async (tabId: string) => {
    const isWorkspaceDetailRoute = /\/admin\/workspace\/[^/]+/.test(location.pathname);
    if (currentEnterpriseUser?.tenant_type !== 'self_service_customer' || isWorkspaceDetailRoute) {
      setSelectedTab(tabId);
      return;
    }

    try {
      const result = await ensureMySelfServiceWorkspace();
      setSelectedTab(tabId);
      navigate(`/admin/workspace/${encodeURIComponent(result.workspace.slug)}`);
    } catch (error) {
      console.error('Không thể quay lại giải self-service đã được cấp.', error);
    }
  };

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    if (!commercialLocked || location.pathname === '/unlock') return;
    setSelectedTab('unlock');
    navigate('/unlock', { replace: true });
  }, [commercialLocked, location.pathname, navigate, setSelectedTab]);

  useEffect(() => {
    if (currentEnterpriseUser?.tenant_type !== 'self_service_customer' || commercialLocked) return;
    let cancelled = false;
    const checkAccess = async () => {
      try {
        const state = await getCommercialAccessState();
        if (!cancelled) {
          setCommercialAccessState(
            state.business_access_active,
            state.account?.onboarding_status,
            state.tenant,
          );
          if (!state.business_access_active) {
            navigate('/unlock', { replace: true });
          }
        }
      } catch {
        // Keep the current screen during transient network failures; backend still enforces every mutation.
      }
    };
    const timer = window.setInterval(() => void checkAccess(), 60000);
    const onFocus = () => void checkAccess();
    window.addEventListener('focus', onFocus);
    void checkAccess();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [commercialLocked, currentEnterpriseUser?.tenant_type, navigate, setCommercialAccessState]);

  const navItems = React.useMemo(() => {
    if (commercialLocked) {
      return [{ id: 'unlock', label: 'Mở khóa', icon: KeyRound, permission: '', roles: ['EVENT_ADMIN'] }];
    }
    const allNavItems = [
      { id: 'workspaces', label: 'Giải đấu', icon: Layers, permission: 'view_public', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE', 'VIEWER'] },
      { id: 'dashboard', label: 'Tổng quan', icon: Trophy, permission: 'view_public', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'] },
      { id: 'content', label: 'Nội dung thi đấu', icon: ListChecks, permission: 'manage_event_config', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'] },
      { id: 'operations', label: 'Điều hành trận đấu', icon: Gamepad2, permission: 'enter_scores', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE'] },
      { id: 'rankings', label: 'Xếp hạng & KO', icon: Network, permission: 'manage_standings', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE'] },
      { id: 'live', label: 'Trình chiếu', icon: Presentation, permission: 'view_event', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN', 'REFEREE', 'guest'] },
      { id: 'admin', label: 'Quản trị', icon: Wrench, permission: 'manage_accounts', roles: ['SUPER_ADMIN', 'TENANT_ADMIN', 'EVENT_ADMIN'] },
    ];
    if (currentEnterpriseUser?.tenant_type === 'self_service_customer') {
      const workspaceIndex = allNavItems.findIndex((item) => item.id === 'workspaces');
      if (workspaceIndex >= 0) allNavItems.splice(workspaceIndex, 1);
      allNavItems.splice(1, 0, { id: 'subscription', label: 'Gói dịch vụ', icon: CreditCard, permission: 'view_public', roles: ['EVENT_ADMIN'] });
    }
    
    if (userRole === 'guest') {
      return allNavItems.filter(item => item.id === 'live');
    }

    return allNavItems.filter(item => {
      if (!item.roles.includes(userRole)) return false;
      if (hasPermission('*')) return true;
      return hasPermission(item.permission) || (item.id === 'admin' && hasPermission('manage_referees')) || hasPermission('*');
    });
  }, [permissions, userRole, hasPermission, commercialLocked, currentEnterpriseUser?.tenant_type]);

  const currentPrimaryTab = TAB_GROUP_ALIASES[selectedTab] || selectedTab;
  const isWorkspaceContextReady =
    currentPrimaryTab === 'workspaces' ||
    currentPrimaryTab === 'unlock' ||
    currentPrimaryTab === 'subscription' ||
    userRole === 'guest' ||
    authAccessState === 'WORKSPACE_CONTEXT_READY';

  useEffect(() => {
    if (!navItems.find(item => item.id === currentPrimaryTab)) {
      if (navItems.length > 0) {
        setSelectedTab(navItems[0].id);
      }
    }
  }, [navItems, currentPrimaryTab, setSelectedTab]);

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
                const isActive = currentPrimaryTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.id === 'workspaces') {
                        navigate('/admin/workspaces');
                        return;
                      }
                      if (item.id === 'unlock') {
                        navigate('/unlock');
                        return;
                      }
                      if (item.id === 'subscription') {
                        navigate('/subscription');
                        return;
                      }
                      void openOperationalTab(item.id);
                    }}
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
          <header className="sticky top-0 z-30 bg-white/95 dark:bg-zinc-900/90 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800/80 px-3 sm:px-5 py-1 sm:py-1.5 flex flex-col sm:flex-row items-start sm:items-center justify-start sm:justify-between gap-1.5 sm:gap-0 shadow-xs print:hidden">
            <div className="space-y-0.5">
              <p className="text-[8px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest leading-none">Cổng Điều Hành Trực Tuyến</p>
              <h2 className="text-[13px] font-extrabold text-zinc-900 dark:text-zinc-100 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 max-w-full sm:max-w-2xl whitespace-normal break-words leading-tight">
                {tournament.name || 'HỆ THỐNG QUẢN LÝ GIẢI ĐẤU PICKLEBALL'}
              </h2>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-bold text-zinc-500 dark:text-zinc-400 leading-tight">
                <span>Đơn vị: {activeTenantName || currentEnterpriseUser?.tenant?.name || activeTenantId || 'Chưa chọn'}</span>
                <span>Giải: {tournament.name || 'Chưa chọn'}</span>
                <span>Nội dung thi đấu: {currentHeaderEvent?.name || 'Chưa chọn'}</span>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center justify-end gap-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
               {isAuthenticated ? (
                <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                  <div className="flex max-w-[260px] items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-left shadow-xs dark:border-zinc-800 dark:bg-zinc-950/70">
                    <UserCircle size={18} className="shrink-0 text-blue-600 dark:text-blue-400" />
                    <div className="min-w-0 leading-tight">
                      <p className="truncate text-[11px] font-black text-zinc-900 dark:text-zinc-100">{profileName}</p>
                      <p className="truncate text-[10px] font-bold text-zinc-500 dark:text-zinc-400">{profileRole}</p>
                      <p className="truncate text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">Giải: {profileTournamentName}</p>
                    </div>
                  </div>
                  {!commercialLocked && <EventSwitcher />}
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
            <div className="animate-fade-in">
              {(() => {
                const isTabAllowed = navItems.some(item => item.id === currentPrimaryTab);
                if (!isTabAllowed) {
                  return (
                    <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-zinc-900 rounded-xl border border-red-100 dark:border-red-900/30">
                      <ShieldAlert className="w-12 h-12 text-red-500 mb-4" />
                      <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Truy Cập Bị Từ Chối</h3>
                    </div>
                  );
                }

                if (!isWorkspaceContextReady) {
                  return (
                    <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
                      <Zap className="w-10 h-10 text-blue-500 mb-4 animate-pulse" />
                      <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Đang kiểm tra quyền truy cập giải đấu</h3>
                      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Hệ thống sẽ chỉ mở nghiệp vụ sau khi workspace được xác nhận.</p>
                    </div>
                  );
                }

                return (
                  <>
                    {currentPrimaryTab === 'dashboard' && <Dashboard />}
                    {currentPrimaryTab === 'workspaces' && <TournamentWorkspaceListPage />}
                    {currentPrimaryTab === 'content' && <ContentWorkspace />}
                    {currentPrimaryTab === 'operations' && <OperationsWorkspace />}
                    {currentPrimaryTab === 'rankings' && <RankingKnockoutWorkspace />}
                    {currentPrimaryTab === 'live' && <LiveDashboard />}
                    {currentPrimaryTab === 'admin' && <AdminWorkspacePanel />}
                    {currentPrimaryTab === 'unlock' && <CommercialUnlockPage />}
                    {currentPrimaryTab === 'subscription' && <CommercialSubscriptionPage />}
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
