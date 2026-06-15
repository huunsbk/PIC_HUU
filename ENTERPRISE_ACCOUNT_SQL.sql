-- ====================================================================================================
-- HỆ THỐNG ENTERPRISE ACCOUNTS SAAS MULTI-TENANT KHỞI LẬP (KHÔNG DOWNTIME)
-- ====================================================================================================
-- Dự án: PIC_HUU Cơ sở dữ liệu SaaS Pickleball
-- Mục tiêu: Thiết kế khối hệ thống Accounts độc lập, chuẩn Enterprise. 
-- Đặc tính: Single Login, Device Tracking, Soft Delete, Tenant Isolation.
-- Chú ý: Script này có thể sao chép và thực thi thẳng vào SQL Editor của Supabase.
-- ====================================================================================================

/*
====================================================================================================
1. MÔ HÌNH THỰC THỂ LIÊN KẾT BẢO MẬT (ERD)
====================================================================================================

      [ auth.users ] (Supabase Auth System)
             |
             | (1:1) - Khóa xác thực vật lý
             v
+------------------------+        +------------------------+        +------------------------+
|        tenants         | 1    N |        accounts        | N    1 |          roles         |
+------------------------+--------+------------------------+--------+------------------------+
| id (PK) UUID           |        | id (PK) UUID           |        | id (PK) UUID           |
| name VARCHAR           |        | user_id (FK) UUID      |        | name VARCHAR(UNIQUE)   |
| slug VARCHAR (UNIQUE)  |        | tenant_id (FK) UUID    |        | description TEXT       |
| status VARCHAR         |        | role_id (FK) UUID      |        | created_at TS          |
| created_at TS          |        | username VARCHAR(UNIQ) |        | updated_at TS          |
| updated_at TS          |        | display_name VARCHAR   |        +------------------------+
| deleted_at TS          |        | status VARCHAR         |
+------------------------+        | created_at TS          |        +------------------------+
                                  | updated_at TS          | 1    N |      permissions       |
+------------------------+        | deleted_at TS          |--------+------------------------+
|    active_sessions     | 1      +------------------------+        | id (PK) UUID           |
+------------------------+--------+           |                     | name VARCHAR(UNIQUE)   |
| id (PK) UUID           |      1             |                     | description TEXT       |
| account_id (FK)(UNIQUE)|                    | 1                   | created_at TS          |
| session_token (UNIQUE) |                    |                     +------------------------+
| ip_address VARCHAR     |                    | N                   
| browser_info TEXT      |        +------------------------+        +------------------------+
| device_info TEXT       |        |   login_logs           | 1    N |  account_permissions   |
| last_seen_at TS        |        +------------------------+--------+------------------------+
| expires_at TS          |      N | id (PK) UUID           |        | id (PK) UUID           |
| created_at TS          |--------+ account_id (FK) UUID   |        | account_id (FK) UUID   |
+------------------------+        | action VARCHAR         |        | permission_id (FK)UUID |
                                  | ip_address VARCHAR     |        | created_at TS          |
                                  | browser_info TEXT      |        +------------------------+
+---------------------------+     | device_info TEXT       |
| account_event_permissions | 1   | created_at TS          |        
+---------------------------+-----+------------------------+        
| id (PK) UUID              |   N
| account_id (FK) UUID      |
| event_id VARCHAR          |
| created_at TS             |
| deleted_at TS             |
+---------------------------+
*/

-- ====================================================================================================
-- 2. SCRIPT SQL HOÀN CHỈNH TẠO BẢNG & RÀNG BUỘC (DDL)
-- ====================================================================================================

-- Kích hoạt extension pgcrypto (nếu chưa có) để dùng hàm gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Hàm tự tạo tự động cập nhật updated_at
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- --------------------------------------------------------
-- BẢNG 1: TENANTS (TỔ CHỨC / CÂU LẠC BỘ)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(150) UNIQUE NOT NULL, -- Định danh URL thân thiện
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE NULL
);

CREATE TRIGGER update_tenants_modtime
BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE INDEX idx_tenants_slug ON public.tenants(slug) WHERE deleted_at IS NULL;

