begin;

create table pantalla_private.profile (
  user_id uuid primary key references auth.users on delete cascade,
  preferences jsonb not null default '{}',
  progress jsonb,
  preferences_version bigint not null default 0
);
alter table pantalla_private.profile enable row level security;
revoke all on pantalla_private.profile from public, anon, authenticated;

create function pantalla_private.valid_progress(p jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  k text;
  item record;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text) > 500000
    or jsonb_typeof(p->'album') is distinct from 'object'
    or jsonb_typeof(p->'log') is distinct from 'object'
    or not (p ?& array['xp','streak','best','last_day','day','good_today','rescues','album','packs','companion','log'])
    or (p - array['xp','streak','best','last_day','day','good_today','rescues','album','packs','companion','log','carry','last_card']) <> '{}'::jsonb then
    raise exception 'Invalid player progress';
  end if;
  foreach k in array array['xp','streak','best','good_today','rescues','packs','carry'] loop
    if k = 'carry' and not (p ? k) then continue; end if;
    if jsonb_typeof(p->k) is distinct from 'number' or (p->>k)::numeric not between 0 and 1000000000 then
      raise exception 'Invalid progress number';
    end if;
  end loop;
  foreach k in array array['last_day','day','companion','last_card'] loop
    if k = 'last_card' and not (p ? k) then continue; end if;
    if jsonb_typeof(p->k) is distinct from 'string' or length(p->>k) > 512 then
      raise exception 'Invalid progress field';
    end if;
  end loop;
  for item in select key, value from jsonb_each(p->'album') loop
    if length(item.key) > 512 or jsonb_typeof(item.value) is distinct from 'object'
      or (item.value - array['pack','title','art','rarity','got']) <> '{}'::jsonb
      or not (item.value ?& array['pack','title','art','rarity','got'])
      or item.value->>'rarity' not in ('comun','rara','epica','brillante')
      or coalesce(item.value->>'art', '') !~ '^https?://' then
      raise exception 'Invalid album card';
    end if;
    foreach k in array array['pack','title','art','rarity','got'] loop
      if jsonb_typeof(item.value->k) is distinct from 'string' or length(item.value->>k) > 2048 then
        raise exception 'Invalid album card field';
      end if;
    end loop;
  end loop;
  for item in select key, value from jsonb_each(p->'log') loop
    if item.key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(item.value) is distinct from 'number' or item.value::numeric not between 0 and 1000000000 then
      raise exception 'Invalid progress log';
    end if;
  end loop;
end;
$$;

