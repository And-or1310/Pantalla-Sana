begin;

create table pantalla_private.guest_progress_import (
  user_id uuid not null references auth.users on delete cascade,
  source uuid not null,
  primary key (user_id, source)
);
alter table pantalla_private.guest_progress_import enable row level security;
revoke all on pantalla_private.guest_progress_import from public, anon, authenticated;

create function public.ps_merge_guest_progress(p_user uuid, p_source uuid, p_progress jsonb, p_preferences jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := pantalla_private.google_user();
  running boolean;
  saved jsonb;
  merged jsonb;
  progress_day text;
  streak_day text;
  streak_count numeric;
  partial_seconds numeric;
  daily_log jsonb;
begin
  if p_user is distinct from owner_id then raise exception 'Account changed' using errcode = '42501'; end if;
  if p_source is null then raise exception 'Missing import source'; end if;
  insert into pantalla_private.monitor (user_id) values (owner_id) on conflict do nothing;
  select holder is not null and expires_at > clock_timestamp() into running
    from pantalla_private.monitor where user_id = owner_id for update;

  if exists (select 1 from pantalla_private.guest_progress_import where user_id = owner_id and source = p_source) then
    return public.ps_profile(owner_id);
  end if;
  if running then raise exception 'Pause monitoring before importing progress'; end if;
  perform pantalla_private.valid_progress(p_progress);

  insert into pantalla_private.profile (user_id) values (owner_id) on conflict do nothing;
  select progress into saved from pantalla_private.profile where user_id = owner_id for update;
  if saved is null then
    merged := p_progress;
  else
    progress_day := greatest(saved->>'day', p_progress->>'day');
    streak_day := greatest(saved->>'last_day', p_progress->>'last_day');
    streak_count := greatest(
      case when saved->>'last_day' = streak_day then (saved->>'streak')::numeric else 0 end,
      case when p_progress->>'last_day' = streak_day then (p_progress->>'streak')::numeric else 0 end);
    partial_seconds := coalesce((saved->>'carry')::numeric, 0) + coalesce((p_progress->>'carry')::numeric, 0);
    select coalesce(jsonb_object_agg(key, seconds), '{}'::jsonb) into daily_log from (
      select key, sum(value::numeric) as seconds
      from (select * from jsonb_each(saved->'log') union all select * from jsonb_each(p_progress->'log')) as records
      group by key order by key desc limit 30
    ) as recent;
    merged := saved || jsonb_build_object(
      'xp', (saved->>'xp')::numeric + (p_progress->>'xp')::numeric + floor(partial_seconds / 60),
      'carry', mod(partial_seconds, 60),
      'packs', (saved->>'packs')::numeric + (p_progress->>'packs')::numeric,
      'rescues', (saved->>'rescues')::numeric + (p_progress->>'rescues')::numeric,
      'album', (p_progress->'album') || (saved->'album'),
      'companion', coalesce(nullif(saved->>'companion', ''), p_progress->>'companion'),
      'last_card', coalesce(nullif(saved->>'last_card', ''), p_progress->>'last_card', ''),
      'day', progress_day,
      'good_today', (case when saved->>'day' = progress_day then (saved->>'good_today')::numeric else 0 end)
        + (case when p_progress->>'day' = progress_day then (p_progress->>'good_today')::numeric else 0 end),
      'last_day', streak_day,
      'streak', streak_count,
      'best', greatest((saved->>'best')::numeric, (p_progress->>'best')::numeric),
      'log', daily_log
    );
  end if;
  perform pantalla_private.valid_progress(merged);
  update pantalla_private.profile set progress = merged where user_id = owner_id;
  insert into pantalla_private.guest_progress_import (user_id, source) values (owner_id, p_source);
  return public.ps_preferences(owner_id, p_preferences, true);
end;
$$;

revoke all on function public.ps_merge_guest_progress(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ps_merge_guest_progress(uuid, uuid, jsonb, jsonb) to authenticated;

commit;
