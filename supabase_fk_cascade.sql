-- ====================================================================
-- SQL SCRIPT: THIẾT LẬP FOREIGN KEYS CASCADING VÀ CỘT KNOCKOUT MỚI
-- ====================================================================

-- 1. THÊM CỘT CHO CẤU TRÚC KNOCKOUT BINARY TREE TRONG BẢNG MATCHES
ALTER TABLE matches ADD COLUMN IF NOT EXISTS placeholder_a VARCHAR(255) NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS placeholder_b VARCHAR(255) NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS next_match_id VARCHAR(255) NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS next_match_slot VARCHAR(1) NULL;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_next_match_slot') THEN
        ALTER TABLE matches DROP CONSTRAINT chk_next_match_slot;
    END IF;
END $$;
ALTER TABLE matches ADD CONSTRAINT chk_next_match_slot CHECK (next_match_slot IN ('A', 'B'));

-- 2. XOÁ CÁC KHÓA NGOẠI HIỆN TẠI TRONG BẢNG MATCHES (nếu có)
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = 'matches' AND constraint_type = 'FOREIGN KEY'
    ) LOOP
        EXECUTE 'ALTER TABLE matches DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
    END LOOP;
END $$;

-- 2. THIẾT LẬP LẠI KHÓA NGOẠI BẢNG MATCHES
-- Ràng buộc team_a_id -> teams(id)
ALTER TABLE matches
    ADD CONSTRAINT fk_matches_team_a 
    FOREIGN KEY (team_a_id) REFERENCES teams(id)
    ON DELETE CASCADE;

-- Ràng buộc team_b_id -> teams(id)
ALTER TABLE matches
    ADD CONSTRAINT fk_matches_team_b 
    FOREIGN KEY (team_b_id) REFERENCES teams(id)
    ON DELETE CASCADE;

-- Ràng buộc group_id -> groups(id) 
-- Nếu group_id là "knockout", nó sẽ bị lỗi vì "knockout" không tồn tại trong bảng groups!
-- LƯU Ý: Do thiết kế phần mềm dùng group_id = "knockout" để đánh dấu vòng loại trực tiếp, bạn KHÔNG thể tạo FOREIGN KEY chặt cho group_id trừ khi 'knockout' được lưu vào bảng groups.
-- Do đó chúng ta chỉ ràng buộc bằng Trigger hoặc có thể bỏ qua Ràng buộc cứng group_id ở bảng matches.
-- Nhưng ta VẪN dọn dẹp các Ràng buộc cứng đã xoá ở trên để khỏi lỗi hệ thống.

-- Chúng ta có thể thêm ràng buộc cho next_match_id (Binary Tree) cho vòng Knockout (yêu cầu trước của bạn)
ALTER TABLE matches 
    ADD CONSTRAINT fk_matches_next_match
    FOREIGN KEY (next_match_id) REFERENCES matches(id) 
    ON DELETE SET NULL;


-- 3. XOÁ CÁC KHÓA NGOẠI HIỆN TẠI TRONG BẢNG TEAMS (nếu có)
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = 'teams' AND constraint_type = 'FOREIGN KEY'
    ) LOOP
        EXECUTE 'ALTER TABLE teams DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
    END LOOP;
END $$;

-- 4. THIẾT LẬP LẠI KHÓA NGOẠI BẢNG TEAMS
-- Ràng buộc group_id -> groups(id)
ALTER TABLE teams
    ADD CONSTRAINT fk_teams_group
    FOREIGN KEY (group_id) REFERENCES groups(id)
    ON DELETE CASCADE;
