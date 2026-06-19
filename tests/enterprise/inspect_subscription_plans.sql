SELECT
  p.*
FROM public.subscription_plans p
ORDER BY p.created_at NULLS LAST, p.name NULLS LAST
LIMIT 20;
