# Account Creation Full Audit Report

Status: hotfix implemented; production account creation requires Supabase Edge Function deployment.

Date: 2026-06-19

Scope:

- Audit account creation for `TENANT_ADMIN`, `EVENT_ADMIN`, `REFEREE`, and `VIEWER`.
- Keep service-role access server-side only.
- Do not create `EVENT_MANAGER`.
- Do not reset database, run Prompt 08, or touch unrelated tenant data.

## Root Cause

On GitHub Pages the account UI was calling:

```text
POST /api/admin/accounts
```

GitHub Pages is static hosting and has no Express backend. The request cannot reach `server.ts`, so the UI falls into the generic error:

```text
Không thể tạo tài khoản lúc này. Vui lòng liên hệ hỗ trợ.
```

Secondary issues found in the old server endpoint:

- It trusted the frontend `isSuperAdmin` flag.
- It mapped legacy `EVENT_MANAGER` to `EVENT_ADMIN`.
- It auto-created missing roles with `insert({ name: roleQueryName })`, which violates the fixed 5-role model.
- It returned useful server errors, but the frontend replaced them with a generic support message.
- It updated an existing Auth user when email already existed, instead of failing clearly.

## Fixed Flow

Frontend account creation now calls:

| Hosting | Endpoint |
|---|---|
| GitHub Pages | Supabase Edge Function `admin-create-account` |
| Local/Express deploy | `POST /api/admin/accounts` |

Both safe paths are designed to:

- Verify the current user from the bearer JWT.
- Load the actor account from `public.accounts`.
- Allow only `SUPER_ADMIN` or `TENANT_ADMIN`.
- Allow only target roles `TENANT_ADMIN`, `EVENT_ADMIN`, `REFEREE`, `VIEWER`.
- Require a real tenant id, not `default`.
- Block `TENANT_ADMIN` from creating another `TENANT_ADMIN`.
- Block `TENANT_ADMIN` from creating accounts outside its own tenant.
- Look up existing role ids and never create roles automatically.
- Create `auth.users` with service role only on server/Edge Function.
- Insert matching `public.accounts`.
- Roll back the newly created Auth user if `public.accounts` insert fails.
- Return clear errors for duplicate email, duplicate username, missing tenant, missing role, missing service-role secret, or missing permission.

## Files Changed

| File | Change |
|---|---|
| `src/components/AccountManager.tsx` | Uses typed admin account API helper, accepts username or email, shows backend error messages. |
| `src/components/AuthModal.tsx` | Allows login with either username or full email. |
| `src/components/ResetPasswordModal.tsx` | Uses shared admin API helper and shows detailed errors. |
| `src/lib/api/adminAccounts.ts` | New frontend helper; GitHub Pages routes account creation to Edge Function. |
| `src/lib/security/sessionHeartbeat.ts` | Removed literal sensitive token field from frontend source. |
| `server.ts` | Hardened local/server account creation and update paths. |
| `supabase/functions/admin-create-account/index.ts` | New secure Edge Function for GitHub Pages account creation. |

## Required Supabase Deployment

GitHub Pages will not be able to create accounts until this Edge Function is deployed and configured:

```bash
supabase functions deploy admin-create-account
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<server-side-service-role-key>
```

Do not put `SUPABASE_SERVICE_ROLE_KEY` in any frontend `.env` or `VITE_*` variable.

## Role Test Matrix

Browser creation tests were not executed because no SUPER_ADMIN demo credential/session was provided in this prompt. I did not create or modify `auth.users` directly.

| Target role | Code path fixed | Browser create test | Database verification | Permission verification |
|---|---|---|---|---|
| `TENANT_ADMIN` | YES | BLOCKED: missing SUPER_ADMIN login | BLOCKED | BLOCKED |
| `EVENT_ADMIN` | YES | BLOCKED: missing SUPER_ADMIN login | BLOCKED | BLOCKED |
| `REFEREE` | YES | BLOCKED: missing SUPER_ADMIN login | BLOCKED | BLOCKED |
| `VIEWER` | YES | BLOCKED: missing SUPER_ADMIN login | BLOCKED | BLOCKED |

Expected test data after Edge Function deploy:

| Role | Suggested email |
|---|---|
| `TENANT_ADMIN` | `tenant.admin.demo+thang-oanh@example.com` |
| `EVENT_ADMIN` | `event.admin.demo+thang-oanh@example.com` |
| `REFEREE` | `referee.demo+thang-oanh@example.com` |
| `VIEWER` | `viewer.demo+thang-oanh@example.com` |

## Console / Network Evidence

Static trace before fix:

| UI action | Old request |
|---|---|
| Create account | `POST /api/admin/accounts` |

Expected network after fix on GitHub Pages:

| UI action | New request |
|---|---|
| Create account | `POST https://<project>.functions.supabase.co/admin-create-account` via `supabase.functions.invoke` |

Expected network after fix on local Express:

| UI action | Request |
|---|---|
| Create account | `POST /api/admin/accounts` |

## Database Checks To Run After Deploy

For each created demo account:

```sql
select
  a.id,
  a.user_id,
  a.tenant_id,
  a.username,
  a.display_name,
  a.status,
  r.name as role_name
from public.accounts a
join public.roles r on r.id = a.role_id
where a.username in (
  'tenant.admin.demo+thang-oanh',
  'event.admin.demo+thang-oanh',
  'referee.demo+thang-oanh',
  'viewer.demo+thang-oanh'
);
```

Expected:

- `user_id` is not null.
- `tenant_id` is the `CLB Thắng Oanh` tenant id.
- `role_name` matches the selected role.
- `status` is `active`.
- No duplicate email or username.

## Permission Checks To Run After Deploy

| Role | Expected |
|---|---|
| `TENANT_ADMIN` | Can see/manage only `CLB Thắng Oanh`; cannot see other tenants. |
| `EVENT_ADMIN` | Cannot manage event data before event grant; after grant, can manage only granted event. |
| `REFEREE` | Can enter scores only for granted event such as Đôi Nam; cannot manage teams/groups/schedule/knockout. |
| `VIEWER` | Cannot call admin RPCs; can only view public/guest surfaces if enabled. |

## Verification

| Check | Result |
|---|---|
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `rg "EVENT_MANAGER" src` | PASS, no matches |
| `rg "SUPABASE_SERVICE_ROLE_KEY\|service_role\|DATABASE_URL\|JWT_SECRET\|refresh_token\|access_token" src` | PASS, no matches |

## Remaining Blockers

- Need deploy `admin-create-account` Edge Function.
- Need configure `SUPABASE_SERVICE_ROLE_KEY` as a Supabase secret.
- Need a real SUPER_ADMIN browser credential/session to execute the four role creation tests.
- Need a demo `REFEREE` account before referee scoring E2E can be fully verified.
