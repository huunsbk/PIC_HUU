import React, { useState, useEffect } from 'react';
import { useTournamentStore } from '../store';
import { supabase, SUPABASE_URL } from '../supabaseClient';
import { createClient } from '@supabase/supabase-js';
import { Users, Plus, KeyRound, Search, ShieldAlert, X, Shield, Building2, CheckCircle2, Edit } from 'lucide-react';

export default function AccountManager() {
  const accountUser = useTournamentStore((state) => state.currentUser);
  const userRole = useTournamentStore((state) => state.userRole);
  const activeTenantId = useTournamentStore((state) => state.activeTenantId);
  
  const [accounts, setAccounts] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('EVENT_MANAGER');
  const [newTenantId, setNewTenantId] = useState(activeTenantId !== 'default' ? activeTenantId : '');
  const [actionLoading, setActionLoading] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<any>(null);

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
    setEditRole(currentRole);
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
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      
      if (!token) {
        throw new Error('Bạn chưa đăng nhập hoặc phiên làm việc đã hết hạn.');
      }

      const response = await fetch(`/api/admin/accounts/${editingAccount.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          displayName: editDisplayName.trim(),
          password: editPassword.trim(),
          role: editRole,
          tenantId: isSuperAdmin ? editTenantId : activeTenantId,
          status: editStatus,
          isSuperAdmin,
          userId: editingAccount.user_id
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Có lỗi cập nhật tài khoản');
      }

      setSuccessMsg('Cập nhật tài khoản thành công!');
      setIsEditModalOpen(false);
      fetchAccounts();

    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi thao tác Admin (Vui lòng liên hệ hỗ trợ).');
    } finally {
      setActionLoading(false);
    }
  };
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const isSuperAdmin = userRole === 'SUPER_ADMIN';

  useEffect(() => {
    fetchAccounts();
    if (isSuperAdmin) {
      fetchTenants();
    }
  }, [userRole, activeTenantId, isSuperAdmin]);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
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
      } else {
         // Fallback if roles relation is strict/unavailable
         const { data: fallbackData, error: fallbackError } = await supabase.from('accounts').select('id, user_id, tenant_id, username, display_name, status, created_at, role_id');
         if (fallbackError) throw fallbackError;
         if (fallbackData) setAccounts(fallbackData);
      }
    } catch (err: any) {
      console.error("fetchAccounts error:", err);
      // Wait to see if we really want to show error to user or just let it be empty
    } finally {
      setLoading(false);
    }
  };

  const fetchTenants = async () => {
    try {
      const { data, error } = await supabase.from('tenants').select('id, name');
      if (error) throw error;
      if (data) setTenants(data);
    } catch (err) {
      console.error("fetchTenants error:", err);
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
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      
      if (!token) {
        throw new Error('Bạn chưa đăng nhập hoặc phiên làm việc đã hết hạn.');
      }

      const response = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          email: `${newUsername.trim()}@pic.com`.toLowerCase(),
          username: newUsername.trim(),
          password: newPassword,
          displayName: newDisplayName.trim(),
          role: newRole,
          tenantId: isSuperAdmin ? newTenantId : activeTenantId,
          isSuperAdmin
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Có lỗi xảy ra khi tạo tài khoản');
      }

      setSuccessMsg('Tạo tài khoản thành công!');
      setIsCreateModalOpen(false);
      setNewUsername('');
      setNewPassword('');
      setNewDisplayName('');
      fetchAccounts();

    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi thao tác Admin (Vui lòng liên hệ hỗ trợ).');
    } finally {
      setActionLoading(false);
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

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors"
        >
          <Plus size={18} />
          Tạo Tài Khoản Cấp {isSuperAdmin ? '2/3' : '3'}
        </button>
      </div>

      {/* Thao tác quản trị */}
      {!process.env.VITE_SUPABASE_URL && (
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
                {isSuperAdmin && <th className="px-6 py-3">Phân khu / Đơn vị tổ chức (Tenant)</th>}
                <th className="px-6 py-3">Trạng thái</th>
                <th className="px-6 py-3 text-right">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 font-medium">Bơm dữ liệu từ máy chủ an toàn...</td>
                </tr>
              ) : filteredAccounts.length === 0 ? (
                 <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-400">Không tìm thấy tài khoản.</td>
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
                      <button 
                        onClick={() => openEditModal(acc)}
                        className="p-1.5 text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-md transition-colors"
                        title="Chỉnh sửa tài khoản"
                      >
                        <Edit size={16} />
                      </button>
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
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Tên đăng nhập (Username)</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg dark:border-zinc-700 dark:bg-zinc-800"
                  placeholder="VD: hcm_admin"
                  required
                />
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Mật khẩu cấp phát</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
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
                >
                  {isSuperAdmin && <option value="TENANT_ADMIN">TENANT_ADMIN (Tổ chức cấp 2)</option>}
                  <option value="EVENT_MANAGER">EVENT_MANAGER (Trưởng Ban tổ chức cấp 3)</option>
                  <option value="REFEREE">REFEREE (Trọng tài giải)</option>
                  <option value="VIEWER">VIEWER (Khán giả)</option>
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
                >
                  {isSuperAdmin && <option value="TENANT_ADMIN">TENANT_ADMIN (Tổ chức cấp 2)</option>}
                  <option value="EVENT_MANAGER">EVENT_MANAGER (Trưởng Ban tổ chức cấp 3)</option>
                  <option value="REFEREE">REFEREE (Trọng tài giải)</option>
                  <option value="VIEWER">VIEWER (Khán giả)</option>
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
                  <option value="locked">Đã khóa (Locked)</option>
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
    </div>
  );
}
