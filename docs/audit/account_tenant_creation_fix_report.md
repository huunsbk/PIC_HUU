# Account/Tenant Creation Fix Report

Date: 2026-06-20

## Code Fixed

- Added Vercel Serverless API:
  - `api/admin/_accountService.js`
  - `api/admin/accounts.js`
  - `api/admin/accounts/[id].js`
  - `api/admin/accounts/reset.js`
- Updated `src/lib/api/adminAccounts.ts`:
  - Vercel now uses `/api/admin/accounts`.
  - GitHub Pages uses Supabase Edge Functions.
- Added migration:
  - `supabase/migrations/enterprise_completion_v1/011_saas_account_tenant_stability.sql`

## Database Fixed

Applied migration `011_saas_account_tenant_stability.sql` to Supabase beta.

Changes applied:

- Backfilled active Enterprise subscriptions for active tenants missing subscriptions.
- Replaced `create_tenant_v1` so new tenants automatically receive an active Enterprise subscription and audit log.
- Soft-deleted active cross-tenant event grants.
- Cleaned 3 orphan `auth.users` rows that had no `public.accounts`.

No active `public.accounts` rows were missing `user_id`, `tenant_id`, or `role_id`.

## Verification

`tests/enterprise/verify_saas_stability_011.sql` result:

| Check | Result |
| --- | --- |
| Broken active accounts | `0` |
| Auth users without public accounts | `0` |
| Active tenants missing subscription | `0` |
| Active tenants blocked by usage | `0` |
| Active cross-tenant event permissions | `0` |
| Legacy role | `0` |
| Stability status | `PASS` |

Build checks:

- `npm run build`: pass
- `npm run lint`: pass
- API import sanity: pass

## Demo Accounts

Existing active account rows were preserved. The cleanup removed only orphan `auth.users` without public accounts.

## Retest Steps

1. Confirm Vercel has `SUPABASE_SERVICE_ROLE_KEY` and `VITE_SUPABASE_URL` or `SUPABASE_URL` configured.
2. Deploy commit to Vercel.
3. Login SUPER_ADMIN.
4. Create a new tenant in `Quản lý đơn vị`.
5. Verify new tenant has active subscription through `tenant_usage`.
6. Create `TENANT_ADMIN`, `EVENT_ADMIN`, `REFEREE`, `VIEWER` in the target tenant.
7. Verify network calls go to `/api/admin/accounts` on Vercel and return non-405.

