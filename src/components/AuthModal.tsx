import React, { useState } from 'react';
import { useTournamentStore } from '../store';
import { supabase } from '../supabaseClient';
import { getAppAuthRedirectUrl } from '../lib/authRedirect';
import { loadCurrentProfile } from '../lib/auth/profile';
import { 
  Chrome,
  Lock, 
  User, 
  X, 
  ShieldCheck, 
  AlertCircle, 
  ArrowRight,
  Zap, 
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { setAuthStatus, setAuthAccessState } = useTournamentStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const selfServiceEnabled = import.meta.env.VITE_SELF_SERVICE_ENABLED === 'true';

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const trimmedUser = username.trim().toLowerCase();
    const trimmedPass = password.trim();

    if (!trimmedUser || !trimmedPass) {
      setErrorMsg('Vui lòng điền đầy đủ Tên đăng nhập và Mật khẩu.');
      return;
    }

    try {
      setAuthAccessState('AUTHENTICATING');
      const loginEmail = trimmedUser.includes('@') ? trimmedUser : `${trimmedUser}@pic.com`;
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: trimmedPass
      });

    if (authError || !authData.user) {
      setAuthAccessState('UNAUTHENTICATED');
      setErrorMsg('Tên đăng nhập hoặc mật khẩu không chính xác.');
      return;
    }

    setAuthAccessState('PROFILE_LOADING');
    const accountData = await loadCurrentProfile({
      session: authData.session,
      bootstrapGoogle: false,
    });

    if (!accountData) {
      console.warn('[Auth] Profile lookup failed during login.');
      setAuthAccessState('PROFILE_ERROR');
      setErrorMsg('Tài khoản không tồn tại trên hệ thống hoặc đã bị khóa.');
      await supabase.auth.signOut();
      return;
    }
    
    // Check if expected attributes exist
    const hasPermissionPayload = Array.isArray(accountData.permissions)
      || Array.isArray(accountData.role_permissions)
      || Array.isArray(accountData.account_permissions);
    if (!(accountData.account_id && accountData.tenant_id && accountData.role && hasPermissionPayload)) {
       console.warn('[Auth] Login profile is missing expected attributes.');
    }

    supabase.rpc('record_login_session_v1').then(({ error }) => {
      if (error) {
        console.warn('[Auth] Optional login telemetry skipped.');
      }
    }).catch(() => {
      console.warn('[Auth] Optional login telemetry skipped.');
    });

    const mappedRole = accountData.role || 'guest';
    const tenantIdStr = accountData.tenant_id || 'default';
    
    // Combine role_permissions & account_permissions from new get_current_profile format
    // or backwards compat
    const rp = accountData.role_permissions || [];
    const ap = accountData.account_permissions || [];
    const legacyPerms = accountData.permissions || [];
    let fetchedPermissions = Array.from(new Set([...rp, ...ap, ...legacyPerms]));
    
    const eventIds = accountData.event_ids || [];
    const eventPermissions = accountData.event_permissions || [];

    // Construct currentEnterpriseUser payload
    const enterpriseUser = {
      id: accountData.account_id,
      username: accountData.username,
      display_name: accountData.display_name,
      tenant_id: tenantIdStr,
      role_name: mappedRole,
      permissions: fetchedPermissions,
      event_ids: eventIds,
      event_permissions: eventPermissions,
      eventPermissions,
      tenant_type: accountData.tenant_type,
      onboarding_status: accountData.onboarding_status,
      business_access_active: accountData.business_access_active,
    };

    setSuccessMsg(`Đăng nhập thành công! Chào mừng đại diện ${accountData.display_name}.`);
    
    setTimeout(() => {
      setAuthStatus(mappedRole, accountData.username, tenantIdStr, enterpriseUser)
        .then(() => onClose())
        .catch(() => {
          setErrorMsg('Đăng nhập thành công nhưng chưa tải được workspace được phân quyền.');
        });
    }, 800);
    } catch {
      console.warn('[Auth] Login request failed.');
      setAuthAccessState('PROFILE_ERROR');
      setErrorMsg('Không thể đăng nhập lúc này. Vui lòng kiểm tra kết nối và thử lại.');
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setIsGoogleLoading(true);
    setAuthAccessState('AUTHENTICATING');

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: getAppAuthRedirectUrl(),
          queryParams: {
            prompt: 'select_account',
          },
        },
      });

      if (error) throw error;
    } catch {
      setAuthAccessState('UNAUTHENTICATED');
      setErrorMsg('Không thể bắt đầu đăng nhập Google. Vui lòng thử lại.');
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in" id="auth-modal-overlay">
      
      {/* Container Thẻ Login */}
      <div 
        className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl max-w-sm w-full p-6 space-y-4 animate-scale-up"
        id="auth-modal-card"
      >
        
        {/* Nút Đóng */}
        <button 
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
        >
          <X size={16} />
        </button>

        {/* Đầu Đề Login */}
        <div className="text-center space-y-1.5 pt-2">
          <div className="mx-auto h-12 w-12 bg-blue-50 dark:bg-blue-950/30 rounded-2xl flex items-center justify-center text-blue-600 dark:text-blue-400 shadow-inner">
            <Lock size={22} className="stroke-[2.5]" id="auth-icon-visual" />
          </div>
          <h2 className="text-base font-black tracking-tight text-zinc-900 dark:text-zinc-100">ĐĂNG NHẬP BAN TỔ CHỨC</h2>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium">Nhập thông tin quản trị giải đấu riêng của bạn</p>
        </div>

        {/* Hiển thị Thông Báo Lỗi/Thành công */}
        {errorMsg && (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-red-800 dark:text-red-400 p-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5">
            <AlertCircle size={13} className="text-red-500 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30 text-emerald-800 dark:text-emerald-400 p-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5">
            <ShieldCheck size={13} className="text-emerald-500 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {selfServiceEnabled && (
          <>
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isGoogleLoading}
              className="group relative flex min-h-14 w-full cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-[#1557b0] bg-[#1a73e8] px-3 py-2.5 text-left text-white shadow-lg shadow-blue-600/20 transition-all hover:-translate-y-0.5 hover:bg-[#1765cc] hover:shadow-xl hover:shadow-blue-600/25 disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0"
            >
              <span className="absolute inset-x-0 top-0 grid h-1 grid-cols-4" aria-hidden="true">
                <span className="bg-[#4285f4]" />
                <span className="bg-[#ea4335]" />
                <span className="bg-[#fbbc05]" />
                <span className="bg-[#34a853]" />
              </span>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white shadow-sm">
                <Chrome size={19} className="text-[#1a73e8]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black leading-tight">
                  {isGoogleLoading ? 'Đang kết nối Google...' : 'Đăng nhập bằng Google'}
                </span>
                <span className="mt-0.5 block text-[10px] font-semibold text-blue-100">
                  Tạo tài khoản và mở giải ngay
                </span>
              </span>
              <ArrowRight size={17} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
            </button>
            <div className="flex items-center gap-3 text-[10px] font-bold uppercase text-zinc-400">
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              Hoặc dùng tài khoản được cấp
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            </div>
          </>
        )}

        {/* Biểu mẫu */}
        <form onSubmit={handleLogin} className="space-y-3.5 text-xs text-zinc-650 dark:text-zinc-350">
          
          {/* Tên Đăng Nhập */}
          <div>
            <label className="block font-bold mb-1 select-none text-zinc-705 dark:text-zinc-295">Tên Đăng Nhập <span className="text-red-500">*</span></label>
            <div className="relative">
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="nhập tài khoản"
                autoComplete="username"
                autoFocus
                className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-250 dark:border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-zinc-900 dark:text-zinc-150 focus:bg-white focus:outline-none"
                required
              />
            </div>
          </div>

          {/* Mật Khẩu */}
          <div>
            <label className="block font-bold mb-1 select-none text-zinc-705 dark:text-zinc-295">Mật Khẩu <span className="text-red-500">*</span></label>
            <div className="relative">
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu"
                autoComplete="current-password"
                className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-250 dark:border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-zinc-900 dark:text-zinc-150 focus:bg-white focus:outline-none"
                required
              />
            </div>
          </div>

          {/* Nút Submit */}
          <button
            type="submit"
            className="w-full bg-zinc-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-zinc-100 text-white dark:text-zinc-950 font-black py-2.5 rounded-xl mt-4 cursor-pointer transition-all flex items-center justify-center gap-1.5 shadow-md border border-transparent dark:border-zinc-250"
          >
            <Zap size={13} fill="currentColor" />
            Đăng Nhập Quản Trị
          </button>
        </form>

        <div className="text-[10px] text-zinc-400 dark:text-zinc-500 text-center border-t border-zinc-100 dark:border-zinc-850 pt-2.5">
          {selfServiceEnabled
            ? 'Tài khoản Google mới sẽ được tạo không gian riêng và cần mở khóa trước khi vận hành.'
            : 'Nếu chưa có tài khoản, vui lòng liên hệ Nguyễn Văn Hữu để được phê duyệt'}
        </div>

      </div>
    </div>
  );
}
