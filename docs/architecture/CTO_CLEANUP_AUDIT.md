# CTO Cleanup Audit - PIC_HUU

## 1. Executive Summary

Repo PIC_HUU hien co runtime React/Vite + Supabase + Vercel dang hoat dong, nhung root repo con nhieu dau vet tu AI Studio, GitHub Pages, audit SQL, debug script, rollback va bao cao tam. Muc do no ky thuat ve sap xep file: **High**.

Ket luan an toan:

- **Vercel la production chinh**: `vercel.json` co `buildCommand`, `outputDirectory`, API rewrites va SPA fallback.
- **GitHub Pages van la legacy/fallback**: `.github/workflows/deploy.yml`, `build:pages`, `deploy`, `gh-pages`, va Vite base `/PIC_HUU/`.
- **AI Studio legacy van ro rang**: `README.md`, `.env.example`, `metadata.json`, dependency `@google/genai`, comment AI Studio trong `vite.config.ts`, va `app/applet/`.
- **Khong co file nao nen xoa ngay** trong dot audit nay. Nhieu file co the archive, nhung can lam theo PR rieng va test sau tung dot.
- **Critical risk** neu di chuyen/xoa nham `src/`, `api/`, `server.ts`, `vite.config.ts`, `vercel.json`, `package*.json`, `.github/workflows/`, `supabase/migrations/`, `supabase/functions/`.
- **High risk**: cac SQL/debug script nam o root co the bi nham la migration production; file `.env.db.local` ton tai o root nen phai tiep tuc giu ngoai commit va khong duoc in noi dung.

Khuyen nghi: giai doan tiep theo chi nen archive tai lieu/debug cu, khong xoa vat ly, khong sua runtime, va phai chay build/lint/Vercel Preview sau moi PR cleanup.

## 2. Current Architecture Snapshot

### Frontend

- React 19 + Vite + TypeScript.
- Entry runtime: `src/main.tsx`, `src/App.tsx`, `index.html`.
- UI nghiep vu nam chu yeu trong `src/components/`.
- Hooks du lieu/RPC nam trong `src/hooks/`.
- Supabase client va API wrapper nam trong `src/supabaseClient.ts`, `src/lib/api/`, `src/lib/auth/`, `src/lib/config/`.

### State management

- Zustand persist trong `src/store.ts`.
- TanStack Query dung trong cac hook nhu `useEvents`, `useMatches`, `useTeams`, `useGroups`, `useTournamentRpcMutations`.
- Co dau hieu state chuyen tiep: `activeTenantId`, `activeTournamentId`, `currentEventId`, `event-default`, `t-1`, legacy hash navigation helper, va Supabase/RPC state moi cung ton tai.

### API/backend

- `server.ts` la Express runtime local/server bundle, build ra `dist/server.cjs`.
- Vercel serverless API nam trong `api/admin/` va `api/public/`.
- Account management co ca Vercel API route va Supabase Edge Functions.

### Supabase

- Migration chinh thuc nam trong `supabase/migrations/`, dac biet `supabase/migrations/enterprise_completion_v1/`.
- Edge Functions nam trong `supabase/functions/`.
- Diagnostics, audit SQL, hotfix SQL da duoc tach vao `supabase/diagnostics/`, `supabase/audit/`, `supabase/hotfixes/`.
- Nhieu SQL cu van nam o root, can archive sau khi doi chieu voi migration chinh thuc.

### Deploy

- Vercel: `vercel.json` co `buildCommand: npm run build`, `outputDirectory: dist`, rewrite API va fallback `/(.*) -> /index.html`.
- Vite base: `base: process.env.VERCEL ? '/' : '/PIC_HUU/'`.
- GitHub Pages: workflow `.github/workflows/deploy.yml`, script `build:pages`, script `deploy: gh-pages -d dist`.

### Auth/permission

- Supabase auth + `accounts`, `roles`, `permissions`, `account_event_permissions`.
- Frontend co permission helper trong `src/lib/auth/` va runtime state permission trong `src/store.ts`.
- Backend/RPC migrations gan day da co event-scoped permission, live permission revocation, archived visibility va hard delete.

### Public/guest view

- Route React: `/tournament/:slug`.
- API public: `api/public/tournament-item.js`, `api/public/tournament/[slug].js`.
- Public snapshot migration: `025_public_tournament_snapshot.sql`.

