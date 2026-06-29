import React, { useState, useEffect } from 'react';
import { useTournamentStore } from '../store';
import { supabase } from '../supabaseClient';
import { Users, Plus, Search, ShieldAlert, X, Shield, Building2, CheckCircle2, Edit, Trash2, KeyRound, SlidersHorizontal } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import SecurityAccountPanel from './SecurityAccountPanel';
import { createAdminAccount, deleteAdminAccount, updateAdminAccount } from '../lib/api/adminAccounts';
import { normalizeRpcError, tournamentRpc } from '../lib/api/tournamentRpc';

const EVENT_PERMISSION_OPTIONS = [
  { id: 'view_event', label: 'Xem nội dung' },
  { id: 'manage_event_config', label: 'Cấu hình nội dung' },
  { id: 'manage_teams', label: 'Quản lý đội' },
  { id: 'manage_groups', label: 'Chia bảng' },
  { id: 'manage_schedule', label: 'Tạo lịch' },
  { id: 'enter_scores', label: 'Nhập điểm' },
  { id: 'manage_standings', label: 'Xếp hạng' },
  { id: 'manage_knockout', label: 'Sơ đồ KO' },
  { id: 'manage_referees', label: 'Quản lý trọng tài' },
  { id: 'manage_events', label: 'Toàn quyền nội dung' },
];

const REFEREE_PERMISSION_IDS = new Set(['view_event', 'enter_scores']);

