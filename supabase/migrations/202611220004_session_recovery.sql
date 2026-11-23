begin;

alter table pantalla_private.profile add column progress_version bigint not null default 0;
create function pantalla_private.bump_progress_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.progress is distinct from old.progress then new.progress_version := old.progress_version + 1; end if;
  return new;
end;
$$;
create trigger progress_version before update on pantalla_private.profile
for each row execute function pantalla_private.bump_progress_version();

create table pantalla_private.recovery_session (
  user_id uuid not null references auth.users on delete cascade,
  token uuid not null,
  expected_version bigint not null,
  latest_progress jsonb,
  sequence bigint not null default 0,
  closed boolean not null default false,
  primary key (user_id, token)
);
alter table pantalla_private.recovery_session enable row level security;
revoke all on pantalla_private.recovery_session from public, anon, authenticated;

-- Conservamos el contrato anterior y envolvemos sus transacciones.
alter function public.ps_account_monitor(uuid, text, uuid, jsonb, jsonb)
rename to ps_account_monitor_before_recovery;
revoke all on function public.ps_account_monitor_before_recovery(uuid, text, uuid, jsonb, jsonb)
from public, anon, authenticated;

create function public.ps_account_monitor(p_user uuid, p_action text, p_token uuid, p_days jsonb, p_progress jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := pantalla_private.google_user();
  result jsonb;
  authorized boolean;
begin
  if p_user is distinct from owner_id then raise exception 'Account changed' using errcode = '42501'; end if;
  -- El permiso se bloquea antes del perfil para mantener el orden del resto de funciones.
  insert into pantalla_private.monitor(user_id) values(owner_id) on conflict do nothing;
  perform 1 from pantalla_private.monitor where user_id = owner_id for update;
  select holder = p_token and expires_at > clock_timestamp() into authorized
    from pantalla_private.monitor where user_id = owner_id;
  result := public.ps_account_monitor_before_recovery(p_user, p_action, p_token, p_days, p_progress);
  if result->>'status' in ('active', 'moving') or p_action = 'release' then
    insert into pantalla_private.profile(user_id) values(owner_id) on conflict do nothing;
    if p_action in ('claim','move') and result->>'status' = 'active' then
      insert into pantalla_private.recovery_session(user_id, token, expected_version, latest_progress)
      select owner_id, p_token, progress_version, progress from pantalla_private.profile where user_id = owner_id
      on conflict do nothing;
    elsif authorized then
      update pantalla_private.recovery_session r set
        expected_version = p.progress_version,
        latest_progress = p.progress
      from pantalla_private.profile p where p.user_id = owner_id and r.user_id = owner_id and r.token = p_token;
    end if;
  end if;
  return result;
end;
$$;

create function public.ps_recover_session(p_user uuid, p_token uuid, p_sequence bigint, p_days jsonb, p_progress jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := pantalla_private.google_user();
  pending pantalla_private.recovery_session%rowtype;
  profile pantalla_private.profile%rowtype;
  monitoring pantalla_private.monitor%rowtype;
begin
  if p_user is distinct from owner_id then raise exception 'Account changed' using errcode = '42501'; end if;
  if p_sequence is null or p_sequence < 1 then raise exception 'Invalid recovery sequence'; end if;
  select * into monitoring from pantalla_private.monitor where user_id = owner_id for update;
  select * into pending from pantalla_private.recovery_session where user_id = owner_id and token = p_token for update;
  if not found then raise exception 'Unknown recovery session'; end if;
  if pending.closed and p_sequence <= pending.sequence then return jsonb_build_object('status','recovered'); end if;
  if monitoring.holder is not null and monitoring.expires_at > clock_timestamp() then
    return jsonb_build_object('status','waiting');
  end if;
  select * into profile from pantalla_private.profile where user_id = owner_id for update;
  perform pantalla_private.valid_progress(p_progress);
  perform pantalla_private.store_days(owner_id, p_token, p_days, false);
  if p_progress is not distinct from pending.latest_progress then
    update pantalla_private.recovery_session set closed = true, sequence = p_sequence
      where user_id = owner_id and token = p_token;
    return jsonb_build_object('status','recovered');
  end if;
  -- Una versión confirmada por otro equipo nunca se sustituye con una copia anterior.
  if profile.progress_version <> pending.expected_version and profile.progress is distinct from p_progress then
    return jsonb_build_object('status','conflict');
  end if;
  update pantalla_private.profile set progress = p_progress where user_id = owner_id;
  update pantalla_private.recovery_session set closed = true, sequence = p_sequence,
    expected_version = (select progress_version from pantalla_private.profile where user_id = owner_id),
    latest_progress = p_progress where user_id = owner_id and token = p_token;
  return jsonb_build_object('status','recovered');
end;
$$;

revoke all on function pantalla_private.bump_progress_version() from public, anon, authenticated;
revoke all on function public.ps_account_monitor(uuid,text,uuid,jsonb,jsonb),
  public.ps_recover_session(uuid,uuid,bigint,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.ps_account_monitor(uuid,text,uuid,jsonb,jsonb),
  public.ps_recover_session(uuid,uuid,bigint,jsonb,jsonb) to authenticated;
commit;