## 3. Runtime Core Files

Nhung file/thuc muc sau dang anh huong truc tiep den web, build, API, Supabase hoac deploy. Khong di chuyen/xoa trong giai doan cleanup.

- `src/`: frontend, routing, UI, hooks, Supabase client, state, business UI.
- `api/`: Vercel serverless API cho account va public tournament.
- `server.ts`: Express backend local/server bundle, admin account route fallback.
- `index.html`: Vite HTML entry.
- `assets/`: asset static dang nam trong repo.
- `package.json`, `package-lock.json`: scripts, dependencies, build command.
- `vite.config.ts`: React/Tailwind plugin, alias, base path Vercel/GitHub Pages.
- `vercel.json`: Vercel build, output, API rewrites, SPA fallback, security headers.
- `.github/workflows/deploy.yml`: GitHub Pages fallback deploy.
- `scripts/copy-spa-fallback.mjs`: tao SPA fallback sau build.
- `scripts/supabase-sql-runner.mjs`: runner dang duoc package script `db:diagnose:team-tournament` goi.
- `supabase/migrations/`: migration/RPC/RLS chinh thuc.
- `supabase/functions/`: Edge Functions cho admin account operations.
- `tests/enterprise/`: SQL verification/seed test, khong runtime truc tiep nhung co gia tri kiem thu.
- `eslint.config.js`, `tsconfig.json`: lint/type/build config.
- `.env.example`: template env, khong chua secret that.
- `.gitignore`: dang ignore `*.log`, `.env*`, `.env.db.local`, `dist/`, `node_modules/`.

## 4. Deployment Conflict Review

### Vercel

Vercel dang la huong production chinh. Bang chung:

- `vercel.json` co `buildCommand: npm run build`.
- `vercel.json` co `outputDirectory: dist`.
- `vercel.json` rewrite:
  - `/api/admin/accounts` -> `/api/admin/accounts/index`
  - `/api/admin/accounts/:id` -> `/api/admin/account-item?id=:id`
  - `/api/public/tournament/:slug` -> `/api/public/tournament-item?slug=:slug`
  - `/(.*)` -> `/index.html`
- `vite.config.ts` dung `base: '/'` khi co `process.env.VERCEL`.

Risk: **Critical** neu sua/xoa `vercel.json`, `vite.config.ts`, `api/`, hoac `scripts/copy-spa-fallback.mjs` ma khong test Vercel Preview.

### GitHub Pages legacy/fallback

Bang chung:

- `.github/workflows/deploy.yml` deploy GitHub Pages khi push `main`.
- `package.json` co `build:pages`, `predeploy`, `deploy`.
- Dependency `gh-pages`.
- `vite.config.ts` fallback base `/PIC_HUU/`.
- Nhieu docs con link `https://huunsbk.github.io/PIC_HUU/`.

Ket luan: GitHub Pages nen xem la fallback/legacy. Chua nen xoa vi workflow van ton tai va co the dang duoc dung de du phong.

### AI Studio legacy

Bang chung:

- `README.md` con noi dung "Run and deploy your AI Studio app".
- `README.md` yeu cau `GEMINI_API_KEY`.
- `.env.example` con comment AI Studio va `GEMINI_API_KEY`.
- `metadata.json` co `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`.
- `package.json` co `@google/genai`.
- `vite.config.ts` co comment ve AI Studio HMR.
- `app/applet/` co `migration.sql`, `deployment_steps.txt`, `rollback_steps.txt`, `files_changed.txt`.

Ket luan: day la nhom archive candidate, nhung dependency/config chi duoc go bo trong PR rieng sau khi xac nhan khong con import runtime.

## 5. Supabase And RPC Review

### Khong an toan de xoa

- `supabase/migrations/enterprise_completion_v1/*.sql`
- `supabase/migrations/20260617_commercial_beta_v1_group_contracts.sql`
- `supabase/migrations/20260618_commercial_beta_v1_grouping_contract.sql`
- `supabase/migrations/phase_3a_index_hardening_v57_staging.sql`
- `supabase/functions/admin-create-account/`
- `supabase/functions/admin-update-account/`
- `supabase/functions/admin-delete-account/`
- `supabase/functions/admin-reset-account-password/`
- `supabase/functions/_shared/admin-account.ts`
- `supabase/hotfixes/`, `supabase/diagnostics/`, `supabase/audit/` nen giu den khi co quy trinh archive DB rieng.

