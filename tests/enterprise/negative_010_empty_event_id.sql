WITH auth_ctx AS (
  SELECT
    set_config('request.jwt.claim.sub', '652b872b-e3a9-4d48-8388-1f0ea1289be6', true) AS auth_sub,
    set_config('role', 'authenticated', true) AS auth_role
)
SELECT public.create_team_v1('', 'cto_negative_probe', 'none') FROM auth_ctx;
