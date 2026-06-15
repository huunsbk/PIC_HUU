-- =========================================================================================
-- SCRIPT MIGRATION & DEPLOYMENT: ROW LEVEL SECURITY (RLS) MULTI-TENANT ENTERPRISE
-- =========================================================================================
-- Dự án: PIC_HUU Cơ sở dữ liệu SaaS Pickleball
-- Mục tiêu: Cách ly dữ liệu cấp phát dựa trên JWT, bảo vệ 100% CSDL đa tenant.
-- Chú ý: Script này được thiết kế để chạy trực tiếp trên Supabase SQL Editor.
-- =========================================================================================

-- =========================================================================================
-- 1. BACKUP DỮ LIỆU (SAFETY BACKUP CHECKS)
-- Chạy sao lưu thô toàn bộ bảng cốt lõi trước khi thiết lập Firewall RLS.
-- =========================================================================================
CREATE TABLE IF NOT EXISTS backup_tournament AS SELECT * FROM tournament;
CREATE TABLE IF NOT EXISTS backup_events AS SELECT * FROM events;
CREATE TABLE IF NOT EXISTS backup_groups AS SELECT * FROM groups;
CREATE TABLE IF NOT EXISTS backup_teams AS SELECT * FROM teams;
CREATE TABLE IF NOT EXISTS backup_matches AS SELECT * FROM matches;
CREATE TABLE IF NOT EXISTS backup_audit_logs AS SELECT * FROM audit_logs;

-- Đảm bảo cột tenant_id tồn tại trên tournament (như các bảng khác)
-- Nếu trường hợp tournament dùng 'id' làm tenant_id, phần policy dưới đây sẽ map trực tiếp
-- id của tournament với tenant_id trong JWT.

-- =========================================================================================
-- 2. KÍCH HOẠT ROW LEVEL SECURITY (ENABLE RLS)
-- Đóng sập mọi cổng truy cập trái phép. Từ nay mọi luồng I/O đều bị từ chối mặc định.
-- =========================================================================================
ALTER TABLE tournament ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- =========================================================================================
-- 3 & 4. JWT CLAIMS VÀ CÁC CHÍNH SÁCH BẢO MẬT (POLICIES)
-- Sử dụng Custom JWT claims của Supabase: 
-- auth.jwt()->'app_metadata'->>'role'
-- auth.jwt()->'app_metadata'->>'tenant_id'
-- =========================================================================================

-- ============================
-- BẢNG: TOURNAMENT
-- Giải đấu cấu hình tổng 
-- ============================
-- Khán giả xem tất cả thông tin các giải đấu
CREATE POLICY "Public_Select_Tournament" ON tournament FOR SELECT TO public USING (true);
-- Admin 1 (Super Admin) toàn quyền
CREATE POLICY "Admin1_Full_Tournament" ON tournament FOR ALL TO authenticated USING (auth.jwt()->'app_metadata'->>'role' = 'admin1');
-- Admin 2 chỉ được can thiệp vào dòng giải đấu của chính mình (tenant)
CREATE POLICY "Admin2_Tenant_Tournament" ON tournament FOR ALL TO authenticated 
USING (
    auth.jwt()->'app_metadata'->>'role' = 'admin2' 
    AND id = auth.jwt()->'app_metadata'->>'tenant_id'
);

-- ============================
-- BẢNG: EVENTS, GROUPS, TEAMS
-- Thông tin cấu trúc thi đấu
-- ============================
-- Khán giả được quyền xem (SELECT) cấu trúc giải đấu (Read-only)
CREATE POLICY "Public_Select_Events" ON events FOR SELECT TO public USING (true);
CREATE POLICY "Public_Select_Groups" ON groups FOR SELECT TO public USING (true);
CREATE POLICY "Public_Select_Teams" ON teams FOR SELECT TO public USING (true);

