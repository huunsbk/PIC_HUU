SELECT
  (SELECT count(*) FROM public.tenant_subscriptions WHERE status IN ('active', 'trial', 'scheduled')) AS active_or_scheduled_subscriptions,
  (SELECT COALESCE(jsonb_object_agg(status, status_count), '{}'::jsonb) FROM (
    SELECT status, count(*) AS status_count
    FROM public.tenant_subscriptions
    GROUP BY status
  ) AS grouped_subscription_statuses) AS subscription_status_counts,
  (SELECT count(*) FROM public.payment_orders WHERE status IN ('awaiting_payment', 'manual_review', 'payment_mismatch')) AS open_payment_orders,
  (SELECT count(*) FROM public.payment_orders WHERE client_request_id LIKE 'test-061-%') AS rollback_test_orders_remaining,
  (SELECT count(*) FROM (
    SELECT t.event_id
    FROM public.teams AS t
    WHERE t.deleted_at IS NULL
    GROUP BY t.event_id
    HAVING count(*) > 48
  ) AS over_48) AS events_over_48_teams,
  (SELECT count(*) FROM (
    SELECT t.event_id
    FROM public.teams AS t
    WHERE t.deleted_at IS NULL
    GROUP BY t.event_id
    HAVING count(*) > 64
  ) AS over_64) AS events_over_64_teams,
  (SELECT count(*) FROM (
    SELECT t.event_id
    FROM public.teams AS t
    WHERE t.deleted_at IS NULL
    GROUP BY t.event_id
    HAVING count(*) > 96
  ) AS over_96) AS events_over_96_teams,
  (SELECT COALESCE(max(team_count), 0) FROM (
    SELECT count(*) AS team_count
    FROM public.teams AS t
    WHERE t.deleted_at IS NULL
    GROUP BY t.event_id
  ) AS per_event) AS largest_event_team_count;
