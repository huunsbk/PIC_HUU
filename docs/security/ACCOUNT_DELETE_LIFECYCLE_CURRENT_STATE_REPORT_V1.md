# Account Delete Lifecycle Current State Report V1

Ngay audit: 2026-07-05
Pham vi: static audit source code trong repo `huunsbk/PIC_HUU`.
Rang buoc da tuan thu: khong sua code, khong sua database, khong tao migration, khong xoa tai khoan that, khong chay thao tac destructive tren production, khong merge main, khong lam Phase 2-6.

Ghi chu: audit nay duoc thuc hien tren branch `codex/pr-sec-01-reset-password-scope`, nen file reset password dang phan anh hardening PR-SEC-01. Phan delete account khong duoc sua trong nhiem vu nay.

## 1. Executive Summary

He thong hien dang **lan ca soft-delete va hard-delete** tuy theo duong xu ly:

- Duong production chinh tren Vercel: UI goi `DELETE /api/admin/accounts/:id`, di qua Vercel API va **soft-delete** account.
- Duong legacy/fallback Supabase Edge Function: `admin-delete-account` co the **hard-delete** `accounts` va Supabase Auth user.
- UI modal hien tai ghi "Xoa vinh vien" trong khi Vercel API production thuc te dang soft-delete. Day la lech ngon ngu nghiep vu/UX.
- Menu `Quan tri -> Da xoa` hien chi quan ly `tenants`, `tournaments`, `events`; **chua co danh sach tai khoan da xoa**, chua co restore account, chua co hard-delete account tu khu `Da xoa`.

Muc do rui ro: **P0/P1** vi Edge Function `admin-delete-account` van ton tai va hard-delete, trong khi Vercel API canonical da soft-delete. Neu fallback Edge duoc kich hoat hoac goi truc tiep, co the mat kha nang khoi phuc account/Auth user.

## 2. Account Delete Flow hien tai

### Production Vercel Flow

```text
UI AccountManager
-> handleDeleteAccount(accountId, username)
-> ConfirmDialog title "Xoa vinh vien tai khoan"
-> handleConfirmDeleteAccount()
-> deleteAdminAccount(accountId)
-> src/lib/api/adminAccounts.ts
-> hostname != huunsbk.github.io
-> fetch DELETE /api/admin/accounts/:accountId
-> api/admin/accounts/[id].js
-> getActorAccount(req, service-role admin client)
-> permission/scope checks
-> delete active_sessions, login_logs, account_permissions
-> soft-delete account_event_permissions
-> update accounts set status='inactive', deleted_at=now(), updated_at=now()
-> audit account.archive
-> UI fetchAccounts()
```

Ket qua production: **khong xoa row `accounts`, khong xoa Supabase Auth user, co set `deleted_at`, co set `status='inactive'`, co revoke active_sessions, co audit**.

### Legacy/Fallback Edge Flow

```text
UI AccountManager
-> deleteAdminAccount(accountId)
-> src/lib/api/adminAccounts.ts
-> hostname == huunsbk.github.io
-> supabase.functions.invoke('admin-delete-account', { accountId })
-> supabase/functions/admin-delete-account/index.ts
-> only SUPER_ADMIN
-> delete active_sessions, login_logs, account_permissions, account_event_permissions
-> DELETE FROM accounts WHERE id = accountId
-> admin.auth.admin.deleteUser(targetAccount.user_id)
-> return success
```

Ket qua Edge fallback: **hard-delete account row va Supabase Auth user, khong audit, khong restore path**.

## 3. Bang So Sanh Cac Duong Xoa Tai Khoan

| Duong xu ly | File | Duoc goi khi nao | Soft-delete hay hard-delete | Co xoa Auth user khong | Co audit khong | Rui ro |
| --- | --- | --- | --- | --- | --- | --- |
| Vercel API `DELETE /api/admin/accounts/:id` | `api/admin/accounts/[id].js` | Production Vercel, hostname khong phai `huunsbk.github.io` | Soft-delete: update `accounts.status='inactive'`, `accounts.deleted_at=now()` | Khong | Co: `account.archive` | Trung binh: UI noi "xoa vinh vien" nhung thuc te soft-delete; chua co restore UI |
| Frontend account delete wrapper | `src/lib/api/adminAccounts.ts` | Moi thao tac xoa tu UI | Chon Vercel API hoac Edge Function theo hostname | Tuy backend | Tuy backend | P1: van co fallback Edge Function khi hostname la `huunsbk.github.io` |
| Supabase Edge Function `admin-delete-account` | `supabase/functions/admin-delete-account/index.ts` | GitHub Pages fallback hoac goi truc tiep Edge Function neu deploy | Hard-delete: xoa permission/session/account row va Auth user | Co | Khong thay audit | P0: bypass canonical Vercel soft-delete; mat account/Auth user |
| Manual/direct DB/API ngoai UI | service role / Supabase dashboard / scripts neu co quyen | Khong phai flow UI | Tuy nguoi thao tac | Tuy nguoi thao tac | Khong dam bao | P1/P2: can policy van hanh va audit rieng |

