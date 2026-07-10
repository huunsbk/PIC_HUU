# Edge Function Canonical Backend Audit V1

Ngay audit: 2026-07-05
Pham vi: static audit repo `huunsbk/PIC_HUU`.
Ket luan kien truc: Vercel API `/api/admin/**` la backend canonical cho account admin production.

Rang buoc da tuan thu:

- Khong sua code.
- Khong xoa Edge Function.
- Khong deploy.
- Khong sua database.
- Khong tao migration.
- Khong merge main.
- Khong lam Phase 2-6.

Ghi chu trang thai checkout: audit duoc thuc hien tren branch co PR-SEC-01 dang mo, nen `api/admin/accounts/reset.js` va `supabase/functions/admin-reset-account-password/index.ts` da co hardening reset password trong branch hien tai. Ket luan canonical van khong doi: production account admin phai di qua Vercel API.

## Executive Conclusion

He thong hien co hai backend cho account admin:

1. Vercel API:
   - `api/admin/accounts/index.js`
   - `api/admin/accounts/[id].js`
   - `api/admin/accounts/reset.js`
   - `api/admin/_accountService.js`

2. Supabase Edge Functions:
   - `supabase/functions/admin-create-account`
   - `supabase/functions/admin-update-account`
   - `supabase/functions/admin-delete-account`
   - `supabase/functions/admin-reset-account-password`
   - `supabase/functions/_shared/admin-account.ts`

Production tren Vercel dang dung Vercel API la canonical. Edge Functions account admin chi con duong fallback cho `huunsbk.github.io` trong `src/lib/api/adminAccounts.ts`. Day la rui ro kien truc: hai backend co logic role/scope/delete/audit khac nhau.

Ket luan:

- Khong nen duy tri Supabase Edge Functions account admin nhu backend song song.
- Nen vo hieu hoa frontend fallback Edge Function cho account admin.
- Neu bat buoc giu GitHub Pages/static fallback, Edge Functions phai duoc dong bo 100% policy voi Vercel API va duoc test nhu production.
- Edge Function nguy hiem nhat can vo hieu hoa dau tien: `admin-delete-account`, vi hard-delete `accounts` va `auth.users`, trong khi Vercel API soft-delete account.

## Noi Goi Edge Functions

| Noi goi | Function | Dieu kien goi | Phan loai |
| --- | --- | --- | --- |
| `src/lib/api/adminAccounts.ts:58` | generic `supabase.functions.invoke(functionName)` | chi qua `invokeAdminFunction` | legacy/fallback |
| `src/lib/api/adminAccounts.ts:43` | `shouldUseSupabaseFunction()` | `window.location.hostname === 'huunsbk.github.io'` | GitHub Pages fallback |
| `src/lib/api/adminAccounts.ts:76` | `admin-create-account` | GitHub Pages only | trung Vercel `POST /api/admin/accounts` |
| `src/lib/api/adminAccounts.ts:99` | `admin-update-account` | GitHub Pages only | trung Vercel `PUT /api/admin/accounts/:id` |
| `src/lib/api/adminAccounts.ts:122` | `admin-delete-account` | GitHub Pages only | trung Vercel `DELETE /api/admin/accounts/:id`, nguy hiem |
| `src/lib/api/adminAccounts.ts:141` | `admin-reset-account-password` | GitHub Pages only | trung Vercel `POST /api/admin/accounts/reset` |

Khong tim thay `/functions/v1/` hardcoded trong `src`, `api`, `supabase` ngoai tai lieu.

## Danh Sach Edge Functions

| Edge Function | File | Chuc nang | Frontend goi? | Trang thai de xuat |
| --- | --- | --- | --- | --- |
| `_shared/admin-account.ts` | `supabase/functions/_shared/admin-account.ts` | shared auth/CORS/role validation cho Edge account admin | gian tiep | legacy shared, can disable hoac sync neu giu Edge |
| `admin-create-account` | `supabase/functions/admin-create-account/index.ts` | tao Supabase Auth user + insert `accounts` | co, GitHub Pages fallback | trung Vercel API, nen disable fallback |
| `admin-update-account` | `supabase/functions/admin-update-account/index.ts` | update metadata/password/role/status/account | co, GitHub Pages fallback | trung Vercel API, logic lech, nen disable fallback |
| `admin-delete-account` | `supabase/functions/admin-delete-account/index.ts` | xoa active_sessions/login_logs/permissions, delete `accounts`, delete Auth user | co, GitHub Pages fallback | nguy hiem, can vo hieu hoa uu tien |
| `admin-reset-account-password` | `supabase/functions/admin-reset-account-password/index.ts` | reset password target | co, GitHub Pages fallback | trung Vercel API, chi giu neu sync/test day du |

