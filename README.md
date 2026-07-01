# PIC_HUU - Tournament Manager Enterprise

Production SaaS web app for operating sports tournaments with tenant, tournament, event, team, group, schedule, score, ranking, knockout, TV display, account, role, permission, and audit workflows.

Pickleball is the first supported sport. The architecture is intended to stay multi-sport and should not hard-code all future business rules to Pickleball.

## Production

- Primary production: `https://picvn.vercel.app/`
- Main workspace route pattern: `/admin/workspace/<slug>`
- Public tournament route pattern: `/tournament/<slug>`
- Main deployment platform: Vercel
- GitHub Pages: legacy/fallback only
- Database/auth/RPC: Supabase

## Tech Stack

- React + TypeScript + Vite
- TanStack Query
- Zustand
- Supabase Auth, PostgreSQL, RLS, RPC, Edge Functions
- Vercel serverless API routes
- Express server bundle for local/server fallback

## Important Runtime Paths

- `src/` - frontend app, routes, UI, hooks, state, Supabase client
- `api/` - Vercel API routes
- `server.ts` - local/server Express fallback
- `supabase/migrations/` - official schema/RPC/RLS migrations
- `supabase/functions/` - Supabase Edge Functions
- `scripts/copy-spa-fallback.mjs` - static SPA fallback generation
- `vercel.json` - Vercel rewrites, output directory, headers
- `vite.config.ts` - Vite config and base path handling

## Environment Variables

Frontend-safe variables:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Server-side only variables:

```bash
SUPABASE_SERVICE_ROLE_KEY=
```

Never expose service-role keys, database passwords, JWT secrets, access tokens, refresh tokens, or local `.env` files in frontend code, docs, commits, screenshots, or logs.

## Local Development

Install dependencies:

```bash
npm install
```

Run local development server:

```bash
npm run dev
```

Run production build:

```bash
npm run build
```

Run lint:

```bash
npm run lint
```

Preview a built Vite app locally:

```bash
npm run preview
```

## Deployment Notes

Vercel is the primary production deployment target.

Expected Vercel settings:

- Build command: `npm run build`
- Output directory: `dist`
- Production branch: `main`
- SPA rewrite: all app routes fall back to `index.html`

GitHub Pages support still exists for fallback/static testing through:

- `npm run build:pages`
- `.github/workflows/deploy.yml`

Do not remove GitHub Pages support until the owner explicitly approves that cleanup.

## Database And Migrations

Official database changes must go through:

```text
supabase/migrations/
```

Do not run SQL files from the repository root against production unless they have been reviewed and promoted into an official migration. Historical/debug SQL files are being archived under `docs/archive/legacy-sql/`.

## Cleanup And Architecture Reports

Current cleanup reports:

- `docs/architecture/CTO_CLEANUP_AUDIT.md`
- `docs/architecture/ROOT_SQL_CLEANUP_AUDIT.md`

Archived legacy material is kept under:

- `docs/archive/`
- `tools/debug-archive/`

## Safety Rules

- Do not commit `.env` files.
- Do not expose secrets in frontend code.
- Do not reset Supabase production without an approved recovery plan.
- Do not delete or move `src/`, `api/`, `server.ts`, `supabase/migrations/`, `supabase/functions/`, `vite.config.ts`, `vercel.json`, or `package*.json` during cleanup tasks.
- Production completion must be verified on Vercel, not only by local render checks.
