-- Trash in the almanac: how much was there, and what kind.
--
-- Two columns rather than one, because they answer different questions and a
-- diver can honestly answer either alone. `trash_count` is how many pieces
-- they saw; `trash_kinds` is what it was made of. Someone who swam past a
-- drift of plastic without stopping to count records the kind and no number;
-- someone tallying a cleanup records both.
--
-- NULL and 0 are deliberately different, and the difference is the point of
-- collecting this at all. NULL is "did not look" — the field was left blank.
-- 0 is "looked, and there was none", which is the single most valuable reading
-- a clean site can produce. A schema that could not tell them apart would make
-- a pristine reef indistinguishable from an unsurveyed one, and every average
-- would silently be taken over only the dirty days.
--
-- The vocabulary follows the standard marine-debris material split (the one
-- the ICC beach-cleanup datasheets use) rather than inventing categories, so
-- what the shop collects can be read beside everyone else's numbers. Fishing
-- gear is its own entry despite being mostly plastic: nets, line and traps
-- come from a different source than consumer litter and are what a dive shop
-- is best placed to notice.
alter table public.almanac_records
  add column trash_count integer,
  add column trash_kinds text[] not null default array[]::text[];

alter table public.almanac_records
  add constraint almanac_records_trash_count_check
    check (trash_count is null or trash_count >= 0);

alter table public.almanac_records
  add constraint almanac_records_trash_kinds_check
    check (trash_kinds <@ array[
      'plastic', 'fishing_gear', 'styrofoam', 'glass',
      'metal', 'rubber', 'fabric', 'paper', 'other'
    ]::text[]);

-- "None, and here is what it was made of" is not an observation anyone can
-- make. Naming a kind with a count of zero is a mis-click, and left standing
-- it would put phantom materials into every site's tally.
alter table public.almanac_records
  add constraint almanac_records_trash_none_has_no_kinds
    check (trash_count is distinct from 0 or cardinality(trash_kinds) = 0);


-- ── RPCs ───────────────────────────────────────────────────────────
--
-- All three change shape, and Postgres will not repoint a return type or add a
-- parameter through CREATE OR REPLACE, so each is dropped and rebuilt.

drop function if exists public.almanac_records_in_range(date, date);

create function public.almanac_records_in_range(p_from date, p_to date)
returns table (
  id uuid,
  site_id uuid,
  site_name text,
  site_kind text,
  created_at timestamptz,
  obs_date date,
  air_temp_c numeric(4,1),
  water_temp_c numeric(4,1),
  visibility_m numeric(4,1),
  current_strength text,
  wave_height_m numeric(3,1),
  wave_period_s numeric(3,1),
  weather text,
  wildlife text[],
  coral_health text,
  elevation_m numeric(5,0),
  route_condition text,
  summit_visible boolean,
  trash_count integer,
  trash_kinds text[],
  diver_display text
)
security definer
set search_path to 'public'
language sql
as $$
  select
    r.id, r.site_id, s.name as site_name, s.kind as site_kind,
    r.created_at, r.obs_date,
    r.air_temp_c, r.water_temp_c, r.visibility_m,
    r.current_strength, r.wave_height_m, r.wave_period_s,
    r.weather, r.wildlife, r.coral_health,
    r.elevation_m, r.route_condition, r.summit_visible,
    r.trash_count, r.trash_kinds,
    coalesce(p.nickname, p.name) as diver_display
  from public.almanac_records r
  join public.profiles p on p.id = r.diver_id
  join public.dive_sites s on s.id = r.site_id
  where r.status = 'approved'
    and r.obs_date between p_from and p_to
  order by r.obs_date desc, s.name, r.created_at desc;
$$;

revoke all on function public.almanac_records_in_range(date, date) from public, anon;
grant execute on function public.almanac_records_in_range(date, date) to authenticated, service_role;


drop function if exists public.almanac_pending_records();

create function public.almanac_pending_records()
returns table (
  id uuid,
  site_id uuid,
  site_name text,
  site_kind text,
  obs_date date,
  created_at timestamptz,
  air_temp_c numeric(4,1),
  water_temp_c numeric(4,1),
  visibility_m numeric(4,1),
  current_strength text,
  wave_height_m numeric(3,1),
  wave_period_s numeric(3,1),
  weather text,
  wildlife text[],
  coral_health text,
  elevation_m numeric(5,0),
  route_condition text,
  summit_visible boolean,
  trash_count integer,
  trash_kinds text[],
  diver_display text
)
security definer
set search_path to 'public'
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('staff', 'admin')
  ) then
    raise exception 'staff or admin role required' using errcode = '42501';
  end if;

  return query
  select
    r.id, r.site_id, s.name as site_name, s.kind as site_kind,
    r.obs_date, r.created_at,
    r.air_temp_c, r.water_temp_c, r.visibility_m,
    r.current_strength, r.wave_height_m, r.wave_period_s,
    r.weather, r.wildlife, r.coral_health,
    r.elevation_m, r.route_condition, r.summit_visible,
    r.trash_count, r.trash_kinds,
    coalesce(p.nickname, p.name) as diver_display
  from public.almanac_records r
  join public.profiles p on p.id = r.diver_id
  join public.dive_sites s on s.id = r.site_id
  where r.status = 'pending'
  order by r.created_at asc;