## 4. Kiem Tra `Quan tri -> Da xoa`

File lien quan:

- `src/App.tsx`
- `src/components/DeletedItemsManager.tsx`
- `src/lib/api/tournamentRpc.ts`
- RPC archived/hard-delete trong migrations cho tenant/tournament/event.

Ket qua:

- Menu `Quan tri -> Da xoa` co trong admin tabs: `src/App.tsx`.
- `DeletedItemsManager` chi co 3 tab:
  - `tenants`
  - `tournaments`
  - `events`
- Khong co tab/list `accounts`.
- Khong co source data account archived/deleted.
- Khong co nut khoi phuc account.
- Khong co nut xoa cung account.

Nguon du lieu hien tai:

- `tournamentRpc.listArchivedTenants()`
- `tournamentRpc.listArchivedTournaments(tenantParam)`
- `tournamentRpc.listArchivedEvents(tenantParam)`

Ket luan: tai khoan bi xoa mem bang Vercel API **khong xuat hien trong `Quan tri -> Da xoa`** theo code hien tai. Vi vay soft-delete account co the bien mat khoi man hinh account active, nhung chua co noi de quan tri vien khoi phuc/xoa cung.

## 5. Danh Gia So Voi Quy Trinh Nghiep Vu Mong Muon

Quy trinh mong muon:

```text
Active account
-> soft-delete / archive
-> xuat hien trong Quan tri -> Da xoa
-> co the khoi phuc
-> chi hard-delete tu khu Da xoa
-> co phan quyen, xac nhan va audit
```

| Buoc | Trang thai hien tai | Danh gia |
| --- | --- | --- |
| Active account -> soft-delete/archive | Vercel API da soft-delete bang `status='inactive'`, `deleted_at=now()` | Dat mot phan |
| Xuat hien trong `Quan tri -> Da xoa` | Chua co list account deleted | Chua dat |
| Co the khoi phuc | Chua thay restore account UI/API/RPC | Chua dat |
| Hard-delete chi tu khu `Da xoa` | Vercel API khong hard-delete, nhung Edge Function hard-delete truc tiep | Rui ro |
| Co phan quyen | Vercel API co SUPER_ADMIN/EVENT_ADMIN scope; TENANT_ADMIN hien UI khong cho delete, API delete khong allow TENANT_ADMIN | Dat mot phan |
| Co xac nhan | UI co ConfirmDialog, nhung text noi "xoa vinh vien" sai voi Vercel soft-delete | Dat mot phan |
| Co audit | Vercel API co `account.archive`; Edge Function khong audit | Dat mot phan / Rui ro |

Ket luan: lifecycle tai khoan **chua dat quy trinh nghiep vu mong muon**. Production canonical da di dung huong soft-delete, nhung thieu Deleted UI/restore/hard-delete controlled path, va con Edge hard-delete bypass.

## 6. Rui Ro Bao Mat Va Van Hanh

