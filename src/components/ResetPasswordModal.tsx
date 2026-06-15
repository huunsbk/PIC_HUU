import React, { useState } from 'react';
import { KeyRound, ShieldAlert, X, Eye, EyeOff } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

interface ResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUsername: string;
}

export default function ResetPasswordModal({ isOpen, onClose, targetUsername }: ResetPasswordModalProps) {
  const [serviceRoleKey, setServiceRoleKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!serviceRoleKey.trim() || !newPassword.trim()) {
      setErrorMsg('Vui lòng nhập Service Role Key và Mật khẩu mới.');
      return;
    }

    setLoading(true);

    try {
      // Create a temporary admin client
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
      if (!supabaseUrl) {
        throw new Error('Không tìm thấy VITE_SUPABASE_URL.');
      }

      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey.trim(), {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
      });

      // 1. Find the user by using listUsers
      // Note: listUsers requires pagination, but for a small db, 1 page is usually enough.
      // Alternatively, we know the email: targetUsername + '@pic.com'
      // But there's no getUserByEmail directly, so we list and filter.
      const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
      
      if (listError) {
        throw new Error('Lỗi truy cập dữ liệu người dùng: Service Role Key có thể không hợp lệ.');
      }

      const targetEmail = `${targetUsername}@pic.com`.toLowerCase();
      const user = users.find(u => u.email === targetEmail);

      if (!user) {
        throw new Error(`Không tìm thấy người dùng với email ảo: ${targetEmail}`);
      }

      // 2. Update password
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        password: newPassword
      });

      if (updateError) {
        throw new Error(`Lỗi cập nhật mật khẩu: ${updateError.message}`);
      }

      setSuccessMsg('Đổi mật khẩu thành công!');
      setTimeout(() => {
        onClose();
        setServiceRoleKey('');
        setNewPassword('');
        setSuccessMsg('');
      }, 1500);

    } catch (err: any) {
      setErrorMsg(err.message || 'Có lỗi xảy ra (kiểm tra lại Service Key).');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-rose-600 dark:text-rose-400">
            <KeyRound size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Cấp lại mật khẩu
            </h2>
            <p className="text-xs text-zinc-500">
              Tài khoản: <span className="font-semibold text-zinc-700 dark:text-zinc-300">{targetUsername}</span>
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs rounded-xl flex items-start gap-2 border border-red-100 dark:border-red-800/30">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 text-xs rounded-xl border border-teal-100 dark:border-teal-800/30">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleReset} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Mật khẩu mới
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nhập mật khẩu mới"
                className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-zinc-400 hover:text-zinc-600 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Supabase Service Role Key <span className="text-rose-500">*</span>
            </label>
            <input
              type="password"
              value={serviceRoleKey}
              onChange={(e) => setServiceRoleKey(e.target.value)}
              placeholder="eyJh..."
              className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 font-mono text-xs"
              required
            />
            <p className="mt-1 text-[10px] text-zinc-500">
              * Yêu cầu quyền quản trị cấp cao (service_role) từ bảng điều khiển Supabase để can thiệp đổi mật khẩu. Key này chỉ dùng 1 lần, KHÔNG LƯU LẠI trên hệ thống.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-sm transition-colors mt-2 disabled:opacity-50"
          >
            {loading ? 'Đang thực hiện...' : 'Xác nhận đổi mật khẩu'}
          </button>
        </form>
      </div>
    </div>
  );
}