### SQL root co dau hieu cu/tam

Root co nhieu file SQL nhu `migration*.sql`, `PHASE_*.sql`, `RLS_*.sql`, `debug_*.sql`, `rollback*.sql`, `supabase_*.sql`, `rpc_*.sql`, `performance_indexes.sql`, `production_verification.sql`. Chung khong nam trong `supabase/migrations/` va khong duoc `package.json`, `vite.config.ts`, `vercel.json`, `.github/workflows/` goi truc tiep trong pham vi kiem tra nay.

Khuyen nghi: **Archive truoc, khong xoa ngay**. Rieng cac SQL co ten `debug_`, `rollback_`, `bypass_` nen xep **High risk** neu de o root vi de bi chay nham vao production.

## 6. State Management Review

Bang chung co state chuyen tiep:

- `src/store.ts` dung Zustand persist.
- Co `activeTenantId`, `activeTournamentId`, `currentEventId`.
- Co `event-default`, `default`, `t-1`.
- Co helper legacy hash route trong `src/store.ts`.
- `src/App.tsx` da dung `BrowserRouter basename={import.meta.env.BASE_URL}` va route slug:
  - `/admin/workspaces`
  - `/admin/workspace/:slug`
  - `/tournament/:slug`
- Hooks moi da dung event-scoped IDs va query key theo event: `useEvents`, `useMatches`, `useTeams`, `useGroups`, `useMatchSets`.

Risk: **High** neu cleanup hoac refactor `store.ts` theo cam tinh. File nay dang gom legacy fallback va context moi, can task kien truc rieng neu muon tach.

Khuyen nghi: trong cleanup chi archive tai lieu/script. Khong sua state runtime.

## 7. Account And Permission Review

Bang chung:

- Frontend account UI: `src/components/AccountManager.tsx`.
- Frontend account API wrapper: `src/lib/api/adminAccounts.ts`.
- Local/server account route: `server.ts`.
- Vercel account API: `api/admin/accounts/index.js`, `api/admin/account-item.js`, `api/admin/accounts/reset.js`, `api/admin/_accountService.js`.
- Supabase Edge Functions: `admin-create-account`, `admin-update-account`, `admin-delete-account`, `admin-reset-account-password`.
- Permission runtime: `src/lib/auth/permissions.ts`, `src/lib/auth/livePermissions.ts`, `src/lib/auth/authorization.ts`, `src/store.ts`.
- Migration lien quan permission moi: `024_event_permission_tree_and_event_admin_accounts.sql`, `025_event_admin_default_event_permissions.sql`, `026_event_scoped_effective_permissions.sql`, `029_archived_admin_and_permission_session_invalidation.sql`, `030_enforce_live_permission_revocation.sql`, `031_enforce_event_permission_tree_operations.sql`.

Dau hieu con lan model:

- `src/lib/auth/usePermission.ts` van co role-based helper don gian.
- `src/store.ts` co permission array va event permission map.
- Docs cu co `EVENT_MANAGER`, `11111111...`, account SQL cu, enterprise account audit cu.

Risk: **High** neu xoa docs/SQL cu ma chua doi chieu migration, vi co the mat lich su quyet dinh bao mat. Nen archive vao nhom security/account legacy truoc.

## 8. File Classification Table