| Muc | Rui ro | Bang chung | Tac dong |
| --- | --- | --- | --- |
| P0 | Edge Function `admin-delete-account` hard-delete `accounts` va Supabase Auth user | `supabase/functions/admin-delete-account/index.ts` xoa `accounts`, goi `admin.auth.admin.deleteUser` | Mat account/Auth user, kho phuc hoi kho, pha forensic |
| P1 | Frontend con fallback sang Edge Function tren `huunsbk.github.io` | `src/lib/api/adminAccounts.ts` co `shouldUseSupabaseFunction()` va `supabase.functions.invoke` | Neu GitHub Pages duoc dung lai, delete co the hard-delete thay vi soft-delete |
| P1 | Account soft-deleted khong xuat hien trong `Quan tri -> Da xoa` | `DeletedItemsManager` chi co tenants/tournaments/events | Quan tri vien khong co noi khoi phuc/xoa cung tai khoan |
| P1 | UI confirm ghi "Xoa vinh vien" trong khi production Vercel API soft-delete | `AccountManager` ConfirmDialog title/message | Nguoi dung hieu sai tac dong thao tac; governance lech |
| P1 | Vercel delete API khong cho TENANT_ADMIN delete account, trong khi nghiep vu co the can tenant admin xu ly tai khoan trong tenant | `api/admin/accounts/[id].js` DELETE chi allow `SUPER_ADMIN`, `EVENT_ADMIN` | Tenant admin phai dung status inactive qua edit thay vi delete lifecycle |
| P1 | Account bi xoa co lich su nhap diem/sua du lieu nhung chua co restore/forensic workflow | No account deleted area | Tranh chap van hanh kho truy vet neu tiep tuc hard-delete qua Edge |
| P2 | Vercel soft-delete xoa `login_logs`, `account_permissions` hard delete va soft-delete `account_event_permissions` | `api/admin/accounts/[id].js` | Mat mot phan lich su/quyen goc; tuy audit co `account.archive` nhung forensic chua day du |
| P2 | Edge delete khong audit | `supabase/functions/admin-delete-account/index.ts` | Kho truy vet ai xoa neu Edge duoc goi |
| P2 | Direct service-role/Supabase dashboard co the bypass UI | van hanh/admin tooling | Can quy trinh thao tac production rieng |

## 7. Ket Luan Production

Tra loi truc tiep:

- Hien co an toan de giu xoa cung mac dinh khong? **Khong.** Xoa cung mac dinh khong phu hop voi giai that.
- Neu xoa cung dang ton tai, nam o duong nao? **Supabase Edge Function `admin-delete-account`**.
- Duong production Vercel API co xoa cung khong? **Khong**, no dang soft-delete account.
- Co can chuyen sang soft-delete khong? **Vercel API da soft-delete; Edge Function can disable/quarantine hoac sync sang soft-delete.**
- Co can them tai khoan vao `Quan tri -> Da xoa` khong? **Co.** Day la gap nghiep vu lon.
- Co can disable/quarantine Edge `admin-delete-account` khong? **Co, uu tien cao nhat.**
- Co du bang chung ket luan khong? **Du bang chung static code cho flow hien tai.** Can test truc tiep Preview/production de xac nhan network path va DB/Auth state sau thao tac voi tai khoan test rieng.

## 8. De Xuat PR Nho Tiep Theo

### PR-ACC-DEL-01: Chuan hoa DELETE account thanh soft-delete

Muc tieu:

- Xac nhan Vercel API la only production delete.
- Sua UI text tu "Xoa vinh vien" thanh "Luu tru/Khoa tai khoan" neu action la soft-delete.
- Xem lai permission cho `TENANT_ADMIN` neu nghiep vu can tenant admin archive account trong tenant.

Khong lam:

- Khong xoa Auth user.
- Khong hard-delete tu list active.

### PR-ACC-DEL-02: Them tai khoan da xoa vao `Quan tri -> Da xoa`

Muc tieu:

- Them tab `Danh sach tai khoan`.
- List accounts `deleted_at IS NOT NULL` hoac `status='inactive'` theo policy.
- Hien tenant, role, username, display name, deleted_at, created_by, last audit neu co.

### PR-ACC-DEL-03: Restore account

Muc tieu:

- Restore account soft-deleted.
- Set `deleted_at=NULL`, `status='active'` neu pass policy.
- Can xem lai Auth user van con; voi Vercel soft-delete Auth user hien con, nen restore kha thi.
- Audit `account.restore`.

### PR-ACC-DEL-04: Hard-delete account chi tu khu `Da xoa`

Muc tieu:

- Chi SUPER_ADMIN duoc hard-delete.
- Yeu cau account da soft-deleted.
- Can confirm 2 lop.
- Can export/audit trail truoc khi hard-delete.
- Neu delete Auth user thi ghi ro irreversible.

### PR-EDGE-01: Cat frontend fallback goi Edge account functions

Muc tieu:

- Account admin frontend always calls Vercel API.
- Khong con `supabase.functions.invoke` cho account admin.

### PR-EDGE-02: Quarantine/disable Edge `admin-delete-account`

Muc tieu:

- Edge `admin-delete-account` return 410 hoac require env flag disabled by default.
- Khong con hard-delete bypass canonical.

## 9. Test Matrix De Xuat

