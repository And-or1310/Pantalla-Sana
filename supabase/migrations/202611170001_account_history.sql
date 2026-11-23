begin;

create schema if not exists pantalla_private;
revoke all on schema pantalla_private from public, anon, authenticated;

create table pantalla_private.monitor (
  user_id uuid primary key references auth.users on delete cascade,
  holder uuid,
  expires_at timestamptz,
  next_holder uuid,
  reserved_until timestamptz
);

create table pantalla_private.daily_metrics (
  user_id uuid not null references auth.users on delete cascade,
  source uuid not null,
  day date not null,
  imported boolean not null,
  metrics jsonb not null,
  primary key (user_id, source, day)
);
create index daily_metrics_user_day on pantalla_private.daily_metrics (user_id, day);
alter table pantalla_private.monitor enable row level security;
alter table pantalla_private.daily_metrics enable row level security;
revoke all on all tables in schema pantalla_private from public, anon, authenticated;

create function pantalla_private.google_user() returns uuid
language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null or (auth.jwt()->'app_metadata'->>'provider') is distinct from 'google' then
    raise exception 'Google sign-in required' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

create function pantalla_private.store_days(p_user uuid, p_source uuid, p_days jsonb, p_import boolean)
returns void language plpgsql set search_path = '' as $$
declare
  item record;
  reading record;
  values_for_day jsonb;
  day_date date;
  field text;
  fields constant text[] := array['session_sec','good_sec','total_sec','bpm_w','bpm_sec','alerts','hours'];
begin
  if jsonb_typeof(p_days) is distinct from 'object' or octet_length(p_days::text) > 131072 then
    raise exception 'Invalid metrics';
  end if;
  for item in select key, value from jsonb_each(p_days) loop
    day_date := item.key::date;
    values_for_day := item.value;
    if item.key !~ '^\d{4}-\d{2}-\d{2}$'
      or day_date not between current_date - 65 and current_date + 2
      or jsonb_typeof(values_for_day) is distinct from 'object'
      or not (values_for_day ?& fields) or (values_for_day - fields) <> '{}'::jsonb
      or jsonb_typeof(values_for_day->'alerts') is distinct from 'object'
      or jsonb_typeof(values_for_day->'hours') is distinct from 'object' then
      raise exception 'Invalid daily metrics';
    end if;
    foreach field in array fields[1:5] loop
      if jsonb_typeof(values_for_day->field) is distinct from 'number'
        or (values_for_day->>field)::numeric not between 0 and
          (case when field = 'bpm_w' then 86400000 else 90000 end) then
        raise exception 'Invalid metric value';
      end if;
    end loop;
    for reading in select key, value from jsonb_each(values_for_day->'alerts') loop
      if reading.key not in ('slouch','close','tilt','roll','blink','sleep','pause')
        or jsonb_typeof(reading.value) is distinct from 'number'
        or reading.value::numeric not between 0 and 10000 then
        raise exception 'Invalid alert count';
      end if;
    end loop;
    for reading in select key, value from jsonb_each(values_for_day->'hours') loop
      if reading.key !~ '^([01][0-9]|2[0-3])$' or jsonb_typeof(reading.value) is distinct from 'array' then
        raise exception 'Invalid hourly metrics';
      end if;
      if jsonb_array_length(reading.value) <> 2
        or jsonb_typeof(reading.value->0) is distinct from 'number'
        or jsonb_typeof(reading.value->1) is distinct from 'number'
        or (reading.value->>0)::numeric not between 0 and (reading.value->>1)::numeric
        or (reading.value->>1)::numeric not between 0 and 7300 then
        raise exception 'Invalid hourly values';
      end if;
    end loop;
    insert into pantalla_private.daily_metrics as d (user_id, source, day, imported, metrics)
    values (p_user, p_source, day_date, p_import, values_for_day)
    on conflict (user_id, source, day) do update set metrics = excluded.metrics
      where not p_import and not d.imported
        and (excluded.metrics->>'session_sec')::numeric >= (d.metrics->>'session_sec')::numeric;
  end loop;