| Path | Group | Reason | Evidence checked | Risk if moved/deleted | Recommendation |
|---|---|---|---|---|---|
| `src/` | A. KEEP_RUNTIME_CORE | Frontend runtime, routes, UI, hooks, Supabase client, Zustand/TanStack state | `rg --files`, route/import search, Vite entry | Critical: web blank, business flows fail | Do not touch in cleanup |
| `api/` | A. KEEP_RUNTIME_CORE | Vercel serverless routes for accounts/public tournament | `vercel.json` rewrites, `rg api/admin/accounts` | Critical: account/public API fail | Do not touch in cleanup |
| `server.ts` | A. KEEP_RUNTIME_CORE | Express server bundle and local admin route fallback | `package.json build/start`, service-role env references | High/Critical: local backend/admin fallback fail | Do not touch in cleanup |
| `index.html` | A. KEEP_RUNTIME_CORE | Vite HTML entry | Vite standard entry, repo structure | Critical: app build/render fail | Keep |
| `assets/` | A. KEEP_RUNTIME_CORE | Static assets in repo | Directory present, asset risk not fully traced | Medium: missing UI media | Keep until asset audit |
| `src/lib/api/tournamentRpc.ts`, `src/hooks/useTournamentRpcMutations.ts` | A. KEEP_RUNTIME_CORE | RPC business calls | Source structure and RPC references | Critical: teams/groups/scores/KO fail | Do not touch in cleanup |
| `src/lib/api/adminAccounts.ts` | A. KEEP_RUNTIME_CORE | Frontend account create/update/delete/reset API bridge | `rg api/admin/accounts`, Edge Function refs | Critical: account management fail | Do not touch in cleanup |
| `src/store.ts` | A. KEEP_RUNTIME_CORE | Central persisted app state and permission checks | `rg activeTenantId/currentEventId/initSupabase` | Critical: login/workspace/event context fail | Do not touch; refactor only later |
| `package.json`, `package-lock.json` | B. KEEP_CONFIG_DEPLOY | Scripts/dependencies/build/deploy | Read directly | Critical: build/deploy dependency drift | Do not edit in audit |
| `vite.config.ts` | B. KEEP_CONFIG_DEPLOY | Base path Vercel/GitHub Pages, React/Tailwind plugins | Read directly | Critical: asset paths break | Do not edit in audit |
| `vercel.json` | B. KEEP_CONFIG_DEPLOY | Production rewrites, headers, output dir | Read directly | Critical: SPA/API routes break | Do not edit in audit |
| `.github/workflows/deploy.yml` | B. KEEP_CONFIG_DEPLOY | GitHub Pages fallback deploy | Read directly | Medium/High: fallback deploy broken | Keep until legacy decision |
| `scripts/copy-spa-fallback.mjs` | B. KEEP_CONFIG_DEPLOY | Called by build/build:pages | `package.json` scripts | High: SPA refresh fallback breaks | Keep |
| `scripts/supabase-sql-runner.mjs` | B. KEEP_CONFIG_DEPLOY | Called by `db:diagnose:team-tournament` | `package.json` scripts | Medium: diagnostics script breaks | Keep |
| `supabase/migrations/` | B. KEEP_CONFIG_DEPLOY | Official schema/RPC/RLS history | `rg --files`, migration listing | Critical: DB history/RPC contract lost | Never move/delete in cleanup |
| `supabase/functions/` | B. KEEP_CONFIG_DEPLOY | Admin account Edge Functions | File listing and account search | Critical: account admin flows fail | Keep |
| `.env.example` | B. KEEP_CONFIG_DEPLOY | Env template, but contains AI Studio legacy + service role placeholder | Read directly, no secrets | Medium: onboarding confusion | Keep now; clean in PR rieng |
| `.env.db.local` | B. KEEP_CONFIG_DEPLOY | Local sensitive env file | File exists; `.gitignore` ignores `.env*` | Critical if committed/leaked | Do not read, do not commit |
| `.gitignore` | B. KEEP_CONFIG_DEPLOY | Protects env/log/dist/node_modules | Read directly | High if changed incorrectly | Keep |
| `eslint.config.js`, `tsconfig.json` | B. KEEP_CONFIG_DEPLOY | Lint/type config | File listing, package scripts | High: lint/build drift | Keep |
| `tests/enterprise/` | C. KEEP_DOCS_CURRENT | SQL seed/verification history for enterprise prompts | File listing | Medium: lose reproducible checks | Keep; later reorganize under tests |
| `docs/cto/PROJECT_CURRENT_STATUS.md` | C. KEEP_DOCS_CURRENT | Current project status history | `rg` evidence | Medium: lose operational context | Keep |
| `docs/cto/IMPLEMENTATION_REPORT.md` | C. KEEP_DOCS_CURRENT | Main implementation record | `rg` evidence | Medium: lose handoff history | Keep |
| `docs/cto/VERCEL_PRIMARY_DEPLOYMENT_REPORT.md` | C. KEEP_DOCS_CURRENT | Vercel production decision evidence | `rg VERCEL` | Medium: deployment confusion | Keep |
| `docs/audit/**/PRODUCTION_E2E_REPORT.md` | C. KEEP_DOCS_CURRENT | Production E2E evidence | File listing | Medium: lose test evidence | Keep current reports |
| `docs/cto/screenshots/` | C. KEEP_DOCS_CURRENT | Visual evidence for browser tests | File listing | Low/Medium: lose QA evidence | Keep or archive later by date |
| `README.md` | D. ARCHIVE_CANDIDATE | AI Studio README, not current product handoff | Read directly | Medium if removed without new README | Replace later, archive old content |
| `metadata.json` | D. ARCHIVE_CANDIDATE | AI Studio capability metadata | `rg GEMINI`, file listing | Low/Medium: unknown AI Studio tooling only | Archive after confirming not imported |
| `app/applet/` | D. ARCHIVE_CANDIDATE | AI Studio/old applet migration/deploy notes | File listing, no package script reference | Low/Medium | Archive to `docs/archive/ai-studio/` |
| Root `*_AUDIT*.txt`, `*_REPORT*.md`, `*_COMPLETION.txt`, `*_PLAN.txt` | D. ARCHIVE_CANDIDATE | Old reports scattered at root | File listing, no runtime import pattern | Medium: lose history if deleted | Move to docs/archive after approval |
| Root security reports `COMPLETE_SECURITY_AUDIT_REPORT*.md`, `DATABASE_HARDENING_REPORT_V5.7.md`, `security_report*.md` | D. ARCHIVE_CANDIDATE | Security docs should not live at root | File listing | High if deleted before archive | Archive under security-audits |
| Root account/enterprise text SQL docs `ENTERPRISE_*`, `ROLE_*`, `PERMISSION_*`, `TENANT_*` | D. ARCHIVE_CANDIDATE | Historical architecture/security artifacts | File listing, search evidence | High if deleted; may contain design history | Archive, then compare to migrations |
| Root migration SQL `migration*.sql`, `enterprise_v*.sql`, `final_architecture_updates.sql` | D. ARCHIVE_CANDIDATE | SQL outside official migration folder | File listing; package/workflow not calling | High: could be old prod changes | Archive only after DB diff |
| Root RLS/phase SQL `RLS_*.sql`, `PHASE_*.sql`, `performance_indexes.sql`, `proposed_hardening_indexes_v5.7.sql` | D. ARCHIVE_CANDIDATE | Security/index SQL outside migration folder | File listing; not official path | High: may document DB hardening | Archive; do not delete |
| Root rollback SQL/text `rollback*.sql`, `rollback_steps.txt` | D. ARCHIVE_CANDIDATE | Rollback history, not runtime | File listing | Medium/High: dangerous if run wrong; risky if deleted | Archive under legacy-sql/rollback |
| Root debug SQL `debug_*.sql`, `bypass_user_limit.sql`, `verification_phase5.sql`, `production_verification.sql` | D. ARCHIVE_CANDIDATE | Manual diagnostic SQL | File listing | High if executed accidentally | Archive away from root |
| Root debug scripts `query*.js/ts`, `check_*.js/ts`, `test_*.js`, `fix_score.js`, `score_entry_fix.js`, `ui_fix.js`, `replace*.js`, `sed.js`, `strip.js` | E. DELETE_CANDIDATE_AFTER_TEST | Ad hoc tools not referenced by package scripts | File listing; package scripts checked | Medium: may still be useful manual tools | Archive first; delete only after test/approval |
| Root `apply_sql.ts`, `exec_sql.js`, `fetch_schema.js`, `build_txt.ts` | E. DELETE_CANDIDATE_AFTER_TEST | Manual DB/code generation helpers at root | File listing; not package scripts | High if secrets/env used; Medium if useful | Archive to tools/debug-archive before deletion |
| Root logs `.codex-*.log`, `preview.*.log` | E. DELETE_CANDIDATE_AFTER_TEST | Generated logs, `.gitignore` ignores `*.log` | `.gitignore`, file listing | Low if deleted; no runtime use | Delete after owner approval |
| `dist/` | E. DELETE_CANDIDATE_AFTER_TEST | Generated build output | `.gitignore`, package build output | Low locally; Critical if used as manual deploy artifact | Do not commit; can clean after rebuild |
| `node_modules/` | E. DELETE_CANDIDATE_AFTER_TEST | Local dependency install output | `.gitignore`, package manager standard | Low; can reinstall | Never commit; no archive needed |
| `tong_hop_code_pickleball.txt` | E. DELETE_CANDIDATE_AFTER_TEST | Large code dump with old GitHub Pages/hash/service_role text | `rg` evidence | Medium: may expose obsolete patterns | Archive then delete after approval |
| `schema_openapi.json`, `schema_report.md`, `SUPABASE_SCHEMA_REFERENCE.sql` | D. ARCHIVE_CANDIDATE | Schema snapshots/reports outside docs | File listing | Medium: useful for audit history | Archive under schema-snapshots |

