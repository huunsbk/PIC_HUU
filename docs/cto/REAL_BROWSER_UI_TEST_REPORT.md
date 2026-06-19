# Real Browser UI Render Test Report

Status: partially pass, with authenticated admin flows blocked by missing demo browser credentials.

Date: 2026-06-19

Scope:

- Verify the current `main` branch with a real Chrome browser, not only build/lint.
- Verify GitHub Pages and local preview routes render without a blank screen.
- Capture console/network evidence for runtime crashes.
- Check that legacy `#/11111111...` routing and `EVENT_MANAGER` references are not present in `src`.
- Do not run Prompt 08, reset database, or touch `auth.users`.

Environment:

| Item | Value |
|---|---|
| Branch | `main` |
| Local preview | `http://127.0.0.1:4173/PIC_HUU/` |
| Production | `https://huunsbk.github.io/PIC_HUU/` |
| Browser | Chrome 149 via Chrome DevTools Protocol |
| Vite base | `base: process.env.VERCEL ? '/' : '/PIC_HUU/'` |

Build and lint:

| Check | Result |
|---|---|
| `git pull --ff-only origin main` | PASS, already up to date |
| `npm run build` | PASS |
| `npm run lint` | PASS |

Static source checks:

| Check | Result |
|---|---|
| `rg "<Navigate\|Navigate " src` | PASS, `Navigate` is imported and used in fallback route |
| `rg "11111111-1111-1111-1111-111111111111" src` | PASS, no match |
| `rg "EVENT_MANAGER" src` | PASS, no match |
| `rg "account_event_permissions.*insert\|account_event_permissions.*delete" src` | PASS, no direct frontend insert/delete match |

Route render checks:

| Route | Local preview | Production | Result |
|---|---|---|---|
| `/PIC_HUU/` | Rendered app shell, not blank | Rendered app shell, not blank | PASS |
| `/PIC_HUU/admin/workspace/thang-oanh` | Rendered workspace guest shell, not blank | Rendered workspace guest shell, not blank | PASS |
| `/PIC_HUU/not-a-real-route` | React fallback redirected to `/PIC_HUU/`, not blank | GitHub Pages served fallback document with HTTP 404, then React rendered `/PIC_HUU/` without blank screen | PASS for UI render, note HTTP 404 document fallback |

Screenshots:

| Evidence | File |
|---|---|
| Local root | `docs/cto/screenshots/real-browser-ui-test/local-preview-root.png` |
| Local direct workspace | `docs/cto/screenshots/real-browser-ui-test/local-preview-workspace-direct.png` |
| Local fallback | `docs/cto/screenshots/real-browser-ui-test/local-preview-fallback-route.png` |
| Local auth modal | `docs/cto/screenshots/real-browser-ui-test/local-preview-auth-modal.png` |
| Production root | `docs/cto/screenshots/real-browser-ui-test/prod-root.png` |
| Production direct workspace | `docs/cto/screenshots/real-browser-ui-test/prod-workspace-direct.png` |
| Production fallback | `docs/cto/screenshots/real-browser-ui-test/prod-fallback-route.png` |

Console/runtime checks:

| Check | Result |
|---|---|
| `ReferenceError` | PASS, not observed |
| `TypeError` | PASS, not observed |
| `is not defined` | PASS, not observed |
| `Cannot read properties of undefined` | PASS, not observed |
| React crash / white screen | PASS, not observed on the tested local preview or production routes |
| `Navigate is not defined` | PASS, not observed |
| JS/CSS asset 404 | PASS, not observed |

Network observations:

- `/favicon.ico` returns 404 on root pages. This is not a JS/CSS asset failure and does not blank the app.
- Unauthenticated workspace route calls to Supabase returned 401/400 for workspace/event context. The app did not crash and rendered the guest shell.
- Production direct workspace route no longer returns the GitHub Pages blank 404 page; it renders the React app.

Guest UI checks:

| UI item | Result |
|---|---|
| Sidebar shell | PASS |
| `Bảng trình chiếu TV` menu | PASS |
| `Đăng nhập Admin` button | PASS |
| Auth modal open | PASS, username/password fields rendered |
| Route still uses `/admin/workspace/thang-oanh` and not legacy hash UUID | PASS |

Authenticated admin UI checks:

These checks were not marked pass because no demo admin credentials/session were provided in the repo or prompt. Without authentication the app intentionally exposes only the guest menu.

| Requested area | Status |
|---|---|
| `Tổng quan giải` | BLOCKED by missing authenticated admin session |
| `Quản lý đơn vị` | BLOCKED by missing authenticated admin session |
| `Quản lý giải đấu` | BLOCKED by missing authenticated admin session |
| `Nội dung thi đấu` | BLOCKED by missing authenticated admin session |
| `Quản lý đội` / `Đội thi đấu` | BLOCKED by missing authenticated admin session |
| `Chia bảng` | BLOCKED by missing authenticated admin session |
| `Lịch thi đấu & Nhập điểm` | BLOCKED by missing authenticated admin session |
| `Xếp hạng & Vào vòng trong` | BLOCKED by missing authenticated admin session |
| `Sơ đồ Knockout` | BLOCKED by missing authenticated admin session |
| Referee access modal | BLOCKED by missing authenticated admin session and demo tenant has no active REFEREE account |

Demo data status from Prompt 07-J:

| Event | Event id | Teams | Groups | Group matches | Scores | Knockout |
|---|---|---:|---:|---:|---|---|
| Đôi Nam | `evt_6da72de38f5c469d8e829348c92dfde2` | 16 | 4 | 24 | all group matches | bracket 8 created |
| Đôi Nữ | `evt_4b8ff313ce2c43fb8aa796cf6a9da464` | 8 | 2 | 12 | partial | not generated |
| Đôi Nam Nữ | `evt_86d3121231e2486c99590615a11d5407` | 8 | 2 | 12 | pending | not generated |

These counts are taken from `docs/cto/DEMO_E2E_07J_REPORT.md`; browser confirmation of these rows remains blocked until an authenticated demo admin session is available.

Guard checks:

| Guard | Status |
|---|---|
| No event selected add-team UI message | BLOCKED by missing authenticated admin session |
| RPC called with tournament id instead of event id | PASS from Prompt 07-J SQL negative test, blocked with `INVALID_CONTEXT` |
| RPC called with tenant id instead of event id | PASS from Prompt 07-J SQL negative test, blocked with `INVALID_CONTEXT` |
| `INVALID_CONTEXT` UI does not white-screen | BLOCKED for browser UI without authenticated session; SQL contract already passes |

Conclusion:

- Public/guest render and routing are stable in real Chrome for local preview and GitHub Pages.
- The GitHub Pages blank-screen issue and `Navigate is not defined` issue were not reproduced.
- Full admin menu/button E2E cannot be honestly completed until a valid demo admin login is provided.
- REFEREE E2E remains blocked because the demo tenant `CLB Thắng Oanh` has no active REFEREE account, and this prompt did not create or mutate `auth.users`.
