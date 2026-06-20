# Account Update/Delete Fix Report

Date: 2026-06-21

## Root Cause

Production account creation worked because `/api/admin/accounts` existed as a single Vercel serverless file.

Account update/delete failed with:

- `PUT /api/admin/accounts/<account_id> 405`
- `DELETE /api/admin/accounts/<account_id> 405`

The route tree mixed `api/admin/accounts.js` with `api/admin/accounts/[id].js`. This can prevent Vercel from reliably deploying the dynamic child route for `/api/admin/accounts/:id`, so the dynamic method handlers were not reached in production.

## Fix

Standardized Vercel API routing to:

- `api/admin/accounts/index.js` for create account.
- `api/admin/accounts/[id].js` for update/delete account.
- `api/admin/account-item.js` as a flat Vercel function fallback for update/delete.
- `api/admin/accounts/reset.js` for reset password.

Kept GitHub Pages fallback through Supabase Edge Functions. Vercel production uses the same-origin API routes.

After the first deploy, production still returned static `index.html` 405 for `PUT`/`DELETE`
on `/api/admin/accounts/:id`, which showed Vercel was not matching the nested dynamic
function. Added explicit Vercel rewrites before the SPA fallback:

- `/api/admin/accounts` -> `/api/admin/accounts/index`
- `/api/admin/accounts/:id` -> `/api/admin/account-item?id=:id`

## Files Changed

- `api/admin/accounts/index.js`
- `api/admin/account-item.js`
- `api/admin/accounts/[id].js`
- `api/admin/accounts/reset.js`
- `api/admin/_accountService.js`
- `src/App.tsx`
- `vercel.json`
- deleted `api/admin/accounts.js`

## API Behavior

### Create

`POST /api/admin/accounts`

Creates Auth user with server-side service role, then creates `public.accounts`.

### Update

`PUT /api/admin/accounts/:id`

Also accepts `POST` as a compatibility fallback. Supports:

- display name
- role
- tenant
- status
- optional password

Server-side permission checks:

- `SUPER_ADMIN` can manage supported target roles.
- `TENANT_ADMIN` can manage only `EVENT_ADMIN`, `REFEREE`, `VIEWER` in own tenant.
- Quota is checked against target tenant and excludes the account being updated.

### Delete

`DELETE /api/admin/accounts/:id`

Now performs soft-delete:

- sets `accounts.status = 'locked'`
- sets `accounts.deleted_at`
- soft-deletes active `account_event_permissions`
- clears linked session/permission rows where appropriate

Safety checks:

- Cannot self-delete the currently logged-in account.
- Cannot delete the last active `SUPER_ADMIN`.

## CORS

Vercel API routes now handle:

- `OPTIONS` -> `204`
- `Access-Control-Allow-Origin`
- `Access-Control-Allow-Headers`
- `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`

Allowed origins include:

- `https://giai-dau-pickleball.vercel.app`
- `https://huunsbk.github.io`
- any `.vercel.app` deployment
- local dev origins

## Workspace Context 400

Also fixed legacy workspace fallback:

- Tenant UUID/hash such as `11111111-1111-1111-1111-111111111111` is resolved to tenant slug before navigation.
- `/admin/workspace/<tenant-slug>` is treated as a tenant workspace first.
- If tenant has no tournament, the app opens `Quản lý giải đấu` instead of calling tournament/event RPC with a tenant slug.

## Verification

Local verification:

- `npm run build`: pass
- `npm run lint`: pass
- Vercel-style build with `VERCEL=1`: pass
- Serverless import sanity: pass
- Mock API method check:
  - `OPTIONS /api/admin/accounts/:id`: `204`
  - `PUT /api/admin/accounts/:id`: handler reached, no code-level `405`
  - `DELETE /api/admin/accounts/:id`: handler reached, no code-level `405`

Production authenticated UI test:

- Pending in this environment because no reusable SUPER_ADMIN browser session/token is available to the agent.
- After deploy, expected non-authenticated API probes can confirm route deployment no longer returns 405.
