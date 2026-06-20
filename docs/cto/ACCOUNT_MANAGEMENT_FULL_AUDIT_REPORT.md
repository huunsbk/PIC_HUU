# Account Management Full Audit

Date: 2026-06-20

## Summary

Fixed the Vercel account-management routing bug where the frontend posted to `/api/admin/accounts` and received `405 Method Not Allowed`.

The browser runtime now routes account management calls as follows:

- Vercel (`*.vercel.app`): Supabase Edge Functions.
- GitHub Pages (`huunsbk.github.io`): Supabase Edge Functions.
- Local Express runtime: `/api/admin/accounts`.

## Root Cause

`src/lib/api/adminAccounts.ts` only selected the Supabase Edge Function path on GitHub Pages. Vercel did not match that condition, so the static Vercel deployment attempted:

`POST /api/admin/accounts`

The Vercel deployment does not host this Express API route, so the request failed with HTTP 405.

## Files Changed

- `src/lib/api/adminAccounts.ts`
- `src/components/AccountManager.tsx`
- `supabase/functions/_shared/admin-account.ts`
- `supabase/functions/admin-create-account/index.ts`
- `supabase/functions/admin-update-account/index.ts`
- `supabase/functions/admin-delete-account/index.ts`
- `supabase/functions/admin-reset-account-password/index.ts`
- `supabase/migrations/enterprise_completion_v1/001_reset_demo_and_roles.sql`

## Endpoint Matrix

| Operation | Vercel / GitHub Pages | Local Express |
| --- | --- | --- |
| Create account | `admin-create-account` | `POST /api/admin/accounts` |
| Update role/name/status/password | `admin-update-account` | `PUT /api/admin/accounts/:id` |
| Delete account | `admin-delete-account` | `DELETE /api/admin/accounts/:accountId` |
| Reset password | `admin-reset-account-password` | `POST /api/admin/accounts/reset` |

## Edge Function CORS

Shared CORS helper now returns:

- `Access-Control-Allow-Origin` for:
  - `https://huunsbk.github.io`
  - any origin ending in `.vercel.app`
  - `http://localhost:5173`
  - `http://127.0.0.1:4173`
- `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type`
- `Access-Control-Allow-Methods: POST, PUT, DELETE, OPTIONS`
- `Vary: Origin`

Status: code implemented. Runtime CORS test is blocked until Supabase Functions are deployed.

## Permission Matrix

| Actor | Expected Result | Server-side Enforcement |
| --- | --- | --- |
| SUPER_ADMIN creates TENANT_ADMIN | Allowed | Edge Function validates actor role and target role |
| SUPER_ADMIN creates EVENT_ADMIN | Allowed | Edge Function validates actor role and target role |
| SUPER_ADMIN creates REFEREE | Allowed | Edge Function validates actor role and target role |
| SUPER_ADMIN creates VIEWER | Allowed | Edge Function validates actor role and target role |
| TENANT_ADMIN creates EVENT_ADMIN in own tenant | Allowed | Tenant id must match actor tenant |
| TENANT_ADMIN creates REFEREE in own tenant | Allowed | Tenant id must match actor tenant |
| TENANT_ADMIN creates VIEWER in own tenant | Allowed | Tenant id must match actor tenant |
| TENANT_ADMIN creates SUPER_ADMIN | Blocked | Target role allowlist rejects SUPER_ADMIN |
| TENANT_ADMIN creates TENANT_ADMIN | Blocked | Explicit TENANT_ADMIN guard |
| TENANT_ADMIN creates account in another tenant | Blocked | Tenant mismatch guard |
| EVENT_ADMIN creates account | Blocked | Actor role must be SUPER_ADMIN or TENANT_ADMIN |
| REFEREE creates account | Blocked | Actor role must be SUPER_ADMIN or TENANT_ADMIN |
| VIEWER creates account | Blocked | Actor role must be SUPER_ADMIN or TENANT_ADMIN |

## Static Checks

| Check | Result |
| --- | --- |
| `npm run build` | Pass |
| `npm run lint` | Pass |
| `rg "EVENT_MANAGER" src supabase` | No matches |
| `rg "SUPABASE_SERVICE_ROLE_KEY\|service_role\|DATABASE_URL\|JWT_SECRET\|refresh_token\|access_token" src` | No matches |
| `rg "/api/admin/accounts" src` | Present only in local Express fallback branch |

## Preview Checks

Vercel-style local build was generated with `VERCEL=1`.

Static `dist` preview checks:

| Route | Result |
| --- | --- |
| `/` | HTTP 200 |
| `/admin/workspace/thang-oanh` | HTTP 200 |
| React root present | Pass |
| Vercel asset base | Pass, assets use `/assets/...` |

Bundle evidence confirms the production browser branch includes:

- `.vercel.app` hostname detection
- `admin-create-account`
- `admin-update-account`
- `admin-delete-account`
- `admin-reset-account-password`

## Browser / Network Evidence

Full authenticated browser creation tests were not completed in this environment because:

- The in-app browser plugin failed to start on Windows sandbox with `CreateProcessAsUserW failed: 5`.
- No SUPER_ADMIN credential or reusable Vercel-authenticated browser session is available to this agent.
- Supabase CLI is not installed, so the newly added Edge Functions could not be deployed from this environment.

Evidence directory:

`docs/cto/screenshots/account-management-audit/`

## Database Verify

No new test accounts were created from this environment. The requested SQL verification should be run after deploying the Edge Functions and creating the four test users:

```sql
select
  a.id,
  a.user_id,
  a.tenant_id,
  t.name as tenant_name,
  a.username,
  a.display_name,
  a.status,
  r.name as role_name
from public.accounts a
join public.roles r on r.id = a.role_id
left join public.tenants t on t.id = a.tenant_id
where a.username ilike '%thang_oanh_%'
   or a.email ilike '%thang_oanh_%'
order by r.name, a.created_at desc;
```

## Production Blockers

1. Deploy Supabase Functions:
   - `admin-create-account`
   - `admin-update-account`
   - `admin-delete-account`
   - `admin-reset-account-password`
2. Re-test from an authenticated SUPER_ADMIN browser session on Vercel.
3. Confirm Network no longer shows `/api/admin/accounts`.
4. Confirm POST/OPTIONS to Supabase Functions do not fail CORS.