## So Sanh Vercel API vs Edge Functions

### Shared Actor Policy

Vercel API:

- `api/admin/_accountService.js:80` cho `SUPER_ADMIN`, `TENANT_ADMIN`, `EVENT_ADMIN` vao account admin backend.
- Co helper `actorCanManageReferees` va `ensureEventAdminCanManageTargetAccount`.
- `EVENT_ADMIN` duoc tao/cap nhat/xoa mem REFEREE trong scope `manage_referees`.
- Co tenant active/subscription/usage checks.

Edge Functions:

- `supabase/functions/_shared/admin-account.ts:78` chi cho `SUPER_ADMIN`, `TENANT_ADMIN`.
- Khong co helper tuong duong `ensureEventAdminCanManageTargetAccount`.
- Khong co quota/subscription/tenant status checks day du nhu Vercel API.
- CORS cho `origin.endsWith('.vercel.app')`, trong khi Edge account admin khong phai backend production canonical.

Rui ro: cung mot UI account admin nhung hanh vi khac nhau giua Vercel va GitHub Pages/static fallback.

### Create Account

Vercel API:

- `api/admin/accounts/index.js`
- Dung `validateTargetAccount` trong Vercel shared helper.
- Ghi `created_by_account_id: actor.id`.
- Co audit `account.create`.
- Neu insert fail, delete Auth user vua tao de rollback.

Edge Function:

- `supabase/functions/admin-create-account/index.ts`
- Dung Edge shared `validateTargetAccount`.
- Khong ghi `created_by_account_id`.
- Khong audit create.
- Existing username query khong filter `deleted_at IS NULL`.
- Khong ho tro `EVENT_ADMIN` create REFEREE theo scope vi shared actor chi cho SUPER/TENANT.

Phan loai: trung chuc nang, logic lech.

### Update Account

Vercel API:

- `api/admin/accounts/[id].js`
- Cho `PUT/POST`.
- `TENANT_ADMIN` bi chan cross tenant.
- `EVENT_ADMIN` phai qua `ensureEventAdminCanManageTargetAccount`.
- `validateTargetAccount` chan role/scope/usage.
- Audit `account.update`.

Edge Function:

- `supabase/functions/admin-update-account/index.ts`
- Cho `POST/PUT`.
- Chi SUPER/TENANT actor.
- Khong filter `deleted_at IS NULL` khi load target.
- Khong audit update.
- Khong invalidate session khi status/role/tenant doi.
- Khong ho tro EVENT_ADMIN manage REFEREE.

Phan loai: trung chuc nang, logic lech.

### Delete Account

Vercel API:

- `api/admin/accounts/[id].js`
- `DELETE` la soft-delete: set `status='inactive'`, `deleted_at=now()`.
- Xoa `active_sessions`, `login_logs`, `account_permissions`; soft-delete `account_event_permissions`.
- Chan self-delete.
- Chan xoa SUPER_ADMIN cuoi cung.
- Cho `EVENT_ADMIN` xoa/khoa REFEREE trong scope qua helper.
- Audit `account.archive`.

Edge Function:

- `supabase/functions/admin-delete-account/index.ts`
- Chi SUPER_ADMIN.
- Hard-delete `active_sessions`, `login_logs`, `account_permissions`, `account_event_permissions`.
- Hard-delete row `accounts`.
- Delete Supabase Auth user bang `admin.auth.admin.deleteUser`.
- Chan target SUPER_ADMIN, nhung khong co soft-delete/restore path.
- Khong audit.

Phan loai: nguy hiem va lech canonical. Can vo hieu hoa dau tien.

### Reset Password

Vercel API:

- `api/admin/accounts/reset.js`
- Tren branch PR-SEC-01 da khoa scope: SUPER_ADMIN, TENANT_ADMIN chi role con, EVENT_ADMIN chi REFEREE trong scope.
- Xoa `active_sessions` cua target.
- Audit allow/deny khong ghi password/token.

Edge Function:

- `supabase/functions/admin-reset-account-password/index.ts`
- Tren branch PR-SEC-01 da khoa mot phan cho SUPER/TENANT va audit.
- Van khong ho tro EVENT_ADMIN manage REFEREE vi Edge shared actor khong cho EVENT_ADMIN.
- Van la backend song song/fallback, can disable hoac sync neu bat buoc giu GitHub Pages.