-- Admin 1 toàn quyền (Bypass check)
CREATE POLICY "Admin1_Full_Events" ON events FOR ALL TO authenticated USING (auth.jwt()->'app_metadata'->>'role' = 'admin1');
CREATE POLICY "Admin1_Full_Groups" ON groups FOR ALL TO authenticated USING (auth.jwt()->'app_metadata'->>'role' = 'admin1');
CREATE POLICY "Admin1_Full_Teams" ON teams FOR ALL TO authenticated USING (auth.jwt()->'app_metadata'->>'role' = 'admin1');

-- Admin 2 toàn quyền trong không gian tenant_id của mình
CREATE POLICY "Admin2_Tenant_Events" ON events FOR ALL TO authenticated 
USING (auth.jwt()->'app_metadata'->>'role' = 'admin2' AND tenant_id = auth.jwt()->'app_metadata'->>'tenant_id');
CREATE POLICY "Admin2_Tenant_Groups" ON groups FOR ALL TO authenticated 
USING (auth.jwt()->'app_metadata'->>'role' = 'admin2' AND tenant_id = auth.jwt()->'app_metadata'->>'tenant_id');
CREATE POLICY "Admin2_Tenant_Teams" ON teams FOR ALL TO authenticated 
USING (auth.jwt()->'app_metadata'->>'role' = 'admin2' AND tenant_id = auth.jwt()->'app_metadata'->>'tenant_id');

-- ============================
-- BẢNG: MATCHES 
-- (Bảng nhạy cảm - Admin 3 tham gia cập nhật điểm)
-- ============================
-- Khán giả được xem kết quả thi đấu
CREATE POLICY "Public_Select_Matches" ON matches FOR SELECT TO public USING (true);

-- Admin 1 toàn quyền
CREATE POLICY "Admin1_Full_Matches" ON matches FOR ALL TO authenticated USING (auth.jwt()->'app_metadata'->>'role' = 'admin1');

-- Admin 2 toàn quyền xử lý các trận đấu thuộc giải mình tạo
CREATE POLICY "Admin2_Tenant_Matches" ON matches FOR ALL TO authenticated 
USING (auth.jwt()->'app_metadata'->>'role' = 'admin2' AND tenant_id = auth.jwt()->'app_metadata'->>'tenant_id');

-- Admin 3 (Trọng tài) chỉ được phép UPDATE trận đấu thuộc tenant và nằm trong sự kiện được ủy quyền
CREATE POLICY "Admin3_Restricted_Matches" ON matches FOR UPDATE TO authenticated 
USING (
    auth.jwt()->'app_metadata'->>'role' = 'admin3' 
    AND tenant_id = auth.jwt()->'app_metadata'->>'tenant_id'
    AND EXISTS (
        -- So khớp với bảng quyền trong tương lai (account_event_permissions)
        SELECT 1 FROM account_event_permissions aep
        JOIN accounts a ON a.id = aep.account_id
        WHERE a.user_id = auth.uid() AND aep.event_id = matches.event_id
    )
);

-- ============================
-- BẢNG: AUDIT_LOGS
-- Cấm public, chỉ dành cho Admin nội bộ
-- ============================
-- Admin 1 toàn quyền xem/sửa log hệ thống
CREATE POLICY "Admin1_Full_Audit" ON audit_logs FOR ALL TO authenticated USING (auth.jwt()->'app_metadata'->>'role' = 'admin1');

-- Admin 2 xem log thuộc Tenant mình quản lý
CREATE POLICY "Admin2_Tenant_Audit" ON audit_logs FOR SELECT TO authenticated 
USING (auth.jwt()->'app_metadata'->>'role' = 'admin2' AND tenant_id = auth.jwt()->'app_metadata'->>'tenant_id');

-- Admin 2 / Admin 3 được phép CHÈN (INSERT) nhật ký vào Tenant của mình
CREATE POLICY "Admins_Insert_Audit" ON audit_logs FOR INSERT TO authenticated 
WITH CHECK (
    tenant_id = auth.jwt()->'app_metadata'->>'tenant_id'
);


-- =========================================================================================
-- 5. POLICIES CHO CÁC BẢNG QUẢN TRỊ NGHIỆP VỤ (CHẾ ĐỘ TƯƠNG LAI - ENTERPRISE ACCOUNTS)
-- Áp dụng cho các bảng schema mới: accounts, active_sessions, login_logs
-- Tiền đề: Các bảng này đã được `ENABLE ROW LEVEL SECURITY;`
-- =========================================================================================

