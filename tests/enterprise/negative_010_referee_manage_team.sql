WITH auth_ctx AS (
  SELECT
    set_config('request.jwt.claim.sub', 'eab3695a-9d0a-4d5c-b0f4-aaf3057573a3', true) AS auth_sub,
    set_config('role', 'authenticated', true) AS auth_role
)
SELECT public.create_team_v1('evt_6da72de38f5c469d8e829348c92dfde2', 'cto_referee_block_probe', 'none') FROM auth_ctx;
