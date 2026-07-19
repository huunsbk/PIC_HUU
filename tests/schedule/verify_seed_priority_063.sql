WITH test_cases(team_count) AS (
  VALUES (3), (4), (5), (6), (7), (48), (64), (96)
), pairs AS (
  SELECT
    test_cases.team_count,
    generated.round_no,
    generated.match_in_round,
    generated.team_a_id,
    generated.team_b_id
  FROM test_cases
  CROSS JOIN LATERAL public.build_round_robin_pairs_v1(
    ARRAY(
      SELECT 'team-' || n::text
      FROM generate_series(1, test_cases.team_count) AS n
    )
  ) generated
), opening_round AS (
  SELECT
    team_count,
    bool_and(
      team_a_id = 'team-' || ((match_in_round * 2) - 1)::text
      AND team_b_id = 'team-' || (match_in_round * 2)::text
    ) AS adjacent_seed_pairs
  FROM pairs
  WHERE round_no = 1
  GROUP BY team_count
), second_round AS (
  SELECT
    team_count,
    bool_or(
      LEAST(team_a_id, team_b_id) = 'team-1'
      AND GREATEST(team_a_id, team_b_id) = 'team-3'
    ) AS seed_one_meets_seed_three
  FROM pairs
  WHERE round_no = 2
  GROUP BY team_count
), duplicates AS (
  SELECT team_count, count(*)::integer AS duplicate_count
  FROM (
    SELECT team_count, LEAST(team_a_id, team_b_id), GREATEST(team_a_id, team_b_id)
    FROM pairs
    GROUP BY team_count, LEAST(team_a_id, team_b_id), GREATEST(team_a_id, team_b_id)
    HAVING count(*) > 1
  ) duplicate_rows
  GROUP BY team_count
), conflicts AS (
  SELECT team_count, count(*)::integer AS conflict_count
  FROM (
    SELECT team_count, round_no, team_id
    FROM (
      SELECT team_count, round_no, team_a_id AS team_id FROM pairs
      UNION ALL
      SELECT team_count, round_no, team_b_id AS team_id FROM pairs
    ) appearances
    GROUP BY team_count, round_no, team_id
    HAVING count(*) > 1
  ) conflict_rows
  GROUP BY team_count
)
SELECT
  test_cases.team_count,
  count(pairs.*)::integer AS actual_matches,
  (test_cases.team_count * (test_cases.team_count - 1) / 2)::integer AS expected_matches,
  count(DISTINCT pairs.round_no)::integer AS actual_rounds,
  CASE WHEN mod(test_cases.team_count, 2) = 0
    THEN test_cases.team_count - 1
    ELSE test_cases.team_count
  END AS expected_rounds,
  opening_round.adjacent_seed_pairs,
  second_round.seed_one_meets_seed_three,
  COALESCE(duplicates.duplicate_count, 0) AS duplicate_pairs,
  COALESCE(conflicts.conflict_count, 0) AS same_team_twice_in_round
FROM test_cases
JOIN pairs USING (team_count)
JOIN opening_round USING (team_count)
JOIN second_round USING (team_count)
LEFT JOIN duplicates USING (team_count)
LEFT JOIN conflicts USING (team_count)
GROUP BY
  test_cases.team_count,
  opening_round.adjacent_seed_pairs,
  second_round.seed_one_meets_seed_three,
  duplicates.duplicate_count,
  conflicts.conflict_count
ORDER BY test_cases.team_count;
