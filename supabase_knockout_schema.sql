-- ====================================================================
-- SQL SCRIPT CẬP NHẬT CẤU TRÚC KNOCKOUT VÀ FOREIGN KEYS CHO BẢNG MATCHES
-- ====================================================================

-- 1. Thêm cột placeholder_a và placeholder_b
ALTER TABLE matches ADD COLUMN IF NOT EXISTS placeholder_a VARCHAR(255) NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS placeholder_b VARCHAR(255) NULL;

-- 2. Đảm bảo next_match_id và next_match_slot tồn tại
ALTER TABLE matches ADD COLUMN IF NOT EXISTS next_match_id VARCHAR(255) NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS next_match_slot VARCHAR(1) NULL;

-- 3. Cập nhật Foreign Key cho next_match_id trỏ về matches(id) ON DELETE SET NULL
-- Cần xoá constraint cũ nếu có
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_matches_next_match') THEN
        ALTER TABLE matches DROP CONSTRAINT fk_matches_next_match;
    END IF;
END $$;
ALTER TABLE matches ADD CONSTRAINT fk_matches_next_match FOREIGN KEY (next_match_id) REFERENCES matches(id) ON DELETE SET NULL;

-- 4. Ràng buộc next_match_slot chỉ nhận 'A' hoặc 'B'
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_next_match_slot') THEN
        ALTER TABLE matches DROP CONSTRAINT chk_next_match_slot;
    END IF;
END $$;
ALTER TABLE matches ADD CONSTRAINT chk_next_match_slot CHECK (next_match_slot IN ('A', 'B'));