export default function AccountManager() {
  const userRole = useTournamentStore((state) => state.userRole);
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  
  const [accounts, setAccounts] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [accountScopes, setAccountScopes] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<{ id: string, username: string } | null>(null);
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('EVENT_ADMIN');
  const [newTenantId, setNewTenantId] = useState(activeTenantId !== 'default' ? activeTenantId : '');
  const [actionLoading, setActionLoading] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<any>(null);
  const [permissionTree, setPermissionTree] = useState<any[]>([]);
  const [permissionTreeTenantId, setPermissionTreeTenantId] = useState<string | null>(null);
  const [permissionAccount, setPermissionAccount] = useState<any>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<Record<string, Set<string>>>({});
  const [scopeLoading, setScopeLoading] = useState(false);

  const [editDisplayName, setEditDisplayName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editTenantId, setEditTenantId] = useState('');
  const [editStatus, setEditStatus] = useState('active');

  const openEditModal = (acc: any) => {
    setEditingAccount(acc);
    setEditDisplayName(acc.display_name || '');
    setEditPassword('');
    const currentRole = acc.roles?.name || acc.role_id || 'VIEWER';
    setEditRole(isEventAdmin ? 'REFEREE' : currentRole);
    setEditTenantId(acc.tenant_id || '');
    setEditStatus(acc.status || 'active');
    setIsEditModalOpen(true);
    setErrorMsg('');
    setSuccessMsg('');
  };

  const handleEditAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!editDisplayName.trim()) {
      setErrorMsg('Vui lòng điền họ tên.');
      return;
    }

    setActionLoading(true);

    try {
      await updateAdminAccount(editingAccount.id, {
        displayName: editDisplayName.trim(),
        password: editPassword.trim(),
        role: isEventAdmin ? 'REFEREE' : editRole,
        tenantId: isSuperAdmin ? editTenantId : activeTenantId,
        status: editStatus,
        userId: editingAccount.user_id
      });

      setSuccessMsg('Cập nhật tài khoản thành công!');
      setIsEditModalOpen(false);
      fetchAccounts();

    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Không thể cập nhật tài khoản lúc này. Vui lòng liên hệ hỗ trợ.');
    } finally {
      setActionLoading(false);
    }
  };
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const isSuperAdmin = userRole === 'SUPER_ADMIN';
  const isEventAdmin = userRole === 'EVENT_ADMIN';
  const canCreateAccounts = isSuperAdmin || userRole === 'TENANT_ADMIN' || isEventAdmin;

  useEffect(() => {
    fetchAccounts();
    fetchTenants();
    if (isEventAdmin) setNewRole('REFEREE');
  }, [userRole, activeTenantId, isSuperAdmin, isEventAdmin]);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const tenantParam = isSuperAdmin ? null : activeTenantId;
      const scoped = await supabase.rpc('list_account_access_summary_v1', {
        p_tenant_id: tenantParam,
      });

      if (!scoped.error && Array.isArray(scoped.data)) {
        const nextScopes: Record<string, any> = {};
        const scopedAccounts = scoped.data.map((row: any) => {
          nextScopes[row.account_id] = row;
          return {
            id: row.account_id,
            user_id: row.user_id,
            tenant_id: row.tenant_id,
            username: row.username,
            display_name: row.display_name,
            status: row.status,
            created_at: row.created_at,
            created_by_account_id: row.created_by_account_id,
            roles: { name: row.role_name },
          };
        });
        setAccounts(scopedAccounts);
        setAccountScopes(nextScopes);
        return;
      }

      if (isEventAdmin) {
        throw scoped.error || new Error('Không tải được phạm vi tài khoản.');
      }

      let query = supabase.from('accounts').select(`
        id, user_id, tenant_id, username, display_name, status, created_at,
        roles!inner(name)
      `);
      
      if (!isSuperAdmin) {
        // TENANT_ADMIN only sees their tenant
        query = query.eq('tenant_id', activeTenantId);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      
      if (data) {
        setAccounts(data);
        fetchAccountScopes(data);
      } else {
         // Fallback if roles relation is strict/unavailable
         const { data: fallbackData, error: fallbackError } = await supabase.from('accounts').select('id, user_id, tenant_id, username, display_name, status, created_at, role_id');
         if (fallbackError) throw fallbackError;
         if (fallbackData) {
           setAccounts(fallbackData);
           fetchAccountScopes(fallbackData);
         }
      }
    } catch {
      console.warn('Không thể tải danh sách tài khoản.');
      // Wait to see if we really want to show error to user or just let it be empty
    } finally {
      setLoading(false);
    }
  };

  const fetchPermissionTree = async (tenantIdOverride?: string | null) => {
    setScopeLoading(true);
    try {
      const scopedTenantId = tenantIdOverride || (isSuperAdmin ? null : activeTenantId);
      const { data, error } = await supabase.rpc('list_permission_tree_v1', {
        p_tenant_id: scopedTenantId,
      });
      if (error) throw error;
      setPermissionTree(Array.isArray(data) ? data : []);
      setPermissionTreeTenantId(scopedTenantId || null);
    } catch (error) {
      setErrorMsg(normalizeRpcError(error).message);
      setPermissionTree([]);
      setPermissionTreeTenantId(null);
    } finally {
      setScopeLoading(false);
    }
  };

  const fetchAccountScopes = async (accountRows: any[]) => {
    try {
      const tenantParam = isSuperAdmin ? null : activeTenantId;
      const { data, error } = await supabase.rpc('list_account_access_summary_v1', {
        p_tenant_id: tenantParam,
      });

      if (!error && Array.isArray(data)) {
        const next: Record<string, any> = {};
        data.forEach((row: any) => {
          next[row.account_id] = row;
        });
        setAccountScopes(next);
        return;
      }
    } catch {
      // Local fallback below keeps the page useful when the migration is not applied yet.
    }

    try {
      const accountIds = accountRows.map((account) => account.id).filter(Boolean);
      if (accountIds.length === 0) {
        setAccountScopes({});
        return;
      }

      const { data: grants } = await supabase
        .from('account_event_permissions')
        .select('account_id, event_id, permission')
        .in('account_id', accountIds)
        .is('deleted_at', null);

      const eventIds = Array.from(new Set((grants || []).map((grant: any) => grant.event_id).filter(Boolean)));
      const { data: events } = eventIds.length > 0
        ? await supabase.from('events').select('id, name, tournament_id').in('id', eventIds).is('deleted_at', null)
        : { data: [] as any[] };

      const tournamentIds = Array.from(new Set((events || []).map((event: any) => event.tournament_id).filter(Boolean)));
      const { data: tournaments } = tournamentIds.length > 0
        ? await supabase.from('tournament').select('id, name, slug').in('id', tournamentIds).is('deleted_at', null)
        : { data: [] as any[] };

      const eventById = new Map((events || []).map((event: any) => [event.id, event]));
      const tournamentById = new Map((tournaments || []).map((tour: any) => [tour.id, tour]));
      const next: Record<string, any> = {};

      accountRows.forEach((account) => {
        next[account.id] = {
          account_id: account.id,
          event_grants: (grants || [])
            .filter((grant: any) => grant.account_id === account.id)
            .map((grant: any) => {
              const event = eventById.get(grant.event_id) as any;
              const tour = event ? tournamentById.get(event.tournament_id) as any : null;
              return {
                event_id: grant.event_id,
                event_name: event?.name || grant.event_id,
                tournament_id: event?.tournament_id || null,
                tournament_name: tour?.name || 'Giải chưa rõ',
                tournament_slug: tour?.slug || null,
                permission: grant.permission || 'enter_scores',
              };
            }),
        };
      });

      setAccountScopes(next);
    } catch {
      setAccountScopes({});
    }
  };

  const fetchTenants = async () => {
    try {
      const { data, error } = await supabase.from('tenants').select('id, name');
      if (error) throw error;
      if (data) setTenants(data);
    } catch {
      console.warn('Không thể tải danh sách đơn vị.');
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!newUsername.trim() || !newPassword.trim() || !newDisplayName.trim()) {
      setErrorMsg('Vui lòng điền đủ tên đăng nhập, họ tên và mật khẩu.');
      return;
    }

    setActionLoading(true);

    try {
      const rawUsername = newUsername.trim().toLowerCase();
      const email = rawUsername.includes('@') ? rawUsername : `${rawUsername}@pic.com`;
      const username = rawUsername.includes('@') ? rawUsername.split('@')[0] : rawUsername;
      const tenantId = isSuperAdmin ? newTenantId : activeTenantId;

      if (!tenantId || tenantId === 'default') {
        throw new Error('Vui lòng chọn đơn vị tenant hợp lệ trước khi tạo tài khoản.');
      }

      await createAdminAccount({
        email,
        username,
        password: newPassword,
        displayName: newDisplayName.trim(),
        role: isEventAdmin ? 'REFEREE' : newRole,
        tenantId,
      });

      setSuccessMsg('Tạo tài khoản thành công!');
      setIsCreateModalOpen(false);
      setNewUsername('');
      setNewPassword('');
      setNewDisplayName('');
      fetchAccounts();

    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Không thể tạo tài khoản lúc này. Vui lòng liên hệ hỗ trợ.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteAccount = (accountId: string, username: string) => {
    setAccountToDelete({ id: accountId, username });
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDeleteAccount = async () => {
    if (!accountToDelete) return;
    setIsDeleteConfirmOpen(false);
    
    setActionLoading(true);
    setErrorMsg('');
    try {
      await deleteAdminAccount(accountToDelete.id);
      
      setSuccessMsg('Đã xóa thành công tài khoản.');
      fetchAccounts();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Không thể xóa tài khoản lúc này. Vui lòng liên hệ hỗ trợ.');
    } finally {
      setActionLoading(false);
      setAccountToDelete(null);
    }
  };

  const getRoleBadgeColor = (roleStr: string) => {
    if (!roleStr) return 'bg-zinc-100 text-zinc-600';
    if (roleStr.includes('SUPER_ADMIN')) return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    if (roleStr.includes('TENANT_ADMIN')) return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
  };

  const filteredAccounts = accounts.filter(a => 
    a.username?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    a.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const canDeleteAccount = (acc: any) => {
    const roleName = acc.roles?.name || acc.role_id || 'VIEWER';
    if (isSuperAdmin) return true;
    if (isEventAdmin) return roleName === 'REFEREE';
    return false;
  };

  const openPermissionModal = async (acc: any) => {
    setPermissionAccount(acc);
    setErrorMsg('');
    setSuccessMsg('');
    const grants = accountScopes[acc.id]?.event_grants || [];
    const next: Record<string, Set<string>> = {};
    grants.forEach((grant: any) => {
      next[grant.event_id] = next[grant.event_id] || new Set<string>();
      next[grant.event_id].add(grant.permission || 'enter_scores');
    });
    setSelectedPermissions(next);
    const targetTenantId = acc.tenant_id || activeTenantId;
    if (permissionTree.length === 0 || permissionTreeTenantId !== targetTenantId) {
      await fetchPermissionTree(targetTenantId);
    }
  };

  const isPermissionAllowed = (eventNode: any, permissionId: string, targetRole: string) => {
    const allowed = new Set(eventNode.allowed_permissions || []);
    if (targetRole === 'REFEREE' && !REFEREE_PERMISSION_IDS.has(permissionId)) return false;
    if (isSuperAdmin || userRole === 'TENANT_ADMIN') return true;
    return allowed.has(permissionId) || allowed.has('manage_events');
  };

  const togglePermission = (eventId: string, permissionId: string) => {
    setSelectedPermissions((current) => {
      const next = { ...current };
      const existing = new Set(next[eventId] || []);
      if (existing.has(permissionId)) {
        existing.delete(permissionId);
      } else {
        existing.add(permissionId);
        if (permissionId !== 'view_event') existing.add('view_event');
      }
      next[eventId] = existing;
      return next;
    });
  };

  const savePermissionTree = async () => {
    if (!permissionAccount) return;
    setActionLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const currentGrants = accountScopes[permissionAccount.id]?.event_grants || [];
      const currentKeys = new Set(currentGrants.map((grant: any) => `${grant.event_id}::${grant.permission || 'enter_scores'}`));
      const desiredKeys = new Set<string>();

      Object.entries(selectedPermissions).forEach(([eventId, permissions]) => {
        permissions.forEach((permission) => desiredKeys.add(`${eventId}::${permission}`));
      });

      for (const key of desiredKeys) {
        if (!currentKeys.has(key)) {
          const [eventId, permission] = key.split('::');
          await tournamentRpc.grantEventAccess(eventId, permissionAccount.id, permission);
        }
      }

      for (const key of currentKeys) {
        if (!desiredKeys.has(key)) {
          const [eventId, permission] = key.split('::');
          await tournamentRpc.revokeEventAccess(eventId, permissionAccount.id, permission);
        }
      }

      setSuccessMsg('Đã lưu cây phân quyền.');
      setPermissionAccount(null);
      await fetchAccounts();
    } catch (error) {
      setErrorMsg(normalizeRpcError(error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const renderAccessScope = (acc: any, roleName: string) => {
    const tenantName = tenants.find(t => t.id === acc.tenant_id)?.name || accountScopes[acc.id]?.tenant_name || acc.tenant_id || 'Chưa rõ đơn vị';
    const grants = accountScopes[acc.id]?.event_grants || [];
    const tournamentNames = Array.from(new Set(grants.map((grant: any) => grant.tournament_name).filter(Boolean)));

    if (roleName === 'SUPER_ADMIN') {
      return <span className="font-semibold text-red-700 dark:text-red-300">Toàn hệ thống</span>;
    }

    if (roleName === 'TENANT_ADMIN') {
      return (
        <div className="space-y-1">
          <p className="font-semibold text-zinc-800 dark:text-zinc-100">Tất cả giải thuộc đơn vị</p>
          <p className="text-xs text-zinc-500">{tenantName}</p>
        </div>
      );
    }

    if (grants.length === 0) {
      return <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Chưa cấp nội dung/giải cụ thể</span>;
    }

    return (
      <div className="max-w-md space-y-1">
        <p className="font-semibold text-zinc-800 dark:text-zinc-100">
          {tournamentNames.slice(0, 2).join(', ')}
          {tournamentNames.length > 2 ? ` +${tournamentNames.length - 2} giải` : ''}
        </p>
        <div className="flex flex-wrap gap-1">
          {grants.slice(0, 3).map((grant: any) => (
            <span key={`${grant.event_id}-${grant.permission}`} className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
              <KeyRound size={10} />
              {grant.event_name} · {grant.permission === 'enter_scores' ? 'Nhập điểm' : 'Quản lý'}
            </span>
          ))}
          {grants.length > 3 && (
            <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">+{grants.length - 3}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="text-blue-600" />
            Quản lý tài khoản và phân quyền
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Quản trị viên cấp {isSuperAdmin ? '1 (Toàn hệ thống)' : '2 (Nhà tổ chức)'} 
          </p>
        </div>

        {canCreateAccounts && (
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors"
        >
          <Plus size={18} />
          {isEventAdmin ? 'Tạo trọng tài' : `Tạo Tài Khoản Cấp ${isSuperAdmin ? '2/3' : '3'}`}
        </button>
        )}
      </div>

      {/* Thao tác quản trị */}
      {!import.meta.env.VITE_SUPABASE_URL && (
        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-xl p-4 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex items-start gap-3">
            <ShieldAlert className="text-amber-600 mt-0.5 shrink-0" size={20} />
            <div>
              <h3 className="font-semibold text-amber-900 dark:text-amber-400 text-sm">Cảnh báo bảo mật</h3>
              <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
                Các thao tác quản lý yêu cầu Server Backend với Service Role Key hợp lệ.
              </p>
            </div>
          </div>
        </div>
      )}

      <SecurityAccountPanel />

      {/* Main Table */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-900/50">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
            <input
              type="text"
              placeholder="Tìm username hoặc tên..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="overflow-x-auto min-h-[300px]">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 font-medium border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-6 py-3">Tài khoản</th>
                <th className="px-6 py-3">Họ Tên</th>
                <th className="px-6 py-3">Chức vụ (Role)</th>
                <th className="px-6 py-3">Phạm vi quản lý</th>
                {isSuperAdmin && <th className="px-6 py-3">Phân khu / Đơn vị tổ chức (Tenant)</th>}
                <th className="px-6 py-3">Trạng thái</th>
                <th className="px-6 py-3 text-right">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={isSuperAdmin ? 7 : 6} className="px-6 py-12 text-center text-zinc-400 font-medium">Bơm dữ liệu từ máy chủ an toàn...</td>
                </tr>
              ) : filteredAccounts.length === 0 ? (
                 <tr>
                  <td colSpan={isSuperAdmin ? 7 : 6} className="px-6 py-12 text-center text-zinc-400">Không tìm thấy tài khoản.</td>
                </tr>
              ) : filteredAccounts.map(acc => {
                const roleName = acc.roles?.name || acc.role_id || 'VIEWER';
                const tenantName = tenants.find(t => t.id === acc.tenant_id)?.name || acc.tenant_id;
                
                return (
                  <tr key={acc.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <td className="px-6 py-4 font-mono font-medium text-zinc-900 dark:text-zinc-100">
                      {acc.username}
                    </td>
                    <td className="px-6 py-4 font-medium dark:text-zinc-200">
                      {acc.display_name}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-md text-xs font-bold leading-none ${getRoleBadgeColor(roleName)}`}>
                        {roleName}
                      </span>
                    </td>
                    <td className="px-6 py-4 align-top text-zinc-600 dark:text-zinc-300">
                      {renderAccessScope(acc, roleName)}
                    </td>
                    {isSuperAdmin && (
                      <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400">
                        {tenantName}
                      </td>
                    )}
                    <td className="px-6 py-4">
                      {acc.status === 'active' ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium text-xs">
                          <CheckCircle2 size={14} /> Hoạt động
                        </span>
                      ) : (
                        <span className="text-zinc-400 text-xs font-medium">Đã khóa</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-1">
                        <button 
                          onClick={() => openEditModal(acc)}
                          disabled={isEventAdmin && roleName !== 'REFEREE'}
                          className="p-1.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-md transition-colors"
                          title="Chỉnh sửa tài khoản"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => openPermissionModal(acc)}
                          className="p-1.5 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-md transition-colors"
                          title="Phân quyền chi tiết"
                        >
                          <SlidersHorizontal size={16} />
                        </button>
                        {canDeleteAccount(acc) && (
                          <button 
                            onClick={() => handleDeleteAccount(acc.id, acc.username)}
                            className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors"
                            title="Xóa tài khoản"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleCreateAccount} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
            <button type="button" onClick={() => setIsCreateModalOpen(false)} className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-600">
              <X size={20} />
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600">
                <Shield size={20} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Khởi tạo tài khoản nhánh</h2>
                <p className="text-xs text-zinc-500">Thiết lập tài khoản cấp điều hành (Enterprise).</p>
              </div>
            </div>

            {errorMsg && <div className="mb-4 p-3 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-lg text-sm">{errorMsg}</div>}
            {successMsg && <div className="mb-4 p-3 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 rounded-lg text-sm">{successMsg}</div>}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Tên đăng nhập hoặc Email</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  autoComplete="username"
                  className="w-full px-3 py-2 border rounded-lg dark:border-zinc-700 dark:bg-zinc-800"
                  placeholder="VD: hcm_admin hoặc demo@example.com"
                  required
                />
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Mật khẩu cấp phát</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full px-3 py-2 border rounded-lg dark:border-zinc-700 dark:bg-zinc-800"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Tên hiển thị (Đại diện định danh)</label>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={e => setNewDisplayName(e.target.value)}
                  autoComplete="name"
                  className="w-full px-3 py-2 border rounded-lg dark:border-zinc-700 dark:bg-zinc-800"
                  placeholder="VD: Giám Đốc Khu Vực TPHCM"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Phân quyền chức vụ (Role)</label>
                <select 
                  value={newRole} 
                  onChange={e => setNewRole(e.target.value)} 
                  className="w-full px-3 py-2 border rounded-lg dark:border-zinc-700 dark:bg-zinc-800 font-medium"
                  disabled={isEventAdmin}
                >
                  {isSuperAdmin && <option value="TENANT_ADMIN">TENANT_ADMIN (Tổ chức cấp 2)</option>}
                  {!isEventAdmin && <option value="EVENT_ADMIN">EVENT_ADMIN (Quản trị nội dung thi đấu)</option>}
                  <option value="REFEREE">REFEREE (Trọng tài giải)</option>
                  {!isEventAdmin && <option value="VIEWER">VIEWER (Khán giả)</option>}
                </select>
              </div>

              {isSuperAdmin && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Đơn vị quản lý (Tenant ID)</label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-2.5 text-zinc-400" size={16} />
                    <select
                      value={newTenantId}
                      onChange={e => setNewTenantId(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 border rounded-lg dark:border-zinc-700 dark:bg-zinc-800"
                    >
                      <option value="">-- Chọn đơn vị --</option>
                      {tenants.map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.id})</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6">
              <button 
                type="submit" 
                disabled={actionLoading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
              >
                {actionLoading ? 'Đang cấp phát...' : 'Tạo mới Tài khoản Doanh nghiệp'}
              </button>
            </div>
          </form>
        </div>
      )}

      {isEditModalOpen && editingAccount && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleEditAccount} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
            <button type="button" onClick={() => setIsEditModalOpen(false)} className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-600">
              <X size={20} />
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600">
                <Edit size={20} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Sửa tài khoản</h2>
                <p className="text-xs text-zinc-500 font-mono">{editingAccount.username}</p>
              </div>
            </div>

            {errorMsg && <div className="mb-4 p-3 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-lg text-sm">{errorMsg}</div>}
            {successMsg && <div className="mb-4 p-3 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 rounded-lg text-sm">{successMsg}</div>}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Tên hiển thị</label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={e => setEditDisplayName(e.target.value)}
                  autoComplete="name"
                  className="w-full px-3 py-2 border rounded-lg dark:border-zinc-700 dark:bg-zinc-800"
                  required
                />
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Mật khẩu mới (Để trống nếu không đổi)</label>
                <input
                  type="password"
                  value={editPassword}
                  onChange={e => setEditPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full px-3 py-2 border rounded-lg dark:border-zinc-700 dark:bg-zinc-800"
                  placeholder="********"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Chức vụ (Role)</label>
                <select 
                  value={editRole} 
                  onChange={e => setEditRole(e.target.value)} 
                  className="w-full px-3 py-2 border rounded-lg dark:border-zinc-700 dark:bg-zinc-800 font-medium"
                  disabled={isEventAdmin}
                >
                  {isSuperAdmin && <option value="TENANT_ADMIN">TENANT_ADMIN (Tổ chức cấp 2)</option>}
                  {!isEventAdmin && <option value="EVENT_ADMIN">EVENT_ADMIN (Quản trị nội dung thi đấu)</option>}
                  <option value="REFEREE">REFEREE (Trọng tài giải)</option>
                  {!isEventAdmin && <option value="VIEWER">VIEWER (Khán giả)</option>}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Trạng thái</label>
                <select 
                  value={editStatus} 
                  onChange={e => setEditStatus(e.target.value)} 
                  className="w-full px-3 py-2 border rounded-lg dark:border-zinc-700 dark:bg-zinc-800 font-medium"
                >
                  <option value="active">Hoạt động (Active)</option>
                  <option value="inactive">Tạm khóa</option>
                  <option value="banned">Cấm đăng nhập</option>
                </select>
              </div>

              {isSuperAdmin && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Đơn vị quản lý (Tenant ID)</label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-2.5 text-zinc-400" size={16} />
                    <select
                      value={editTenantId}
                      onChange={e => setEditTenantId(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 border rounded-lg dark:border-zinc-700 dark:bg-zinc-800"
                    >
                      <option value="">-- Chọn đơn vị --</option>
                      {tenants.map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.id})</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              <button 
                type="button" 
                onClick={() => setIsEditModalOpen(false)}
                className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold rounded-lg transition-colors"
              >
                Hủy
              </button>
              <button 
                type="submit" 
                disabled={actionLoading}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
              >
                {actionLoading ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </div>
          </form>
        </div>
      )}

      {permissionAccount && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-950">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Cây phân quyền</p>
                <h2 className="text-xl font-black text-zinc-900 dark:text-zinc-100">
                  {permissionAccount.display_name || permissionAccount.username}
                </h2>
                <p className="text-xs font-semibold text-zinc-500">
                  @{permissionAccount.username} · {permissionAccount.roles?.name || permissionAccount.role_id || 'VIEWER'}
                </p>
              </div>
              <button onClick={() => setPermissionAccount(null)} className="rounded-full p-2 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {errorMsg && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                  {errorMsg}
                </div>
              )}
              {successMsg && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                  {successMsg}
                </div>
              )}
              {scopeLoading ? (
                <div className="py-12 text-center text-sm font-semibold text-zinc-500">Đang tải cây phân quyền...</div>
              ) : permissionTree.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm font-semibold text-zinc-500">
                  Chưa có giải/nội dung nào trong phạm vi có thể phân quyền.
                </div>
              ) : (
                permissionTree.map((tournament) => (
                  <section key={tournament.tournament_id} className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                    <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{tournament.tenant_name}</p>
                      <h3 className="font-black text-zinc-900 dark:text-zinc-100">{tournament.tournament_name}</h3>
                    </div>
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {(tournament.events || []).map((eventNode: any) => {
                        const targetRole = permissionAccount.roles?.name || permissionAccount.role_id || 'VIEWER';
                        return (
                          <div key={eventNode.event_id} className="grid gap-3 p-4 md:grid-cols-[220px_1fr]">
                            <div>
                              <p className="font-bold text-zinc-900 dark:text-zinc-100">{eventNode.event_name}</p>
                              <p className="text-xs text-zinc-500">Nội dung thi đấu</p>
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {EVENT_PERMISSION_OPTIONS.map((permission) => {
                                const allowed = isPermissionAllowed(eventNode, permission.id, targetRole);
                                const checked = selectedPermissions[eventNode.event_id]?.has(permission.id) || false;
                                return (
                                  <label
                                    key={permission.id}
                                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${
                                      allowed
                                        ? 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200'
                                        : 'border-zinc-100 bg-zinc-50 text-zinc-300 dark:border-zinc-900 dark:bg-zinc-950 dark:text-zinc-700'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={!allowed || actionLoading}
                                      onChange={() => togglePermission(eventNode.event_id, permission.id)}
                                      className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 disabled:opacity-40"
                                    />
                                    <span>{permission.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPermissionAccount(null)}
                className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-bold text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={savePermissionTree}
                disabled={actionLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {actionLoading ? 'Đang lưu...' : 'Lưu phân quyền'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={isDeleteConfirmOpen}
        title="Xóa vĩnh viễn tài khoản"
        message={`Hành động này cực kỳ nguy hiểm và KHÔNG THỂ HOÀN TÁC.\n\nBạn có thực sự chắc chắn muốn XÓA VĨNH VIỄN tài khoản "${accountToDelete?.username || ''}" cùng toàn bộ phiên làm việc, phân quyền và lịch sử hoạt động liên quan không?`}
        confirmText="Xóa vĩnh viễn"
        cancelText="Hủy bỏ"
        isDanger={true}
        onConfirm={handleConfirmDeleteAccount}
        onCancel={() => {
          setIsDeleteConfirmOpen(false);
          setAccountToDelete(null);
        }}
      />
    </div>
  );
}
