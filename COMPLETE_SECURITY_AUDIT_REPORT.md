# COMPLETE SECURITY AUDIT REPORT: Supabase Database

## Table: `accounts`
* **has RLS?** Yes (based on `supabase_setup.sql`)
* **existing policies:**
  * "Cho phép mọi người xem danh sách tài khoản" (`FOR SELECT USING (true)`)
  * "Cho phép ghi tự do cho accounts" (`FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)`)
* **dangerous policies:** Both policies. Anyone can read all accounts (Privacy leak). Anyone can `UPDATE`, `INSERT`, or `DELETE` any account (Data destruction & Privilege escalation).
* **missing policies:** Scoped `SELECT` (self or tenant_admin). Strictly restricted `UPDATE` (only super_admin/tenant_admin can change roles/status).
* **tenant isolation status:** BROKEN / NON-EXISTENT.
* **privilege escalation risks:** CRITICAL. Any regular user or anonymous request can update their own `role_id` to `SUPER_ADMIN` or swap `tenant_id`.
* **recursive RLS risks:** HIGH. If RLS on `accounts` depends on `accounts` (e.g., querying `current_role()` which reads `accounts`), infinite recursion will crash queries unless helper functions are `SECURITY DEFINER` and created by a `BYPASSRLS` role (postgres).
* **missing indexes:** `username` is UNIQUE but an explicitly named index on it may improve lookups.
* **auth.uid() mapping risks:** High risk if `user_id` is updated or hijacked by another session.

## Table: `roles`
* **has RLS?** No
* **existing policies:** None
* **dangerous policies:** Default behavior without RLS allows FULL READ/WRITE to `anon` and `authenticated` roles via PostgREST.
* **missing policies:** Needs `ENABLE ROW LEVEL SECURITY`. Needs a `READ ONLY` policy for authenticated users. No inserts/updates should be allowed from API.
* **tenant isolation status:** N/A (Global definitions).
* **privilege escalation risks:** CRITICAL. Anyone can rename `SUPER_ADMIN` or modify descriptions.
* **recursive RLS risks:** Low.
* **missing indexes:** None. `name` is UNIQUE.
* **auth.uid() mapping risks:** None.

## Table: `permissions`
* **has RLS?** No
* **existing policies:** None
* **dangerous policies:** Default behavior without RLS allows FULL READ/WRITE to all users.
* **missing policies:** Needs `ENABLE ROW LEVEL SECURITY`. Needs `FOR SELECT` only.
* **tenant isolation status:** N/A (Global definitions).
* **privilege escalation risks:** CRITICAL. Attackers can inject new permission types to bypass application checks.
* **recursive RLS risks:** Low.
* **missing indexes:** None. `name` is UNIQUE.
* **auth.uid() mapping risks:** None.

## Table: `account_permissions`
* **has RLS?** No
* **existing policies:** None
* **dangerous policies:** Default behavior without RLS allows FULL READ/WRITE to all users.
* **missing policies:** Needs `ENABLE ROW LEVEL SECURITY`. Needs strict `TENANT_ADMIN` and `SUPER_ADMIN` gated policies for all operations.
* **tenant isolation status:** BROKEN / NON-EXISTENT.
* **privilege escalation risks:** CRITICAL. A user can grant themselves arbitrary permissions (e.g., `manage_brackets`).
* **recursive RLS risks:** Low.
* **missing indexes:** None. (Has index on `account_id`).
* **auth.uid() mapping risks:** Must ensure `account_id` mutation relies firmly on secure server contexts.

## Table: `account_event_permissions`
* **has RLS?** No
* **existing policies:** None
* **dangerous policies:** Default behavior without RLS allows FULL READ/WRITE to all users.
* **missing policies:** Needs `ENABLE ROW LEVEL SECURITY`. Needs strict `TENANT_ADMIN` enforcement.
* **tenant isolation status:** BROKEN.
* **privilege escalation risks:** CRITICAL. Users can grant themselves admin access to any event.
* **recursive RLS risks:** Low.
* **missing indexes:** None. (Has index on `account_id`).
* **auth.uid() mapping risks:** Low.

