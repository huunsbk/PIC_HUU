-- ====================================================================
-- SQL SCRIPT CẬP NHẬT DATABASE FUNCTION CHO SUPABASE
-- Hãy sao chép toàn bộ đoạn mã này và chạy trong mục "SQL Editor" của Supabase
-- ====================================================================

CREATE OR REPLACE FUNCTION generate_round_robin_schedule(p_tenant_id TEXT, p_group_id TEXT)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_team_ids jsonb;
  v_num_teams int;
  v_team_arr text[];
  v_event_id text;
  v_has_bye boolean := false;
  v_n int;
  v_num_rounds int;
  v_matches_per_round int;
  v_home text;
  v_away text;
  v_temp text;
  v_round int;
  v_match_idx int;
  v_match_id text;
BEGIN
  -- 1. Lấy thông tin bảng
  SELECT team_ids, event_id INTO v_team_ids, v_event_id
  FROM groups
  WHERE id = p_group_id AND tenant_id = p_tenant_id;

  IF v_team_ids IS NULL THEN
     RETURN json_build_object('success', false, 'message', 'Bảng đấu không tồn tại hoặc sai Tenant ID.');
  END IF;

  v_num_teams := jsonb_array_length(v_team_ids);
  IF v_num_teams < 2 THEN
     RETURN json_build_object('success', false, 'message', 'Bảng đấu cần ít nhất 2 đội.');
  END IF;

  -- 2. Xóa các trận đấu cũ của bảng này
  DELETE FROM matches WHERE group_id = p_group_id AND tenant_id = p_tenant_id;

  -- 3. Chuyển JSONB thành mảng text[]
  SELECT array_agg(value#>>'{}') INTO v_team_arr FROM jsonb_array_elements(v_team_ids);

  -- 4. Áp dụng thuật toán tạo xoay vòng (Circle Method)
  IF v_num_teams % 2 <> 0 THEN
      v_team_arr := array_append(v_team_arr, 'BYE');
      v_has_bye := true;
  END IF;

  v_n := array_length(v_team_arr, 1);
  v_num_rounds := v_n - 1;
  v_matches_per_round := v_n / 2;

  FOR v_round IN 1 .. v_num_rounds LOOP
      FOR v_match_idx IN 0 .. (v_matches_per_round - 1) LOOP
          v_home := v_team_arr[v_match_idx + 1];
          v_away := v_team_arr[v_n - v_match_idx];

          IF v_home <> 'BYE' AND v_away <> 'BYE' THEN
              -- Sinh ID độc nhất (prefix m_)
              v_match_id := 'm_' || (extract(epoch from clock_timestamp()) * 1000000 + v_round * 100 + v_match_idx)::bigint::text;
              INSERT INTO matches (id, tenant_id, group_id, team_a_id, team_b_id, status, round, event_id)
              VALUES (v_match_id, p_tenant_id, p_group_id, v_home, v_away, 'pending', v_round, v_event_id);
          END IF;
      END LOOP;

      -- Xoay mảng: Giữ nguyên index 1, dịch mảng bên phải qua
      IF v_n > 2 THEN
          v_temp := v_team_arr[v_n];
          FOR i IN REVERSE v_n .. 3 LOOP
              v_team_arr[i] := v_team_arr[i - 1];
          END LOOP;
          v_team_arr[2] := v_temp;
      END IF;
  END LOOP;

  RETURN json_build_object('success', true, 'message', 'Khởi tạo trận đấu thành công.');
END;
$$;