-- --------------------------------------------------------
-- BẢNG 3: ROLES (VAI TRÒ HỆ THỐNG)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL, -- SUPER_ADMIN, TENANT_ADMIN, EVENT_ADMIN
    description VARCHAR(255) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE TRIGGER update_roles_modtime
BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- --------------------------------------------------------
-- BẢNG 4: PERMISSIONS (DANH QUYỀN TRUY CẬP)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL, -- manage_accounts, manage_events, etc.
    description VARCHAR(255) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- --------------------------------------------------------
-- BẢNG 2: ACCOUNTS (TÀI KHOẢN NGƯỜI DÙNG DOANH NGHIỆP)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL NULL, -- Liên kết ẩn với Supabase Auth
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    role_id UUID REFERENCES public.roles(id) ON DELETE RESTRICT NOT NULL,
    username VARCHAR(150) UNIQUE NOT NULL, 
    display_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'banned')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE NULL
);

CREATE TRIGGER update_accounts_modtime
BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE INDEX idx_accounts_tenant_id ON public.accounts(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_accounts_user_id ON public.accounts(user_id) WHERE deleted_at IS NULL;

-- --------------------------------------------------------
-- BẢNG 5: ACCOUNT_PERMISSIONS (CẤP QUYỀN ĐỘC LẬP CHO TÀI KHOẢN)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE NOT NULL,
    permission_id UUID REFERENCES public.permissions(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (account_id, permission_id)
);
CREATE INDEX idx_acct_perms_account ON public.account_permissions(account_id);

-- --------------------------------------------------------
-- BẢNG 6: ACCOUNT_EVENT_PERMISSIONS (PHÂN QUYỀN SỰ KIỆN TRỌNG TÀI - EVENT AND BRACKETS)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_event_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE NOT NULL,
    event_id VARCHAR(150) NOT NULL, -- Tham chiếu sang bảng events (kiểu string hiện tại)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE NULL,
    UNIQUE (account_id, event_id)
);
CREATE INDEX idx_acct_event_perms_account ON public.account_event_permissions(account_id) WHERE deleted_at IS NULL;

-- --------------------------------------------------------
-- BẢNG 7: ACTIVE_SESSIONS (KIỂM SOÁT THIẾT BỊ & SINGLE LOGIN)
-- Tham chiếu tính duy nhất vào tài khoản (Mỗi tài khoản 1 session sống)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.active_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE UNIQUE NOT NULL, -- ĐẢM BẢO SINGLE LOGIN
    session_token TEXT UNIQUE NOT NULL,
    ip_address VARCHAR(45) NULL,
    browser_info TEXT NULL,
    device_info TEXT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX idx_active_sessions_account ON public.active_sessions(account_id);

-- --------------------------------------------------------
-- BẢNG 8: LOGIN_LOGS (AUDIT GHI NHẬN HÀNH VI BẢO MẬT)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.login_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE NOT NULL,
    action VARCHAR(50) NOT NULL CHECK (action IN ('login', 'logout', 'password_change', 'forced_logout')),
    ip_address VARCHAR(45) NULL,
    browser_info TEXT NULL,
    device_info TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX idx_login_logs_account ON public.login_logs(account_id);
CREATE INDEX idx_login_logs_created_at ON public.login_logs(created_at);

-- ====================================================================================================
-- 3. SEED DỮ LIỆU MẪU (SCAFFOLDING DATA)
-- ====================================================================================================

-- Chèn vai trò (Roles)
INSERT INTO public.roles (id, name, description) VALUES
  (gen_random_uuid(), 'SUPER_ADMIN', 'Quản trị viên hạ tầng tối cao'),
  (gen_random_uuid(), 'TENANT_ADMIN', 'Ban tổ chức giải đấu, chủ CLB'),
  (gen_random_uuid(), 'EVENT_ADMIN', 'Trọng tài / Giám sát nội dung');