## Table: `active_sessions`
* **has RLS?** No
* **existing policies:** None
* **dangerous policies:** Default behavior without RLS allows FULL READ/WRITE to all users.
* **missing policies:** Needs `ENABLE ROW LEVEL SECURITY`. Users should only see their own sessions.
* **tenant isolation status:** N/A (User isolation).
* **privilege escalation risks:** CRITICAL. Session tokens are exposed. Attackers can hijack sessions or force logouts.
* **recursive RLS risks:** Low.
* **missing indexes:** Missing index on `session_token`.
* **auth.uid() mapping risks:** CRITICAL. Must map session back to `auth.uid()` implicitly.

## Table: `login_logs`
* **has RLS?** No
* **existing policies:** None
* **dangerous policies:** Default behavior without RLS allows FULL READ/WRITE. 
* **missing policies:** Needs `ENABLE ROW LEVEL SECURITY`. Insert-only for API, strict Select logic.
* **tenant isolation status:** BROKEN.
* **privilege escalation risks:** HIGH. Attackers can destroy audit logs.
* **recursive RLS risks:** Low.
* **missing indexes:** None.
* **auth.uid() mapping risks:** Low.

## Table: `tenants`
* **has RLS?** No
* **existing policies:** None
* **dangerous policies:** Default behavior without RLS allows FULL READ/WRITE.
* **missing policies:** Needs `ENABLE ROW LEVEL SECURITY`. Everyone can read basic info, only `SUPER_ADMIN` can insert/update/delete.
* **tenant isolation status:** BROKEN.
* **privilege escalation risks:** CRITICAL. Users can rename or delete competitors' tenants.
* **recursive RLS risks:** Low.
* **missing indexes:** None. Contains `slug` index.
* **auth.uid() mapping risks:** None.

## Table: `events`
* **has RLS?** Yes
* **existing policies:** "Cho phép ghi tự do cho anon và authenticated"
* **dangerous policies:** `TO anon, authenticated USING (true) WITH CHECK (true)` allows complete CRUD access to anyone.
* **missing policies:** `tenant_id = current_tenant_id()` restriction on SELECT, INSERT, UPDATE, DELETE.
* **tenant isolation status:** BROKEN. Cross-tenant reads and writes are universally permitted.
* **privilege escalation risks:** None directly affecting roles, but allows destroying business data.
* **recursive RLS risks:** Low.
* **missing indexes:** `tenant_id` index exists.
* **auth.uid() mapping risks:** Relies heavily on `current_tenant_id()` being spoof-proof.

## Table: `groups`
* **has RLS?** Yes
* **existing policies:** "Cho phép ghi tự do..."
* **dangerous policies:** Full CRUD to anyone.
* **missing policies:** Complete tenant-based restrictions.
* **tenant isolation status:** BROKEN.
* **privilege escalation risks:** Data modification risk.
* **recursive RLS risks:** Low.
* **missing indexes:** Has `event_id` and `tenant_id` indexes.
* **auth.uid() mapping risks:** N/A

## Table: `teams`
* **has RLS?** Yes
* **existing policies:** "Cho phép ghi tự do..."
* **dangerous policies:** Full CRUD to anyone.
* **missing policies:** Complete tenant-based restrictions.
* **tenant isolation status:** BROKEN.
* **privilege escalation risks:** Data modification risk.
* **recursive RLS risks:** Low.
* **missing indexes:** Has `event_id` and `tenant_id` indexes.
* **auth.uid() mapping risks:** N/A

## Table: `matches`
* **has RLS?** Yes
* **existing policies:** "Cho phép ghi tự do..."
* **dangerous policies:** Full CRUD to anyone.
* **missing policies:** Complete tenant-based restrictions.
* **tenant isolation status:** BROKEN.
* **privilege escalation risks:** Data modification risk (Changing scores, brackets).
* **recursive RLS risks:** Low.
* **missing indexes:** Has `event_id` and `tenant_id` indexes.
* **auth.uid() mapping risks:** N/A

## Table: `audit_logs`
* **has RLS?** Yes
* **existing policies:** "Cho phép ghi tự do..."
* **dangerous policies:** Full CRUD to anyone. 
* **missing policies:** Should be strictly restricted to INSERT only via database trigger, and SELECT via `SUPER_ADMIN` or `TENANT_ADMIN`.
* **tenant isolation status:** BROKEN.
* **privilege escalation risks:** HIGH. Allows destruction of audit trails.
* **recursive RLS risks:** Low.
* **missing indexes:** None.
* **auth.uid() mapping risks:** N/A
