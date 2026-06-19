# Vercel Primary Deployment Report

Status: configuration standardized; production runtime test blocked by Vercel Authentication.

Date: 2026-06-20

## Goal

Use Vercel as the primary runtime deployment for PIC_HUU. GitHub Pages remains a fallback build target.

## Repository Configuration

| Item | Result |
|---|---|
| Production branch | `main` in GitHub/Vercel deployment records |
| Preview deployments | Vercel deployment records show `Preview` deployments for non-production refs |
| Vercel build command | `npm run build` in `vercel.json` |
| Vercel output directory | `dist` in `vercel.json` |
| SPA rewrite | `/(.*)` -> `/index.html` in `vercel.json` |
| GitHub Pages fallback | Still present through `.github/workflows/deploy.yml` and `npm run build:pages` |

## Vite Base Check

`vite.config.ts` uses:

```ts
base: process.env.VERCEL ? '/' : '/PIC_HUU/'
```

Vercel-mode build was tested locally with `VERCEL=1`:

| Check | Result |
|---|---|
| `VERCEL=1 npm run build` | PASS |
| `dist/index.html` JS/CSS paths | `/assets/...` |
| `/PIC_HUU/` in Vercel-mode asset paths | Not present |

Normal build without `VERCEL=1` still produces GitHub Pages-compatible `/PIC_HUU/` paths.

## Vercel Deployment

Latest production deployment found through GitHub Deployments API:

| Field | Value |
|---|---|
| Commit tested | `80c32c6217e4b8e40db48153fcb6e4b7cb50c5a2` |
| Environment | `Production` |
| State | `success` |
| URL | `https://giai-dau-pickleball-8bjlqijq0-huunsbks-projects.vercel.app` |

## Runtime Route Test

| Route | Result |
|---|---|
| `/` | BLOCKED by Vercel Authentication / Deployment Protection |
| `/admin/workspace/thang-oanh` | BLOCKED by Vercel Authentication / Deployment Protection |
| Direct refresh `/admin/workspace/thang-oanh` | BLOCKED by Vercel Authentication / Deployment Protection |

Observed response:

```text
Authentication Required
This page requires Vercel authentication.
```

This means the deployment exists, but it is not publicly reachable as the primary user-facing runtime until deployment protection is disabled for production or a bypass/auth method is provided.

## Console / Network Runtime Test

Could not run real browser app assertions against Vercel because the app shell is behind Vercel Authentication.

Not verified yet:

- No `ReferenceError`.
- No `Navigate is not defined`.
- No `TypeError`.
- No `Chunk load failed`.
- No JS/CSS 404.
- UI route render without blank page.

## Account Creation on Vercel

Current frontend account creation path:

- GitHub Pages / static hosting / Vercel browser runtime: Supabase Edge Function `admin-create-account`.
- Local Express runtime: `/api/admin/accounts`.

This is correct for Vercel if the Edge Function has been deployed and configured.

Account creation test status:

| Role | Vercel browser test |
|---|---|
| `TENANT_ADMIN` | BLOCKED by Vercel Authentication and missing SUPER_ADMIN test session |
| `EVENT_ADMIN` | BLOCKED by Vercel Authentication and missing SUPER_ADMIN test session |
| `REFEREE` | BLOCKED by Vercel Authentication and missing SUPER_ADMIN test session |
| `VIEWER` | BLOCKED by Vercel Authentication and missing SUPER_ADMIN test session |

Required Supabase setup for account creation:

```bash
supabase functions deploy admin-create-account
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<server-side-service-role-key>
```

Do not configure `SUPABASE_SERVICE_ROLE_KEY` as a `VITE_*` variable or expose it to the frontend.

## Environment Variables

Expected Vercel frontend env vars:

| Variable | Safe for frontend | Required |
|---|---|---|
| `VITE_SUPABASE_URL` | YES | YES |
| `VITE_SUPABASE_ANON_KEY` | YES | YES |

Do not set these as frontend-exposed vars:

| Variable | Frontend allowed |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | NO |
| `DATABASE_URL` | NO |
| `JWT_SECRET` | NO |
| refresh/access tokens | NO |

Vercel project env values could not be inspected locally because there is no Vercel CLI session or Vercel API token in this workspace.

## Verification

| Check | Result |
|---|---|
| `npm run build` | PASS |
| `npm run lint` | PASS |
| Vercel-mode build with `VERCEL=1` | PASS |
| `vercel.json` SPA rewrite | PASS |
| Root Vercel route | BLOCKED by Vercel Authentication |
| Direct workspace Vercel route | BLOCKED by Vercel Authentication |
| Account creation through Vercel | BLOCKED by Vercel Authentication and missing SUPER_ADMIN test session |

## Required Follow-Up

1. In Vercel, make the production deployment publicly accessible, or provide a Vercel Protection Bypass token for automated testing.
2. Confirm project settings:
   - Production branch: `main`.
   - Build command: `npm run build`.
   - Output directory: `dist`.
   - Environment variables: only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for frontend.
3. Deploy/configure Supabase Edge Function `admin-create-account`.
4. Provide a SUPER_ADMIN test credential/session to execute authenticated UI and account creation tests.