Phan loai: trung chuc nang, da giam rui ro trong PR-SEC-01 nhung van khong nen song song.

## Rui Ro Chinh

| Muc | Rui ro | Bang chung | Tac dong |
| --- | --- | --- | --- |
| P0 | Edge `admin-delete-account` hard-delete account/Auth user, lech Vercel soft-delete. | `supabase/functions/admin-delete-account/index.ts:53`, `:59`; Vercel soft delete `api/admin/accounts/[id].js:135` | Mat du lieu tai khoan/Auth user khong de restore, pha audit/van hanh giai that |
| P1 | Frontend van co fallback Edge Function cho account admin khi hostname la `huunsbk.github.io`. | `src/lib/api/adminAccounts.ts:43`, `:58`, `:76`, `:99`, `:122`, `:141` | Neu GitHub Pages duoc dung lai, account admin chay qua backend lech policy |
| P1 | Edge shared auth policy khong dong bo Vercel API, khong cho EVENT_ADMIN flow. | `supabase/functions/_shared/admin-account.ts:78`; Vercel `api/admin/_accountService.js:80` | Cung vai tro nhung production/fallback hanh vi khac nhau |
| P1 | Edge create/update thieu audit va metadata quan trong. | `supabase/functions/admin-create-account/index.ts`, `admin-update-account/index.ts` | Kho truy vet ai tao/sua account khi fallback duoc dung |
| P1 | Edge CORS cho moi `.vercel.app`. | `supabase/functions/_shared/admin-account.ts:14` | Neu Edge con deploy, surface goi rong hon can thiet |
| P2 | Tai lieu cu van huong dan deploy Edge account admin. | `docs/cto/VERCEL_PRIMARY_DEPLOYMENT_REPORT.md`, `docs/cto/ACCOUNT_CREATION_AUDIT_REPORT.md` | Nguoi van hanh co the kich hoat lai fallback sai chuan |

## Ket Luan Canonical

Backend canonical cho account admin production la:

- `POST /api/admin/accounts`
- `PUT /api/admin/accounts/:id`
- `DELETE /api/admin/accounts/:id`
- `POST /api/admin/accounts/reset`

Supabase Edge Functions account admin khong nen la backend active/fallback cho production. Neu can giu file trong repo tam thoi, phai:

- Khong duoc frontend production goi.
- Khong duoc docs hien tai huong dan deploy nhu production path.
- Co test khang dinh Vercel API la duong duy nhat cho account admin tren Vercel.

## Edge Function Can Vo Hieu Hoa

Thu tu uu tien:

1. `admin-delete-account`
   - Ly do: hard-delete `accounts` va `auth.users`.
   - De xuat: frontend khong bao gio goi; Edge Function return 410 Gone neu deploy; hoac remove deploy secret/route sau khi co rollback.

2. `admin-update-account`
   - Ly do: cap nhat role/status/password nhung policy/audit/session lech Vercel.
   - De xuat: disable hoac proxy ve Vercel API neu bat buoc.

3. `admin-create-account`
   - Ly do: thieu `created_by_account_id`, audit, EVENT_ADMIN scope.
   - De xuat: disable fallback; chuyen docs sang Vercel API only.

4. `admin-reset-account-password`
   - Ly do: da harden trong PR-SEC-01 branch nhung van song song/lekhong ho tro EVENT_ADMIN flow nhu Vercel.
   - De xuat: disable fallback hoac sync 100%.

## Frontend Route Can Chuyen

`src/lib/api/adminAccounts.ts` can duoc sua trong PR nho sau audit:

- Xoa `shouldUseSupabaseFunction`.
- Xoa `invokeAdminFunction` cho account admin.
- Moi action account admin luon fetch Vercel API:
  - `createAdminAccount` -> `/api/admin/accounts`
  - `updateAdminAccount` -> `/api/admin/accounts/:id`
  - `deleteAdminAccount` -> `/api/admin/accounts/:id`
  - `resetAdminAccountPassword` -> `/api/admin/accounts/reset`
- Neu hostname khong phai Vercel va khong co API route, hien loi ro: "Account admin requires Vercel backend".

## De Xuat PR Nho

### PR-EDGE-01: Disable frontend Edge fallback

Pham vi:

- `src/lib/api/adminAccounts.ts`
- Khong xoa Edge Function file.
- Khong migration.
- Khong DB.

Noi dung:

- Account admin always uses Vercel API.
- Remove `supabase.functions.invoke` path for account admin.
- Add explicit error if running on static host without `/api/admin`.