create function public.ps_profile(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare owner_id uuid := pantalla_private.google_user();
begin
  if p_user is distinct from owner_id then raise exception 'Account changed' using errcode = '42501'; end if;
  return coalesce((select jsonb_build_object('preferences', preferences, 'progress', progress, 'version', preferences_version)
    from pantalla_private.profile where user_id = owner_id),
    jsonb_build_object('preferences', '{}'::jsonb, 'progress', null, 'version', 0));
end;
$$;

create function public.ps_preferences(p_user uuid, p_patch jsonb, p_initial boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := pantalla_private.google_user();
  entry record;
  active_preferences jsonb;
  incoming jsonb := p_patch;
begin
  if p_user is distinct from owner_id then raise exception 'Account changed' using errcode = '42501'; end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or octet_length(p_patch::text) > 5000 then raise exception 'Invalid preferences'; end if;
  for entry in select key, value from jsonb_each(p_patch) loop
    if entry.key in ('net','demo') and jsonb_typeof(entry.value) = 'boolean' then continue; end if;
    if entry.key = 'groups' and jsonb_typeof(entry.value) = 'object' then
      if exists (select 1 from jsonb_each(entry.value) g where g.key not in ('posture','close','blink','sleep','pause')
        or jsonb_typeof(g.value) <> 'boolean') then raise exception 'Invalid rules'; end if;
      continue;
    end if;
    if entry.key in ('sens','img_mode','snd_mode','img_path','snd_path','preview','ntfy','ai_provider','theme','widgetSize')
      and jsonb_typeof(entry.value) = 'string' and length(entry.value #>> '{}') <= 256 then
      if entry.key in ('img_path','snd_path') and (entry.value #>> '{}') !~ '^(|[0-9a-f-]{36})$' then
        raise exception 'Invalid private file';
      end if;
      continue;
    end if;
    raise exception 'Invalid preference field %', entry.key;
  end loop;
  insert into pantalla_private.profile (user_id) values (owner_id) on conflict do nothing;
  select preferences into active_preferences from pantalla_private.profile where user_id = owner_id for update;
  if p_initial then
    incoming := p_patch || active_preferences;
    if p_patch ? 'groups' then incoming := jsonb_set(incoming, '{groups}',
      (p_patch->'groups') || coalesce(active_preferences->'groups', '{}'::jsonb)); end if;
  else
    incoming := active_preferences || p_patch;
    if p_patch ? 'groups' then incoming := jsonb_set(incoming, '{groups}',
      coalesce(active_preferences->'groups', '{}'::jsonb) || (p_patch->'groups')); end if;
  end if;
  update pantalla_private.profile set preferences = incoming, preferences_version = preferences_version + 1 where user_id = owner_id;
  return public.ps_profile(owner_id);
end;
$$;

-- La escritura de progreso y el cambio de titular se confirman en la misma transacción.
create function public.ps_account_monitor(p_user uuid, p_action text, p_token uuid, p_days jsonb, p_progress jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := pantalla_private.google_user();
  snapshot jsonb;
  result jsonb;
  holding boolean;
begin
  if p_user is distinct from owner_id then raise exception 'Account changed' using errcode = '42501'; end if;
  if p_action in ('sync','release') and p_progress is not null then
    select holder = p_token and expires_at > clock_timestamp() into holding
      from pantalla_private.monitor where user_id = owner_id for update;
    if holding then
      perform pantalla_private.valid_progress(p_progress);
      insert into pantalla_private.profile (user_id, progress) values (owner_id, p_progress)
        on conflict (user_id) do update set progress = excluded.progress;
    end if;
  end if;
  result := public.ps_monitor(owner_id, p_action, p_token, p_days);
  if p_action in ('claim','move') and result->>'status' = 'active' then
    snapshot := public.ps_profile(owner_id);
    return result || jsonb_build_object('profile', snapshot);
  end if;
  return result;
end;
$$;

create function public.ps_import_progress(p_user uuid, p_progress jsonb, p_preferences jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := pantalla_private.google_user();
  running boolean;
begin
  if p_user is distinct from owner_id then raise exception 'Account changed' using errcode = '42501'; end if;
  insert into pantalla_private.monitor (user_id) values (owner_id) on conflict do nothing;
  select holder is not null and expires_at > clock_timestamp() into running
    from pantalla_private.monitor where user_id = owner_id for update;
  if running then raise exception 'Pause monitoring before importing progress'; end if;
  perform pantalla_private.valid_progress(p_progress);
  insert into pantalla_private.profile (user_id, progress) values (owner_id, p_progress)
    on conflict (user_id) do update set progress = excluded.progress where profile.progress is null;
  return public.ps_preferences(owner_id, p_preferences, true);
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pantalla-profile-media', 'pantalla-profile-media', false, 8000000,
  array['image/png','image/jpeg','image/webp','image/gif','image/bmp','audio/wav','audio/x-wav','audio/mpeg','audio/ogg']);

create policy pantalla_profile_media_read on storage.objects for select to authenticated using (
  bucket_id = 'pantalla-profile-media' and split_part(name, '/', 1) = (select auth.uid())::text
  and (select auth.jwt()->'app_metadata'->>'provider') = 'google'
);
create policy pantalla_profile_media_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'pantalla-profile-media' and split_part(name, '/', 1) = (select auth.uid())::text
  and (select auth.jwt()->'app_metadata'->>'provider') = 'google'
  and name ~ '^[0-9a-f-]{36}/(image|sound)/[0-9a-f-]{36}$'
);

revoke all on function pantalla_private.valid_progress(jsonb) from public, anon, authenticated;
revoke all on function public.ps_profile(uuid), public.ps_preferences(uuid, jsonb, boolean),
  public.ps_account_monitor(uuid, text, uuid, jsonb, jsonb), public.ps_import_progress(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ps_profile(uuid), public.ps_preferences(uuid, jsonb, boolean),
  public.ps_account_monitor(uuid, text, uuid, jsonb, jsonb), public.ps_import_progress(uuid, jsonb, jsonb) to authenticated;

commit;
