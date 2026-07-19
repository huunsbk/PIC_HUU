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
  ) AS generated
), duplicate_pairs AS (
  SELECT team_count, count(*)::integer AS duplicate_count
  FROM (
    SELECT
      team_count,
      LEAST(team_a_id, team_b_id),
      GREATEST(team_a_id, team_b_id)
    FROM pairs
    GROUP BY team_count, LEAST(team_a_id, team_b_id), GREATEST(team_a_id, team_b_id)
    HAVING count(*) > 1
  ) duplicates
  GROUP BY team_count
), round_conflicts AS (
  SELECT team_count, count(*)::integer AS conflict_count
  FROM (
    SELECT team_count, round_no, team_id
    FROM (
      SELECT team_count, round_no, team_a_id AS team_id FROM pairs
      UNION ALL
      SELECT team_count, round_no, team_b_id AS team_id FROM pairs
    ) round_teams
    GROUP BY team_count, round_no, team_id
    HAVING count(*) > 1
  ) conflicts
  GROUP BY team_count
), team_match_counts AS (
  SELECT team_count, min(match_count)::integer AS min_matches, max(match_count)::integer AS max_matches
  FROM (
    SELECT team_count, team_id, count(*)::integer AS match_count
    FROM (
      SELECT team_count, team_a_id AS team_id FROM pairs
      UNION ALL
      SELECT team_count, team_b_id AS team_id FROM pairs
    ) appearances
    GROUP BY team_count, team_id
  ) counts
  GROUP BY team_count
)
SELECT
  test_cases.team_count,
  count(pairs.*)::integer AS actual_matches,
  (test_cases.team_count * (test_cases.team_count - 1) / 2)::integer AS expected_matches,
  count(DISTINCT pairs.round_no)::integer AS actual_rounds,
  CASE
    WHEN mod(test_cases.team_count, 2) = 0 THEN test_cases.team_count - 1
    ELSE test_cases.team_count
  END AS expected_rounds,
  COALESCE(duplicate_pairs.duplicate_count, 0) AS duplicate_pairs,
  COALESCE(round_conflicts.conflict_count, 0) AS same_team_twice_in_round,
  team_match_counts.min_matches,
  team_match_counts.max_matches,
  bool_and(pairs.team_a_id IS NOT NULL AND pairs.team_b_id IS NOT NULL) AS no_bye_matches
FROM test_cases
JOIN pairs USING (team_count)
LEFT JOIN duplicate_pairs USING (team_count)
LEFT JOIN round_conflicts USING (team_count)
LEFT JOIN team_match_counts USING (team_count)
GROUP BY
  test_cases.team_count,
  duplicate_pairs.duplicate_count,
  round_conflicts.conflict_count,
  team_match_counts.min_matches,
  team_match_counts.max_matches
ORDER BY test_cases.team_count;