## 9. Archive Plan

De xuat cay archive, chi thuc hien sau khi chu du an duyet PR rieng:

```text
docs/archive/
  ai-studio/
    README_AI_STUDIO_LEGACY.md
    metadata.json
    app-applet/
  legacy-reports/
    enterprise/
    account-permission/
    rls-security/
    deployment/
  security-audits/
  legacy-sql/
    migrations-root/
    rollback/
    rls/
    phase-sql/
  debug-sql/
  schema-snapshots/
tools/debug-archive/
  root-js-ts-tools/
```

Nguyen tac archive:

1. Khong archive `src/`, `api/`, `server.ts`, `package*.json`, `vite.config.ts`, `vercel.json`, `.github/workflows/`, `supabase/migrations/`, `supabase/functions/`.
2. Moi PR chi archive mot nhom nho.
3. Sau moi PR phai chay `npm run build`, `npm run lint`, va test Vercel Preview.
4. Khong xoa vat ly truoc khi archive va test it nhat mot vong.

## 10. Do Not Touch List

Tuyet doi khong di chuyen/xoa trong giai doan cleanup:

- `src/`
- `api/`
- `server.ts`
- `index.html`
- `assets/`
- `package.json`
- `package-lock.json`
- `vite.config.ts`
- `vercel.json`
- `.github/workflows/`
- `scripts/copy-spa-fallback.mjs`
- `scripts/supabase-sql-runner.mjs`
- `supabase/migrations/`
- `supabase/functions/`
- `supabase/hotfixes/`
- `supabase/diagnostics/`
- `supabase/audit/`
- `tests/enterprise/`
- `.env.example`
- `.env.db.local`
- `.gitignore`
- `tsconfig.json`
- `eslint.config.js`