-- Chèn quyền hạn (Permissions)
INSERT INTO public.permissions (id, name, description) VALUES
  (gen_random_uuid(), 'manage_accounts', 'Quyền khởi tạo, xóa tài khoản'),
  (gen_random_uuid(), 'manage_events', 'Quyền thêm sửa nội dung tính điểm'),
  (gen_random_uuid(), 'manage_matches', 'Quyền sửa xóa trận đấu, xếp lịch'),
  (gen_random_uuid(), 'manage_brackets', 'Quyền bốc thăm chia bảng, knockout'),
  (gen_random_uuid(), 'manage_scores', 'Quyền nhập và điều chỉnh điểm số'),
  (gen_random_uuid(), 'view_reports', 'Quyền xuất thống kê và kết quả');

-- Mẫu Tenant gốc (System / Global)
INSERT INTO public.tenants (id, name, slug) VALUES 
  ('11111111-1111-1111-1111-111111111111', 'Hệ thống Quản Trị Trung Tâm', 'system-admin'),
  ('22222222-2222-2222-2222-222222222222', 'Chi Nhánh Giải Pickleball Mẫu', 'demo-pickleball');

-- Mẫu Account Root (HuuNSBK)
INSERT INTO public.accounts (id, tenant_id, role_id, username, display_name) 
SELECT '33333333-3333-3333-3333-333333333333', 
       '11111111-1111-1111-1111-111111111111', 
       (SELECT id FROM public.roles WHERE name = 'SUPER_ADMIN'), 
       'huunsbk', 
       'Root Administrator';

-- ====================================================================================================
-- 4. CHIẾN LƯỢC DỊCH CHUYỂN DỮ LIỆU (MIGRATION STRATEGY)
-- ====================================================================================================
/*
    A. PREPARATION (Chưa can thiệp Frontend)
       - Chạy tệp SQL này tại Supabase để xây dựng khối Database độc lập.
       - Viết trigger hook ở `auth.users` để tự động map Row vào bảng Accounts lúc đăng ký.
    B. DATA EXTRACTION
       - Chạy một hàm PL/pgSQL quét bảng dữ liệu `tournament` tại dòng id='accounts_config'.
       - Map JSON array `accounts` để sinh Script INSERT thô vào bảng tenants (từ displayName) 
         và bảng accounts mới này. Map trọng tài sang `account_event_permissions`.
    C. FRONTEND MIDDLEWARE (Double Write Mode)
       - Frontend nâng cấp code Zustand Store, gọi API cả cũ lẫn mới trong vòng 1 tuần.
    D. FINAL CUT-OVER
       - Xác nhận bảng accounts gánh tải tốt, xoá JSON `accounts_config` trong thẻ tournament cũ.
*/

-- ====================================================================================================
-- 5. CHIẾN LƯỢC KHÔI PHỤC KÉM AN TOÀN (ROLLBACK STRATEGY)
-- ====================================================================================================
/*
    Nếu hệ thống bị đứt gãy hoặc từ chối dịch vụ (Authentication Break):
    1. Trả lại mã nguồn Frontend về Commit trước đó (Sử dụng Store gọi accounts_config truyền thống).
    2. Cấu trúc bảng SQL Enterprise mới này HOÀN TOÀN TÁCH BIỆT với dữ liệu JSON của kiến trúc cũ, 
       từ đó sự tồn tại của database mới KHÔNG THỂ LÀM HỎNG dữ liệu cũ.
    3. Bạn có thể sử dụng Lệnh dọn dẹp cấp tốc để xóa sạch 100% Cấu trúc mới nếu cần:

    DROP TABLE IF EXISTS public.login_logs CASCADE;
    DROP TABLE IF EXISTS public.active_sessions CASCADE;
    DROP TABLE IF EXISTS public.account_event_permissions CASCADE;
    DROP TABLE IF EXISTS public.account_permissions CASCADE;
    DROP TABLE IF EXISTS public.accounts CASCADE;
    DROP TABLE IF EXISTS public.permissions CASCADE;
    DROP TABLE IF EXISTS public.roles CASCADE;
    DROP TABLE IF EXISTS public.tenants CASCADE;
*/
-- ====================================================================================================
-- END OF SQL SCRIPT
-- ====================================================================================================
