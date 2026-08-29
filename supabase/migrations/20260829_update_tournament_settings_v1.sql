-- Secure RPC for tournament.settings updates.
-- Keeps direct UPDATE on public.tournament unavailable to authenticated clients.

create or replace function public.update_tournament_settings_v1(
  p_tournament_id text,
  p_settings_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_existing public.tournament%rowtype;
  v_tournament public.tournament%rowtype;
  v_is_self_service_owner boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_settings_patch is null or jsonb_typeof(p_settings_patch) <> 'object' then
    raise exception 'Settings patch must be a JSON object';
  end if;

  select * into v_existing
  from public.tournament
  where id = p_tournament_id
    and deleted_at is null;

  if v_existing.id is null then
    raise exception 'Tournament not found';
  end if;

  select exists (
    select 1
    from public.accounts a
    join public.roles r on r.id = a.role_id
    join public.tenants t on t.id = a.tenant_id
    join public.self_service_customer_profiles sscp
      on sscp.account_id = a.id
     and sscp.tenant_id = a.tenant_id
    where a.user_id = auth.uid()
      and a.tenant_id = v_existing.tenant_id
      and a.status = 'active'
      and a.deleted_at is null
      and r.name = 'EVENT_ADMIN'
      and t.tenant_type = 'self_service_customer'
      and t.deleted_at is null
      and sscp.onboarding_status = 'ready'
      and public.business_access_active_v1(t.id)
  ) into v_is_self_service_owner;

  if not v_is_self_service_owner then
    perform public.ensure_manage_tournaments_v1(v_existing.tenant_id);
  end if;

  update public.tournament
  set
    settings = coalesce(settings, '{}'::jsonb) || p_settings_patch,
    updated_at = now()
  where id = p_tournament_id
  returning * into v_tournament;

  return to_jsonb(v_tournament);
end;
$function$;

revoke all on function public.update_tournament_settings_v1(text, jsonb) from public;
revoke all on function public.update_tournament_settings_v1(text, jsonb) from anon;
grant execute on function public.update_tournament_settings_v1(text, jsonb) to authenticated;
grant execute on function public.update_tournament_settings_v1(text, jsonb) to service_role;
