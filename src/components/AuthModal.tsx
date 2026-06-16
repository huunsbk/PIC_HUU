import React, { useState } from 'react';
import { useTournamentStore } from '../store';
import { supabase } from '../supabaseClient';
import { 
  Lock, 
  User, 
  X, 
  ShieldCheck, 
  AlertCircle, 
  Eye, 
  EyeOff, 
  Zap, 
  Trophy 
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { setAuthStatus } = useTournamentStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

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
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: trimmedUser + '@pic.com',
        password: trimmedPass
      });

    if (authError || !authData.user) {
      setErrorMsg('Tên đăng nhập hoặc mật khẩu không chính xác.');
      return;
    }

    // Load Enterprise Account details using unified RPC
    const { data: profileStr, error: accountError } = await supabase.rpc('get_current_profile');
    
    console.log('PROFILE_DATA', profileStr);
    console.log('PROFILE_ERROR', accountError);

    const { data: sessionData } = await supabase.auth.getSession();
    console.log('SESSION', sessionData.session);

    const { data: userData } = await supabase.auth.getUser();
    console.log('USER', userData.user);

    if (accountError || !profileStr) {
      console.error('[Auth Flow Error] Stack trace / Error details:', accountError);
      setErrorMsg('Tài khoản không tồn tại trên hệ thống hoặc đã bị khóa.');
      await supabase.auth.signOut();
      return;
    }

    // Since RPC returns row_to_json, data is the json object
    const accountData = typeof profileStr === 'string' ? JSON.parse(profileStr) : profileStr;
    console.log('[Auth Flow Debug] Parsed Account Data:', accountData);

    console.log('TENANT_ID:', accountData.tenant_id);
    console.log('ACCOUNT_ID:', accountData.account_id);
    console.log('ROLE_ID:', accountData.role);
    
    // Check if expected attributes exist
    if (accountData.account_id && accountData.tenant_id && accountData.role && accountData.permissions) {
       console.log('[Auth Flow Debug] AUTH FLOW PASSED');
    } else {
       console.warn('[Auth Flow Debug] Missing some expected attributes in payload');
    }

    const mappedRole = accountData.role || 'guest';
    const tenantIdStr = accountData.tenant_id || 'default';
    const fetchedPermissions = accountData.permissions || [];

    // Construct currentEnterpriseUser payload
    const enterpriseUser = {
      id: accountData.account_id,
      username: accountData.username,
      display_name: accountData.display_name,
      tenant_id: tenantIdStr,
      role_name: mappedRole,
      permissions: fetchedPermissions
    };

    if (sessionData?.session) {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      try {
        const response = await fetch('/api/auth/record-login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionData.session.access_token}`
          },
          body: JSON.stringify({
            account_id: accountData.account_id,
            session_token: sessionData.session.access_token,
            ip_address: "127.0.0.1",
            browser_info: navigator.userAgent,
            device_info: navigator.platform || "Unknown",
            expires_at: expiresAt.toISOString()
          })
        });

        if (!response.ok) {
          const resError = await response.json();
          throw new Error(resError.error || 'Ghi nhận nhận phiên đăng nhập/nhật ký thất bại.');
        }
      } catch (err: any) {
        console.error('Session record failed:', err);
        setErrorMsg(`Lỗi đồng bộ đăng nhập: ${err.message || err}`);
        await supabase.auth.signOut();
        return;
      }
    }

    setSuccessMsg(`Đăng nhập thành công! Chào mừng đại diện ${accountData.display_name}.`);
    
    setTimeout(() => {
      setAuthStatus(mappedRole, accountData.username, tenantIdStr, enterpriseUser);
      onClose();
    }, 800);
    } catch (err: any) {
      console.error('[Auth] Login exception:', err);
      setErrorMsg('Lỗi kết nối máy chủ (Failed to fetch). Vui lòng thử lại.');
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
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu"
                className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-250 dark:border-zinc-800 rounded-xl pl-3 pr-9 py-2.5 text-xs text-zinc-900 dark:text-zinc-150 focus:bg-white focus:outline-none"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3.5 text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
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
          Nếu chưa có tài khoản, vui lòng liên hệ Nguyễn Văn Hữu để được phê duyệt
        </div>

      </div>
    </div>
  );
}
