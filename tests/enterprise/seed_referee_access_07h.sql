CREATE TEMP TABLE __referee_access_seed_result (
  eligible_referee_count integer,
  event_id text,
  referee_username text,
  grant_result jsonb
);

SELECT set_config('request.jwt.claim.sub', '652b872b-e3a9-4d48-8388-1f0ea1289be6', true);

WITH demo_event AS (
  SELECT e.id, e.tenant_id
  FROM public.events e
  JOIN public.tournament t ON t.id = e.tournament_id
  WHERE t.slug = 'thang-oanh'
    AND e.name = 'Đôi Nam'
    AND e.deleted_at IS NULL
  LIMIT 1
),
eligible_referee AS (
  SELECT a.id, a.username, a.display_name
  FROM public.accounts a
  JOIN public.roles r ON r.id = a.role_id
  JOIN demo_event de ON de.tenant_id = a.tenant_id
  WHERE r.name = 'REFEREE'
    AND a.status = 'active'
    AND a.deleted_at IS NULL
  ORDER BY a.created_at
  LIMIT 1
),
grant_result AS (
  SELECT public.grant_event_access_v1(
    (SELECT id FROM demo_event),
    (SELECT id::text FROM eligible_referee),
    'enter_scores'
  ) AS result
  WHERE EXISTS (SELECT 1 FROM eligible_referee)
)
INSERT INTO __referee_access_seed_result(eligible_referee_count, event_id, referee_username, grant_result)
SELECT
  (SELECT count(*) FROM eligible_referee) AS eligible_referee_count,
  (SELECT id FROM demo_event) AS event_id,
  (SELECT username FROM eligible_referee) AS referee_username,
  COALESCE((SELECT result FROM grant_result), '{"success": false, "reason": "No active REFEREE account in demo tenant"}'::jsonb) AS grant_result;

SELECT *
FROM __referee_access_seed_result;
