# Urgent Auth Security Fix Report

## Scope

- Commercial Beta V1 urgent password input hardening.
- Self-service account security UI for the currently signed-in admin user.
- No database migration or SQL execution.
- No service role key in frontend code.

## Security Fixes

- Password input fixed: `src/components/AuthModal.tsx` now renders the login password field as `type="password"`.
- Autocomplete fixed:
  - Login username field uses `autoComplete="username"`.
  - Login password field uses `autoComplete="current-password"`.
  - New-password fields use `autoComplete="new-password"`.
- Unsafe auth logs removed or sanitized:
  - Auth/session error logs no longer print raw error objects in the login flow.
  - Session heartbeat and tenant-context auth logs no longer print raw session-related errors.
- Passwords are not written to `localStorage` or `sessionStorage`.
- Passwords, access tokens, refresh tokens, session objects, and full user objects are not logged.

## Self-Service Account Security UI

- Added `Bảo mật tài khoản` section in `Quản lý tài khoản`.
- Added `Đổi mật khẩu của tôi`.
  - Validates minimum 12 characters.
  - Requires uppercase, lowercase, number, and special character.
  - Requires confirmation password match.
  - Calls `supabase.auth.updateUser({ password: newPassword })`.
  - Signs the user out after success and requires login again.
- Added `Đổi email của tôi`.
  - Validates non-empty valid email format.
  - Calls `supabase.auth.updateUser({ email: newEmail }, { emailRedirectTo })`.
  - Shows a confirmation message for Supabase email confirmation flow.

## Supabase Email Redirect

- Supabase Site URL configured to `https://huunsbk.github.io/PIC_HUU/`.
- Supabase Redirect URLs configured:
  - `https://huunsbk.github.io/PIC_HUU/`
  - `https://huunsbk.github.io/PIC_HUU/**`
- Email-change redirect now uses `getAppAuthRedirectUrl()` generated from `window.location.origin` and `import.meta.env.BASE_URL`.
- GitHub Pages runtime redirect target is `https://huunsbk.github.io/PIC_HUU/`.
- Localhost auth redirect references removed from frontend email-change flow.
- Expired or invalid email verification hash errors are shown as a friendly Vietnamese message and then removed from the URL.

## CTO Note: Changing Other Users

Changing another user's auth email/password must be implemented later through a Supabase Edge Function or backend service named `admin_update_user_auth_v1`.

The Edge Function may use the service role key server-side only. The frontend must never contain a service role key, must not use `VITE_SUPABASE_SERVICE_ROLE_KEY`, and must not call `admin.updateUserById`.

## Verification

- `npm run build:pages`: PASS
- `npm run lint --if-present`: PASS
- SQL executed: NO
- Supabase commands run: NO
- Secrets committed: NO
- Service role used in frontend: NO
