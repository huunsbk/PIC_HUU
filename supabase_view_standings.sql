-- ====================================================================
-- SQL SCRIPT CẬP NHẬT DATABASE VIEW CHO BẢNG XẾP HẠNG
-- Chạy tự do trên Supabase SQL Editor
-- ====================================================================

CREATE OR REPLACE VIEW view_team_standings AS
WITH team_stats AS (
    SELECT 
        t.tenant_id,
        t.event_id,
        t.group_id,
        t.id AS team_id,
        t.name AS team_name,
        t.seed,
        COALESCE(COUNT(m.id) FILTER (WHERE m.status = 'finished' AND (m.score_a IS NOT NULL OR m.score_b IS NOT NULL)), 0)::int AS matches_played,
        COALESCE(COUNT(m.id) FILTER (WHERE m.status = 'finished' AND m.winner_id = t.id), 0)::int AS matches_won,
        COALESCE(COUNT(m.id) FILTER (WHERE m.status = 'finished' AND m.winner_id IS NOT NULL AND m.winner_id != t.id), 0)::int AS matches_lost,
        COALESCE(SUM(CASE WHEN m.team_a_id = t.id THEN m.score_a ELSE m.score_b END) FILTER (WHERE m.status = 'finished'), 0)::int AS points_won,
        COALESCE(SUM(CASE WHEN m.team_a_id = t.id THEN m.score_b ELSE m.score_a END) FILTER (WHERE m.status = 'finished'), 0)::int AS points_lost,
        COALESCE(MAX((e.settings->>'winPoint')::int), 2) AS win_point,
        COALESCE(MAX((e.settings->>'lossPoint')::int), 1) AS loss_point
    FROM teams t
    LEFT JOIN matches m ON m.group_id = t.group_id AND (m.team_a_id = t.id OR m.team_b_id = t.id)
    JOIN events e ON t.event_id = e.id
    GROUP BY t.tenant_id, t.event_id, t.group_id, t.id, t.name, t.seed
),
calculated AS (
    SELECT 
        tenant_id,
        event_id,
        group_id,
        team_id,
        team_name,
        seed,
        matches_played,
        matches_won,
        matches_lost,
        matches_won AS sets_won,
        matches_lost AS sets_lost,
        points_won,
        points_lost,
        (points_won - points_lost) AS point_diff,
        (matches_won * win_point + matches_lost * loss_point) AS points
    FROM team_stats
)
SELECT 
    tenant_id,
    event_id,
    group_id,
    team_id,
    team_name,
    seed,
    matches_played,
    matches_won,
    matches_lost,
    sets_won,
    sets_lost,
    points_won,
    points_lost,
    point_diff,
    points,
    RANK() OVER (
        PARTITION BY tenant_id, event_id, group_id 
        ORDER BY points DESC, point_diff DESC, points_won DESC
    )::int AS rank
FROM calculated;
