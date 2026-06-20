# Account/Tenant Creation Diagnosis

Date: 2026-06-20

## Root Cause

The production account creation failure had two linked causes:

1. Vercel did not have a real `/api/admin/accounts` serverless route, while older frontend/backend logic expected that endpoint in some runtime paths.
2. Supabase tenant onboarding was incomplete: `create_tenant_v1` inserted only `public.tenants`, without provisioning an active `tenant_subscriptions` row. Since `tenant_usage` is a read-only view derived from subscriptions and current rows, tenants without subscriptions appeared quota-blocked or under default limits.

## Database Evidence

Initial diagnosis showed:

- `auth.users` had 3 orphan users with no `public.accounts`.
- Active tenants except `CLB Thắng Oanh` lacked active/trial subscriptions.
- `system-admin` showed `users_used = 5` and `users_limit = 1`.
- `account_event_permissions` had active cross-tenant grants.
- `public.accounts` itself had no broken active rows: no missing `user_id`, `tenant_id`, or `role_id`.

Schema finding:

- `public.tenant_usage` is a view, not a writable table.
- `public.saas_metrics` is also a view.
- `public.accounts` does not currently store an `email` column; email lives in `auth.users`.

## Source Evidence

- `src/lib/api/adminAccounts.ts` controls browser account calls.
- `server.ts` had Express `/api/admin/accounts`, but that Express server is not the Vercel serverless route.
- `src/components/TenantManagementPage.tsx` calls `create_tenant_v1`.
- `supabase/migrations/enterprise_completion_v1/006_tenant_management_rpcs.sql` showed `create_tenant_v1` only inserted `tenants`.

## Deployment Evidence

Vercel needs a real `api/admin/...` function tree or the frontend must call Supabase Edge Functions. This fix adds Vercel serverless routes and keeps GitHub Pages on Supabase Edge Function fallback.