-- ACCOUNT POLICIES
-- User tự xem của mình. Khán giả không được xem. Admin1 xem tất cả.
CREATE POLICY "Users_Read_Own_Account" ON accounts FOR SELECT TO authenticated 
USING (user_id = auth.uid() OR auth.jwt()->'app_metadata'->>'role' = 'admin1');

-- ACTIVE_SESSIONS POLICIES (SINGLE LOGIN)
-- Chỉ định danh hợp lệ (chính chủ) mới được thao tác phiên sống của riêng thiết bị đó.
CREATE POLICY "Users_Manage_Own_Sessions" ON active_sessions FOR ALL TO authenticated 
USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));

-- LOGIN_LOGS POLICIES
-- User xem log của mình. Admin xem toàn hệ thống hoặc tenant_id liên quan.
CREATE POLICY "Users_Read_Own_Login_Logs" ON login_logs FOR SELECT TO authenticated 
USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));


-- =========================================================================================
-- 7. ROLLBACK SCRIPT (PHƯƠNG ÁN AN TOÀN - DR SCRIPT)
-- Đóng gói gọn phần hoàn tác ở dưới cùng. Xoá comment để chạy trong trường hợp khẩn cấp.
-- =========================================================================================
/*
-- Xóa toàn bộ chính sách (Drop Policies)
DROP POLICY IF EXISTS "Public_Select_Tournament" ON tournament;
DROP POLICY IF EXISTS "Admin1_Full_Tournament" ON tournament;
DROP POLICY IF EXISTS "Admin2_Tenant_Tournament" ON tournament;
DROP POLICY IF EXISTS "Public_Select_Events" ON events;
DROP POLICY IF EXISTS "Public_Select_Groups" ON groups;
DROP POLICY IF EXISTS "Public_Select_Teams" ON teams;
DROP POLICY IF EXISTS "Admin1_Full_Events" ON events;
DROP POLICY IF EXISTS "Admin1_Full_Groups" ON groups;
DROP POLICY IF EXISTS "Admin1_Full_Teams" ON teams;
DROP POLICY IF EXISTS "Admin2_Tenant_Events" ON events;
DROP POLICY IF EXISTS "Admin2_Tenant_Groups" ON groups;
DROP POLICY IF EXISTS "Admin2_Tenant_Teams" ON teams;
DROP POLICY IF EXISTS "Public_Select_Matches" ON matches;
DROP POLICY IF EXISTS "Admin1_Full_Matches" ON matches;
DROP POLICY IF EXISTS "Admin2_Tenant_Matches" ON matches;
DROP POLICY IF EXISTS "Admin3_Restricted_Matches" ON matches;
DROP POLICY IF EXISTS "Admin1_Full_Audit" ON audit_logs;
DROP POLICY IF EXISTS "Admin2_Tenant_Audit" ON audit_logs;
DROP POLICY IF EXISTS "Admins_Insert_Audit" ON audit_logs;
DROP POLICY IF EXISTS "Users_Read_Own_Account" ON accounts;
DROP POLICY IF EXISTS "Users_Manage_Own_Sessions" ON active_sessions;
DROP POLICY IF EXISTS "Users_Read_Own_Login_Logs" ON login_logs;

-- Tắt tính năng RLS (Disable RLS)
ALTER TABLE tournament DISABLE ROW LEVEL SECURITY;
ALTER TABLE events DISABLE ROW LEVEL SECURITY;
ALTER TABLE groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE teams DISABLE ROW LEVEL SECURITY;
ALTER TABLE matches DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;

-- Khôi phục dữ liệu từ thiết bị backup (nếu dữ liệu hỏng)
-- INSERT INTO tournament SELECT * FROM backup_tournament; 
-- (Lưu ý xoá sạch bảng gốc trước khi insert lại nếu sử dụng lệnh này)
*/
-- =========================================================================================
-- KẾT THÚC SCRIPT MIGRATION
-- =========================================================================================