end;
$$;

create function public.ps_monitor(p_user uuid, p_action text, p_token uuid, p_days jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account uuid := pantalla_private.google_user();
  lease pantalla_private.monitor%rowtype;
  stamp timestamptz;
begin
  if p_user is distinct from account then raise exception 'Account changed' using errcode = '42501'; end if;
  if p_token is null or p_action is null or p_action not in ('claim', 'move', 'sync', 'release') then
    raise exception 'Invalid monitor action';
  end if;
  insert into pantalla_private.monitor (user_id) values (account) on conflict do nothing;
  select * into lease from pantalla_private.monitor where user_id = account for update;
  stamp := clock_timestamp();

  if p_action in ('claim', 'move') then
    if lease.holder is not null and lease.expires_at > stamp then
      if lease.holder = p_token and lease.next_holder is null then
        return jsonb_build_object('status', 'active', 'ms', floor(extract(epoch from lease.expires_at - stamp) * 1000));
      end if;
      if p_action = 'move' and (lease.next_holder is null or lease.reserved_until <= stamp) then
        update pantalla_private.monitor set next_holder = p_token, reserved_until = lease.expires_at + interval '12 seconds'
          where user_id = account;
        return jsonb_build_object('status', 'waiting');
      end if;
      return jsonb_build_object('status', case when lease.next_holder = p_token then 'waiting' else 'busy' end);
    end if;
    if lease.next_holder is not null and lease.next_holder <> p_token and lease.reserved_until > stamp then
      return jsonb_build_object('status', 'busy');
    end if;
    update pantalla_private.monitor set holder = p_token, expires_at = stamp + interval '15 seconds',
      next_holder = null, reserved_until = null where user_id = account;
    return jsonb_build_object('status', 'active', 'ms', 15000);
  end if;

  if lease.holder is distinct from p_token or lease.expires_at <= stamp then
    return jsonb_build_object('status', 'ended');
  end if;
  perform pantalla_private.store_days(account, p_token, p_days, false);
  if p_action = 'release' then
    update pantalla_private.monitor set holder = null, expires_at = null where user_id = account;
    return jsonb_build_object('status', 'ended');
  end if;
  if lease.next_holder is not null then
    return jsonb_build_object('status', 'moving');
  end if;
  update pantalla_private.monitor set expires_at = stamp + interval '15 seconds' where user_id = account;
  return jsonb_build_object('status', 'active', 'ms', 15000);
end;
$$;

create function public.ps_import(p_user uuid, p_source uuid, p_days jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare account uuid := pantalla_private.google_user();
begin
  if p_user is distinct from account then raise exception 'Account changed' using errcode = '42501'; end if;
  perform pantalla_private.store_days(account, p_source, p_days, true);
end;
$$;

create function public.ps_history(p_since date, p_until date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare account uuid := pantalla_private.google_user();
begin
  if p_since is null or p_until is null or p_until - p_since not between 0 and 65 then
    raise exception 'Invalid history interval';
  end if;
  return coalesce(
    (select jsonb_agg(jsonb_build_object('day', day, 'metrics', metrics))
     from pantalla_private.daily_metrics where user_id = account and day between p_since and p_until),
    '[]'::jsonb
  );
end;
$$;

revoke all on function pantalla_private.google_user() from public, anon, authenticated;
revoke all on function pantalla_private.store_days(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.ps_monitor(uuid, text, uuid, jsonb), public.ps_import(uuid, uuid, jsonb), public.ps_history(date, date)
  from public, anon, authenticated;
grant execute on function public.ps_monitor(uuid, text, uuid, jsonb), public.ps_import(uuid, uuid, jsonb), public.ps_history(date, date)
  to authenticated;

commit;
