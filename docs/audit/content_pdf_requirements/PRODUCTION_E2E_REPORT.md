# Content PDF Requirements - Production E2E Report

Date: 2026-06-26

## Target

- Production URL: https://giai-dau-pickleball.vercel.app/
- Vercel deployment URL verified: https://giai-dau-pickleball-8hrltwaal-huunsbks-projects.vercel.app
- Application commit verified: `bc30bf9`
- Supabase project URL: https://ykckqcykxfhpfqptckxk.supabase.co

## Build / Static Checks

- `npm run lint`: PASS
- `npm run build`: PASS
- `VERCEL=1 npm run build`: PASS
- `npm test`: no test script
- `git diff --check` excluding out-of-scope `SECURITY_REPORT_V2.md`: PASS
- `rg "EVENT_MANAGER|11111111-1111-1111-1111-111111111111" src`: no matches
- Secret scan: no committed secret values found; only server-side variable names and password field names appear.

## Production Route Checks

| Check | Result |
| --- | --- |
| Root/workspace app renders | PASS |
| Direct route `/admin/workspace/thang-oanh` | PASS |
| Guest/public workspace context after switching routes | PASS: shows `CLB Thắng Oanh`, not stale `pic_cocdan` |
| Assets use `/assets/...`, not `/PIC_HUU/assets/...` on Vercel | PASS |
| Console blocking errors | PASS, none observed |
| ReferenceError / Navigate / chunk-load errors | PASS, none observed |

## Production UI Checks

| Area | Result |
| --- | --- |
| Header after login | PASS: shows `Root Administrator`, role, tournament, tenant |
| Tenant header | PASS: shows `CLB Thắng Oanh` after context/auth load |
| Dashboard organization field | PASS: `Đơn Vị Chủ Trì (BTC)` is disabled/readOnly and set to `CLB Thắng Oanh` |
| Ranking | PASS: `Séc` column visible with set-diff values |
| Score Entry | PASS: table shows `STT`, `Team A`, `Séc 1`, `Séc 2`, `Séc 3`, `Group`, `Team B`, set columns |
| Tournament Management | PASS: grouped by tenant names, active CLB Thắng Oanh group visible |
| Event Management | PASS: table has `STT`, `Đơn vị quản lý`, `Giải đấu`, `Nội dung thi đấu`, `Chức năng` |
| Knockout Bracket | PASS: primary lines use `Hạng 1 bảng ...` / `Hạng 2 bảng ...`, team names are secondary |
| Clear bracket action | PASS render: `XÓA SƠ ĐỒ` visible; destructive confirmation not executed |

## Production Data Notes

- Đôi Nam active KO labels verified in DB and UI:
  - `Hạng 1 bảng A/B/C/D`
  - `Hạng 2 bảng A/B/C/D`
- Archived legacy tournaments can show `Chưa rõ đơn vị`; active tenant groups display names correctly.

## Conclusion

Production smoke test passed for the implemented PDF requirements without blocking console/network errors.
