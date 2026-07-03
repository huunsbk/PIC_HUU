-- ====================================================================
-- SQL SCRIPT: DATABASE TRIGGER XỬ LÝ AUTO-ADVANCEMENT CHO KNOCKOUT
-- ====================================================================

-- 1. Tạo hoặc thay thế Hàm (Function) thực thi logic
CREATE OR REPLACE FUNCTION trg_auto_advance_winner()
RETURNS TRIGGER AS $$
DECLARE
    v_winner_id VARCHAR;
BEGIN
    -- Chỉ áp dụng cho các trận đấu thuộc vòng Knockout có cấu hình next_match
    IF NEW.next_match_id IS NOT NULL AND NEW.next_match_slot IN ('A', 'B') THEN
        
        -- KỊCH BẢN 1: Trận đấu vừa kết thúc hoặc admin đổi kết quả dẫn đến đổi người thắng
        IF (NEW.status = 'finished' AND (OLD.status IS DISTINCT FROM 'finished' OR OLD.winner_id IS DISTINCT FROM NEW.winner_id)) THEN
            
            -- Lấy ID đội thắng từ dữ liệu cập nhật
            v_winner_id := NEW.winner_id;
            
            -- Fallback: Nếu vì lý do nào đó app không truyền winner_id, ta tự tính
            IF v_winner_id IS NULL AND NEW.score_a IS NOT NULL AND NEW.score_b IS NOT NULL THEN
                IF NEW.score_a > NEW.score_b THEN
                    v_winner_id := NEW.team_a_id;
                ELSIF NEW.score_b > NEW.score_a THEN
                    v_winner_id := NEW.team_b_id;
                END IF;
                -- Lưu ý: Pickleball không có tỷ số hòa trong đấu loại trực tiếp. 
                -- Nếu trường hợp score_a = score_b xảy ra, v_winner_id sẽ giữ NULL và không đẩy đội nào đi tiếp.
            END IF;

            -- Nếu đã xác định được người chiến thắng, đẩy vào trận kế tiếp
            IF v_winner_id IS NOT NULL THEN
                IF NEW.next_match_slot = 'A' THEN
                    UPDATE matches 
                    SET team_a_id = v_winner_id,
                        -- Tự động reset tỷ số trận kế vì thành phần tham đấu vừa thay đổi
                        score_a = NULL, score_b = NULL, winner_id = NULL, status = 'pending'
                    WHERE id = NEW.next_match_id;
                ELSIF NEW.next_match_slot = 'B' THEN
                    UPDATE matches 
                    SET team_b_id = v_winner_id,
                        -- Tự động reset tỷ số trận kế vì thành phần tham đấu vừa thay đổi
                        score_a = NULL, score_b = NULL, winner_id = NULL, status = 'pending'
                    WHERE id = NEW.next_match_id;
                END IF;
            END IF;
            
        -- KỊCH BẢN 2: Trận đấu bị Hủy / Reset (Từ finished -> pending)
        ELSIF NEW.status = 'pending' AND OLD.status = 'finished' THEN
            -- Xóa đội tương ứng khỏi trận đấu kế tiếp
            IF NEW.next_match_slot = 'A' THEN
                UPDATE matches 
                SET team_a_id = NULL, score_a = NULL, score_b = NULL, winner_id = NULL, status = 'pending'
                WHERE id = NEW.next_match_id;
            ELSIF NEW.next_match_slot = 'B' THEN
                UPDATE matches 
                SET team_b_id = NULL, score_a = NULL, score_b = NULL, winner_id = NULL, status = 'pending'
                WHERE id = NEW.next_match_id;
            END IF;
        END IF;

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Đăng ký Trigger ăn theo bảng matches
DROP TRIGGER IF EXISTS trg_auto_advance_winner_trigger ON matches;
CREATE TRIGGER trg_auto_advance_winner_trigger
AFTER UPDATE OF status, score_a, score_b, winner_id
ON matches
FOR EACH ROW
EXECUTE FUNCTION trg_auto_advance_winner();