| Test | Actor | Target | Moi truong | Expected |
| --- | --- | --- | --- | --- |
| SUPER_ADMIN xoa tai khoan thuong | SUPER_ADMIN | EVENT_ADMIN/REFEREE/VIEWER active | Preview test account | Vercel API soft-delete, `accounts` row con, `deleted_at` set, `status='inactive'`, Auth user con |
| TENANT_ADMIN xoa tai khoan cung tenant | TENANT_ADMIN | EVENT_ADMIN/REFEREE/VIEWER cung tenant | Preview | Theo policy sau PR: pass neu cho tenant admin archive, hoac bi chan ro rang |
| TENANT_ADMIN xoa tai khoan khac tenant | TENANT_ADMIN | account tenant khac | Preview | Bi chan |
| EVENT_ADMIN xoa REFEREE trong scope | EVENT_ADMIN | REFEREE co scope manageable | Preview | Pass soft-delete neu Vercel policy cho phep |
| EVENT_ADMIN xoa TENANT_ADMIN/SUPER_ADMIN | EVENT_ADMIN | TENANT_ADMIN/SUPER_ADMIN | Preview | Bi chan |
| REFEREE goi API xoa | REFEREE | bat ky | Preview/API direct | 403 |
| Tai khoan bi xoa dang online | Admin | target dang co session | Preview hai browser | Target bi logout/revoke session |
| Account da xoa xuat hien trong `Da xoa` | Admin | account soft-deleted | Preview sau PR-ACC-DEL-02 | Xuat hien trong tab tai khoan |
| Khoi phuc tai khoan | Admin | account soft-deleted | Preview sau PR-ACC-DEL-03 | `deleted_at=NULL`, `status='active'`, login lai duoc |
| Xoa cung tu khu `Da xoa` | SUPER_ADMIN | account archived | Preview sau PR-ACC-DEL-04 | Chi chay tu tab `Da xoa`, co audit/export |
| Kiem tra Supabase Auth user con hay mat | Admin | target sau soft-delete | Supabase Auth/read-only test | Vercel soft-delete: Auth user con |
| Kiem tra audit | Admin | target | DB/audit UI | Co `account.archive`, sau nay co `account.restore`/`account.hard_delete` |
| Edge bypass | Direct Edge call | target test | Preview/staging | Edge `admin-delete-account` bi disable/quarantine |

## File Da Doc Va Bang Chung

Frontend/UI:

- `src/components/AccountManager.tsx`
  - `handleDeleteAccount`
  - `handleConfirmDeleteAccount`
  - `deleteAdminAccount(accountToDelete.id)`
  - ConfirmDialog title/message hien ghi "Xoa vinh vien".
- `src/lib/api/adminAccounts.ts`
  - `deleteAdminAccount`
  - `shouldUseSupabaseFunction`
  - `supabase.functions.invoke`
- `src/components/DeletedItemsManager.tsx`
  - Chi co tabs `tenants`, `tournaments`, `events`.
- `src/App.tsx`
  - Menu `Da xoa`.

Vercel API canonical:

- `api/admin/accounts/[id].js`
  - DELETE soft-delete.
  - Xoa active_sessions/login_logs/account_permissions.
  - Soft-delete account_event_permissions.
  - Set `accounts.status='inactive'`, `deleted_at`, `updated_at`.
  - Audit `account.archive`.
- `api/admin/_accountService.js`
  - Actor role policy.
  - `ensureEventAdminCanManageTargetAccount`.

Supabase Edge Functions:

- `supabase/functions/admin-delete-account/index.ts`
  - Hard-delete account/Auth user.
- `supabase/functions/admin-create-account/index.ts`
- `supabase/functions/admin-update-account/index.ts`
- `supabase/functions/admin-reset-account-password/index.ts`
- `supabase/functions/_shared/admin-account.ts`

Deleted-area/RPC:

- `src/components/DeletedItemsManager.tsx`
- `src/lib/api/tournamentRpc.ts`
- migrations archived tenant/tournament/event hard-delete/restore references.

## Diem Can Test Truc Tiep

Static audit du bang chung code de ket luan lifecycle hien tai, nhung cac diem sau can test truc tiep tren Vercel Preview bang tai khoan test rieng:

- Network khi bam xoa tren Vercel Preview co goi dung `DELETE /api/admin/accounts/:id`.
- Sau Vercel delete, Supabase `accounts` row con ton tai va co `deleted_at/status`.
- Supabase Auth user cua target con ton tai.
- Target online bi logout do `active_sessions` bi xoa.
- Account soft-deleted khong con trong AccountManager active list.
- Account soft-deleted chua xuat hien trong `Quan tri -> Da xoa`.
- Direct Edge `admin-delete-account` co con deploy/call duoc hay khong.

Khong nen test bang tai khoan production that dang van hanh. Phai dung account test rieng.
