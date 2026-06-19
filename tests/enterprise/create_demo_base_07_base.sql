SELECT set_config('request.jwt.claim.sub', '652b872b-e3a9-4d48-8388-1f0ea1289be6', true);
SELECT set_config('role', 'authenticated', true);

CREATE TEMP TABLE __demo_base_result (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

WITH existing_tenant AS (
  SELECT id, name, slug, status
  FROM public.tenants
  WHERE slug = 'clb-thang-oanh'
  LIMIT 1
),
created_tenant AS (
  SELECT public.create_tenant_v1('CLB Thắng Oanh', 'clb-thang-oanh') AS tenant_json
  WHERE NOT EXISTS (SELECT 1 FROM existing_tenant)
),
selected_tenant AS (
  SELECT to_jsonb(existing_tenant.*) AS tenant_json
  FROM existing_tenant
  UNION ALL
  SELECT tenant_json FROM created_tenant
),
activated AS (
  SELECT
    CASE
      WHEN COALESCE(tenant_json->>'status', 'active') <> 'active'
        THEN public.update_tenant_v1((tenant_json->>'id')::uuid, tenant_json->>'name', tenant_json->>'slug', 'active')
      ELSE tenant_json
    END AS tenant_json
  FROM selected_tenant
)
INSERT INTO __demo_base_result(key, value)
SELECT 'tenant', tenant_json
FROM activated
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

WITH tenant_row AS (
  SELECT (value->>'id')::uuid AS tenant_id
  FROM __demo_base_result
  WHERE key = 'tenant'
),
selected_plan AS (
  SELECT id AS plan_id, name
  FROM public.subscription_plans
  WHERE is_active IS TRUE
  ORDER BY
    CASE name
      WHEN 'Enterprise' THEN 1
      WHEN 'Business' THEN 2
      WHEN 'Pro' THEN 3
      WHEN 'Starter' THEN 4
      ELSE 5
    END,
    created_at
  LIMIT 1
),
inserted_subscription AS (
  INSERT INTO public.tenant_subscriptions(
    id,
    tenant_id,
    plan_id,
    status,
    start_date,
    end_date,
    auto_renew,
    created_at,
    updated_at
  )
  SELECT
    gen_random_uuid(),
    tenant_row.tenant_id,
    selected_plan.plan_id,
    'active',
    now(),
    now() + interval '1 year',
    false,
    now(),
    now()
  FROM tenant_row
  CROSS JOIN selected_plan
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.tenant_subscriptions ts
    WHERE ts.tenant_id = tenant_row.tenant_id
      AND ts.status = 'active'
  )
  RETURNING *
),
existing_subscription AS (
  SELECT ts.*
  FROM public.tenant_subscriptions ts
  JOIN tenant_row ON tenant_row.tenant_id = ts.tenant_id
  WHERE ts.status = 'active'
  ORDER BY ts.created_at DESC NULLS LAST
  LIMIT 1
),
selected_subscription AS (
  SELECT to_jsonb(inserted_subscription.*) AS subscription_json
  FROM inserted_subscription
  UNION ALL
  SELECT to_jsonb(existing_subscription.*) AS subscription_json
  FROM existing_subscription
  WHERE NOT EXISTS (SELECT 1 FROM inserted_subscription)
)
INSERT INTO __demo_base_result(key, value)
SELECT 'subscription', subscription_json
FROM selected_subscription
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

WITH tenant_row AS (
  SELECT (value->>'id')::uuid AS tenant_id
  FROM __demo_base_result
  WHERE key = 'tenant'
),
existing_tournament AS (
  SELECT *
  FROM public.tournament t
  JOIN tenant_row ON tenant_row.tenant_id = t.tenant_id
  WHERE t.slug = 'thang-oanh'
    AND t.deleted_at IS NULL
  LIMIT 1
),
created_tournament AS (
  SELECT public.create_tournament_v1(
    tenant_row.tenant_id,
    'Giải Pickleball Thắng Oanh 2026',
    'thang-oanh',
    'CLB Thắng Oanh',
    DATE '2026-06-30'
  ) AS tournament_json
  FROM tenant_row
  WHERE NOT EXISTS (SELECT 1 FROM existing_tournament)
),
selected_tournament AS (
  SELECT to_jsonb(existing_tournament.*) AS tournament_json
  FROM existing_tournament
  UNION ALL
  SELECT tournament_json FROM created_tournament
)
INSERT INTO __demo_base_result(key, value)
SELECT 'tournament', tournament_json
FROM selected_tournament
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO __demo_base_result(key, value)
VALUES ('workspace_context', public.get_workspace_context_v1('thang-oanh'))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT key, value
FROM __demo_base_result
ORDER BY key;