## 11. Safe Cleanup Roadmap

### Phase 1: Audit only

Trang thai hien tai. Chi tao bao cao nay. Khong sua runtime/config/schema.

### Phase 2: Archive docs/debug only

Tao PR archive cac report root, AI Studio README/metadata/app-applet, log va debug script. Khong xoa. Chay build/lint/Vercel Preview.

### Phase 3: Disable legacy deploy if approved

Neu chu du an xac nhan GitHub Pages khong con dung, tao PR rieng de vo hieu hoa hoac archive workflow GitHub Pages. Khong lam cung Phase 2.

### Phase 4: Remove dead scripts after test

Sau khi archive va chay on dinh, moi xoa cac script root khong duoc package/workflow/import goi. Moi file xoa can co bang chung rieng.

### Phase 5: Refactor architecture only after stable E2E

Tach legacy state trong `src/store.ts`, chuan hoa account permission model, va thay README AI Studio bang README production. Day la task kien truc, khong phai cleanup file.

## 12. Recommended Next PR

PR tiep theo nen la:

**`chore: archive legacy reports and root debug artifacts`**

Pham vi de xuat:

- Tao `docs/archive/legacy-reports/`.
- Chuyen cac root report `.txt/.md` cu vao archive.
- Chuyen `app/applet/` va `metadata.json` vao `docs/archive/ai-studio/`.
- Chuyen root debug script `query*.js/ts`, `check_*.js/ts`, `test_*.js`, `replace*.js`, `sed.js`, `strip.js`, `ui_fix.js` vao `tools/debug-archive/`.
- Chua xoa SQL root trong PR dau tien; chi lap danh sach doi chieu voi `supabase/migrations/`.
- Chay `npm run build`, `npm run lint`, test Vercel Preview.

Ly do: day la PR co rui ro thap nhat, giam roi mat cho chu du an, nhung khong cham runtime/deploy/database.
