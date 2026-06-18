# Deployment Decision

## Current Status

Final deployment architecture is not yet locked.

## Option A: Static Frontend + Supabase Edge Functions

- Frontend can be deployed as static assets.
- Privileged operations move to Supabase Edge Functions.
- Supabase RPC/PostgreSQL/RLS remains the business logic and data protection layer.
- Works well with GitHub Pages or similar static hosting.

## Option B: Frontend + Node Server On Vercel/Render/Cloud Run

- Keeps the current `server.ts` Express-style backend path available.
- Requires hosting that can run a Node server.
- Privileged server-side operations can remain behind backend endpoints.

## Temporary Recommendation

Use static frontend + Supabase Edge Functions for privileged operations.

## Important Constraint

If GitHub Pages is used, `server.ts` as an Express server will not run there. GitHub Pages only serves static assets.
