# Content PDF Requirements - Production E2E Report

Date: 2026-06-26

## Target

- Production URL: https://giai-dau-pickleball.vercel.app/
- Vercel deployment URL: pending after main deploy
- Production commit SHA: pending after merge/deploy
- Supabase project URL: https://ykckqcykxfhpfqptckxk.supabase.co

## Current Status

CHUA DAT BAN GIAO PRODUCTION

Reason: code and database changes are implemented and locally built, but production Vercel deployment and full role E2E are not completed yet.

## Local / Pre-Deploy Checks

- `npm run build`: PASS
- `npm run lint`: PASS
- Supabase migration apply: PASS
- RPC signature verification: PASS
- `src` legacy scan for `EVENT_MANAGER` and `11111111-1111-1111-1111-111111111111`: no matches

## Production Menu Test

Pending after production deploy:

- Root route `/`
- Direct workspace route `/admin/workspace/thang-oanh`
- Tổng quan giải
- Quản lý đội
- Chia bảng
- Nhập điểm
- Lịch & Kết quả
- Xếp hạng & Vào vòng trong
- Sơ đồ Knockout
- Nội dung thi đấu
- Quản lý tài khoản

## Console / Network

Pending after production deploy.
