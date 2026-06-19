SELECT set_config('request.jwt.claim.sub', '652b872b-e3a9-4d48-8388-1f0ea1289be6', true);
SELECT set_config('role', 'authenticated', true);

CREATE TEMP TABLE __demo_event_seed_result (
  event_name text PRIMARY KEY,
  result jsonb NOT NULL
);

WITH tournament_row AS (
  SELECT id
  FROM public.tournament
  WHERE slug = 'thang-oanh'
    AND deleted_at IS NULL
  LIMIT 1
),
seed_events(name, sport_id, competition_type, format_type, scoring_config, ranking_config) AS (
  VALUES
    (
      'Đôi Nam',
      'sport_pickleball',
      'doubles',
      'group_then_knockout',
      '{"matchSetMode":"single","numberOfSets":1,"setsToWin":1,"maxScore":15,"capScore":17,"winByTwo":true,"allowDraw":false}'::jsonb,
      '{"groupCount":4,"top_per_group":2,"best_third_count":0}'::jsonb
    ),
    (
      'Đôi Nữ',
      'sport_pickleball',
      'doubles',
      'group_then_knockout',
      '{"matchSetMode":"single","numberOfSets":1,"setsToWin":1,"maxScore":15,"capScore":17,"winByTwo":true,"allowDraw":false}'::jsonb,
      '{"groupCount":2,"top_per_group":2,"best_third_count":0}'::jsonb
    ),
    (
      'Đôi Nam Nữ',
      'sport_pickleball',
      'doubles',
      'group_then_knockout',
      '{"matchSetMode":"single","numberOfSets":1,"setsToWin":1,"maxScore":15,"capScore":17,"winByTwo":true,"allowDraw":false}'::jsonb,
      '{"groupCount":2,"top_per_group":2,"best_third_count":0}'::jsonb
    )
),
created AS (
  SELECT
    seed_events.name,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.events e
        JOIN tournament_row tr ON tr.id = e.tournament_id
        WHERE e.name = seed_events.name
          AND e.deleted_at IS NULL
      )
      THEN (
        SELECT jsonb_build_object('success', true, 'event_id', e.id, 'event', to_jsonb(e), 'reused', true)
        FROM public.events e
        JOIN tournament_row tr ON tr.id = e.tournament_id
        WHERE e.name = seed_events.name
          AND e.deleted_at IS NULL
        LIMIT 1
      )
      ELSE public.create_event_v1(
        (SELECT id FROM tournament_row),
        seed_events.name,
        seed_events.sport_id,
        seed_events.competition_type,
        seed_events.format_type,
        seed_events.scoring_config,
        seed_events.ranking_config
      )
    END AS result
  FROM seed_events
)
INSERT INTO __demo_event_seed_result(event_name, result)
SELECT name, result
FROM created
ON CONFLICT (event_name) DO UPDATE SET result = EXCLUDED.result;

SELECT event_name, result
FROM __demo_event_seed_result
ORDER BY event_name;