end;
$$;

revoke all on function public.almanac_pending_records() from public, anon;
grant execute on function public.almanac_pending_records() to authenticated, service_role;


drop function if exists public.submit_almanac_record(
  uuid, date, numeric, numeric, numeric, text, numeric, numeric,
  text, text[], text, numeric, text, boolean
);

create function public.submit_almanac_record(
  p_site_id uuid,
  p_obs_date date,
  p_air_temp_c numeric default null,
  p_water_temp_c numeric default null,
  p_visibility_m numeric default null,
  p_current_strength text default null,
  p_wave_height_m numeric default null,
  p_wave_period_s numeric default null,
  p_weather text default null,
  p_wildlife text[] default null,
  p_coral_health text default null,
  p_elevation_m numeric default null,
  p_route_condition text default null,
  p_summit_visible boolean default null,
  p_trash_count integer default null,
  p_trash_kinds text[] default null
)
returns uuid
security definer
set search_path to 'public'
language plpgsql
as $$
declare
  v_record_id uuid;
  v_existing_status text;
  v_kinds text[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Compared against tomorrow rather than today: the client sends a date in the
  -- shop's timezone and the database clock is UTC, so between midnight and
  -- 08:00 in Taipei a same-day record looks like a future one. A day of slack
  -- absorbs every offset on earth and still refuses a date nobody could have
  -- observed.
  if p_obs_date > current_date + 1 then
    raise exception 'almanac_obs_date_in_future' using errcode = '23514';
  end if;

  -- A count of zero settles the kinds question on its own, so a stale
  -- selection left behind by a diver correcting their count downwards is
  -- dropped rather than rejected. Anything else the check constraints judge.
  v_kinds := coalesce(p_trash_kinds, array[]::text[]);
  if p_trash_count = 0 then
    v_kinds := array[]::text[];
  end if;

  select id, status into v_record_id, v_existing_status
    from public.almanac_records
    where site_id = p_site_id
      and obs_date = p_obs_date
      and diver_id = auth.uid();

  if v_record_id is not null and v_existing_status <> 'pending' then
    raise exception 'almanac_record_already_reviewed' using errcode = '23505';
  end if;

  if v_record_id is null then
    insert into public.almanac_records (
      diver_id, site_id, obs_date,
      air_temp_c, water_temp_c, visibility_m,
      current_strength, wave_height_m, wave_period_s,
      weather, wildlife, coral_health,
      elevation_m, route_condition, summit_visible,
      trash_count, trash_kinds
    ) values (
      auth.uid(), p_site_id, p_obs_date,
      p_air_temp_c, p_water_temp_c, p_visibility_m,
      p_current_strength, p_wave_height_m, p_wave_period_s,
      p_weather, coalesce(p_wildlife, array[]::text[]), p_coral_health,
      p_elevation_m, p_route_condition, p_summit_visible,
      p_trash_count, v_kinds
    ) returning id into v_record_id;
  else
    update public.almanac_records
      set air_temp_c = p_air_temp_c,
          water_temp_c = p_water_temp_c,
          visibility_m = p_visibility_m,
          current_strength = p_current_strength,
          wave_height_m = p_wave_height_m,
          wave_period_s = p_wave_period_s,
          weather = p_weather,
          wildlife = coalesce(p_wildlife, array[]::text[]),
          coral_health = p_coral_health,
          elevation_m = p_elevation_m,
          route_condition = p_route_condition,
          summit_visible = p_summit_visible,
          trash_count = p_trash_count,
          trash_kinds = v_kinds
      where id = v_record_id;
  end if;

  return v_record_id;
end;
$$;

revoke all on function public.submit_almanac_record(
  uuid, date, numeric, numeric, numeric, text, numeric, numeric,
  text, text[], text, numeric, text, boolean, integer, text[]
) from public, anon;
grant execute on function public.submit_almanac_record(
  uuid, date, numeric, numeric, numeric, text, numeric, numeric,
  text, text[], text, numeric, text, boolean, integer, text[]
) to authenticated, service_role;
