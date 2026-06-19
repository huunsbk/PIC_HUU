WITH auth_ctx AS (
  SELECT
    set_config('request.jwt.claim.sub', '652b872b-e3a9-4d48-8388-1f0ea1289be6', true) AS auth_sub,
    set_config('role', 'authenticated', true) AS auth_role
)
SELECT public.reset_match_score_v1('match_missing_010_probe') FROM auth_ctx;