Test:

- Vercel Preview create/update/delete/reset calls `/api/admin/...`.
- GitHub Pages/static host does not call Edge Function; shows unsupported backend message.

### PR-EDGE-02: Quarantine Edge account functions

Pham vi:

- `supabase/functions/admin-*/index.ts`
- Option A: return `410 Gone` with message "Use Vercel API canonical backend".
- Option B: keep code but require env flag `ENABLE_LEGACY_ACCOUNT_EDGE_FUNCTIONS=true`, default disabled.

Khuyen nghi: Option B neu can rollback an toan; Option A neu da chac chan khong dung GitHub Pages account admin.

### PR-EDGE-03: Docs cleanup

Pham vi:

- Docs account creation/deployment docs.

Noi dung:

- Ghi ro Vercel API canonical.
- Edge account admin legacy only, not production.
- Khong huong dan deploy Edge account admin nhu production path.

### PR-EDGE-04: Optional sync if must keep Edge

Chi lam neu co ly do bat buoc giu GitHub Pages account admin:

- Port Vercel `_accountService.js` policy sang Edge shared.
- Sync create/update/delete/reset behavior.
- Delete Edge hard-delete path, thay bang soft-delete.
- Add audit/session invalidation parity.
- Full role test matrix.

## Thu Tu Xu Ly De Xuat

1. Merge/test PR-SEC-01 reset password scope.
2. PR-EDGE-01: frontend account admin always Vercel API.
3. PR-EDGE-02: disable/quarantine Edge account functions, uu tien `admin-delete-account`.
4. PR-EDGE-03: cleanup docs de tranh deploy nham Edge.
5. Chi neu bat buoc: PR-EDGE-04 sync Edge logic voi Vercel.

## Rollback Note

Rollback PR-EDGE-01:

- Restore `shouldUseSupabaseFunction` va `invokeAdminFunction` neu can cap cuu GitHub Pages.
- Khong anh huong database.

Rollback PR-EDGE-02:

- Neu dung env flag, set `ENABLE_LEGACY_ACCOUNT_EDGE_FUNCTIONS=true` tam thoi.
- Neu return 410, revert Edge Function commit va redeploy.
- Khong rollback bang cach hard-delete/restore DB.

Rollback PR-EDGE-03:

- Revert docs only.

Nguyen tac rollback: khong bao gio rollback sang Edge `admin-delete-account` hard-delete tren production neu chua co xac nhan rieng.

## Test Matrix

| Ma test | Muc tieu | Moi truong | Ket qua mong doi |
| --- | --- | --- | --- |
| EDGE-001 | Static scan Edge invoke | repo | Khong con `supabase.functions.invoke` trong account admin frontend sau PR-EDGE-01 |
| EDGE-002 | Vercel create account | Vercel Preview | Network goi `POST /api/admin/accounts`, khong goi Edge |
| EDGE-003 | Vercel update account | Vercel Preview | Network goi `PUT /api/admin/accounts/:id`, khong goi Edge |
| EDGE-004 | Vercel delete account | Vercel Preview | Network goi `DELETE /api/admin/accounts/:id`, soft-delete, khong hard-delete Auth user |
| EDGE-005 | Vercel reset password | Vercel Preview | Network goi `POST /api/admin/accounts/reset`, dung scope PR-SEC-01 |
| EDGE-006 | GitHub Pages/static account admin | GitHub Pages/static | Khong goi Edge Function; hien loi backend khong ho tro hoac redirect ve Vercel |
| EDGE-007 | Direct Edge admin-delete-account | Supabase Function endpoint | Bi 410/disabled hoac bi chan boi env flag default |
| EDGE-008 | Direct Edge admin-create/update/reset | Supabase Function endpoint | Bi 410/disabled hoac policy dong bo neu bat buoc giu |
| EDGE-009 | Docs scan | repo | Khong con huong dan Edge account admin la production path |
| EDGE-010 | Production smoke | Vercel Production sau merge | Account admin van dung Vercel API, khong loi CORS, khong loi 405 |

## Final Decision

CHOT: Vercel API la backend canonical cho account admin production.

Supabase Edge Functions lien quan account admin phai duoc audit, vo hieu hoa hoac dong bo. Khong duoc de hai backend co logic quyen/xoa tai khoan khac nhau.

Khuyen nghi tiep theo: lam PR-EDGE-01 truoc, chi sua frontend account admin API selector de cat duong goi Edge Function. Sau do PR-EDGE-02 quarantine `admin-delete-account`.
