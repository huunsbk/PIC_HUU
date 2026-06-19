# Codex Commands

## Dependency And Build Checks

```powershell
npm install
npm run build
npm run lint
npm run typecheck
```

Note: only run `npm run lint` or `npm run typecheck` when the corresponding script exists in `package.json`.

## Architecture Gap Searches

```powershell
rg "EVENT_MANAGER" src
rg "supabase.from\('teams'\).*insert" src
rg "supabase.from\('matches'\).*insert" src
rg "supabase.from\('matches'\).*update" src
rg "supabase.from\('groups'\).*insert" src
rg "service_role|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|JWT_SECRET|refresh_token|access_token" .
```

## Safety Notes

- Do not print or commit secrets.
- Do not run reset migrations without explicit prompt approval.
- Do not delete `auth.users`.
- Keep or recreate at least one active `SUPER_ADMIN`.
