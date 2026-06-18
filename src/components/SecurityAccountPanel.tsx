import React, { useState } from 'react';
import { KeyRound, Mail, ShieldCheck, X, AlertCircle } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { getAppAuthRedirectUrl } from '../lib/authRedirect';

type ModalMode = 'password' | 'email' | null;

const passwordPolicy = [
  { label: 'Tối thiểu 12 ký tự', test: (value: string) => value.length >= 12 },
  { label: 'Có chữ hoa', test: (value: string) => /[A-Z]/.test(value) },
  { label: 'Có chữ thường', test: (value: string) => /[a-z]/.test(value) },
  { label: 'Có số', test: (value: string) => /\d/.test(value) },
  { label: 'Có ký tự đặc biệt', test: (value: string) => /[^A-Za-z0-9]/.test(value) },
];

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export default function SecurityAccountPanel() {
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setNewPassword('');
    setConfirmPassword('');
    setNewEmail('');
    setErrorMsg('');
    setSuccessMsg('');
    setSaving(false);
  };

  const openModal = (mode: ModalMode) => {
    resetForm();
    setModalMode(mode);
  };

  const closeModal = () => {
    resetForm();
    setModalMode(null);
  };

  const signOutAfterSuccess = async () => {
    window.setTimeout(async () => {
      await supabase.auth.signOut();
      window.location.hash = '';
      window.location.reload();
    }, 1400);
  };

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const passwordValue = newPassword;
    const failedRule = passwordPolicy.find((rule) => !rule.test(passwordValue));
    if (failedRule) {
      setErrorMsg(`Mật khẩu mới chưa đạt yêu cầu: ${failedRule.label}.`);
      return;
    }

    if (passwordValue !== confirmPassword) {
      setErrorMsg('Mật khẩu xác nhận không khớp.');
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: passwordValue });
    setSaving(false);

    if (error) {
      setErrorMsg('Không thể đổi mật khẩu lúc này. Vui lòng thử lại hoặc liên hệ quản trị hệ thống.');
      return;
    }

    setNewPassword('');
    setConfirmPassword('');
    setSuccessMsg('Đổi mật khẩu thành công. Vui lòng đăng nhập lại.');
    await signOutAfterSuccess();
  };

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const emailValue = newEmail.trim().toLowerCase();
    if (!emailValue || !isValidEmail(emailValue)) {
      setErrorMsg('Vui lòng nhập email hợp lệ.');
      return;
    }

    setSaving(true);
    const emailRedirectTo = getAppAuthRedirectUrl();
    const { error } = await supabase.auth.updateUser(
      { email: emailValue },
      { emailRedirectTo }
    );
    setSaving(false);

    if (error) {
      setErrorMsg('Không thể gửi yêu cầu đổi email lúc này. Vui lòng thử lại hoặc liên hệ quản trị hệ thống.');
      return;
    }

    setNewEmail('');
    setSuccessMsg('Đã gửi email xác thực. Vui lòng mở email mới nhất và bấm liên kết xác nhận. Không sử dụng link cũ vì link cũ có thể đã hết hạn.');
    await signOutAfterSuccess();
  };

  return (
    <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm p-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Bảo mật tài khoản</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Tự cập nhật email hoặc mật khẩu của tài khoản đang đăng nhập.
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => openModal('password')}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100 text-sm font-bold transition-colors"
          >
            <KeyRound size={16} />
            Đổi mật khẩu của tôi
          </button>
          <button
            type="button"
            onClick={() => openModal('email')}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-colors"
          >
            <Mail size={16} />
            Đổi email của tôi
          </button>
        </div>
      </div>

      {modalMode && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form
            onSubmit={modalMode === 'password' ? handlePasswordSubmit : handleEmailSubmit}
            className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6"
          >
            <button
              type="button"
              onClick={closeModal}
              className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              <X size={20} />
            </button>

            <div className="mb-5">
              <h3 className="text-xl font-black text-zinc-900 dark:text-zinc-100">
                {modalMode === 'password' ? 'Đổi mật khẩu của tôi' : 'Đổi email của tôi'}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {modalMode === 'password'
                  ? 'Sau khi lưu, hệ thống sẽ đăng xuất để bạn đăng nhập lại.'
                  : 'Supabase có thể yêu cầu xác nhận qua email mới.'}
              </p>
            </div>

            {errorMsg && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-700 dark:text-red-400 text-sm flex gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-400 text-sm">
                {successMsg}
              </div>
            )}

            {modalMode === 'password' ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Mật khẩu mới</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    className="w-full px-3 py-2 border rounded-lg dark:border-zinc-700 dark:bg-zinc-800"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Nhập lại mật khẩu mới</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    className="w-full px-3 py-2 border rounded-lg dark:border-zinc-700 dark:bg-zinc-800"
                    required
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">Email mới</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  autoComplete="email"
                  className="w-full px-3 py-2 border rounded-lg dark:border-zinc-700 dark:bg-zinc-800"
                  required
                />
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={closeModal}
                className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold rounded-lg transition-colors"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving || !!successMsg}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
              >
                {saving
                  ? 'Đang lưu...'
                  : modalMode === 'password'
                    ? 'Lưu mật khẩu mới'
                    : 'Lưu email mới'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
