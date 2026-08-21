-- The almanac describes places, not outings.
--
-- 20260818000000 filed each observation against an `event`, so the picker
-- listed every past trip and "Bat Cave" appeared once per visit. Conditions
-- belong to a site on a date: one Bat Cave, many days, many divers. This adds
-- the site catalog the schema never had (dive_logs.site is free text, and
-- travel_destinations is destination-grained — Green Island, not Bat Cave) and
-- re-keys the almanac onto it.
--
-- `kind` reuses the events vocabulary, restricted to the kinds that travel to
-- a site (see recordsSiteConditions in src/lib/event-kinds.ts): a dive site is
-- not somewhere you take an adventure, so the almanac's dive/adventure toggle
-- filters this column. A course runs from the shop and has no site of its own.

create table public.dive_sites (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name       text not null,
  kind       text not null check (kind in ('dive', 'adventure')),
  region     text,
  notes      text,
  active     boolean not null default true
);

-- Case-insensitive, because the whole point of a catalog is that "Bat Cave"
-- and "bat cave" cannot both exist.
create unique index dive_sites_name_key on public.dive_sites (kind, lower(name));
create index dive_sites_active_idx on public.dive_sites (active);

create or replace function public.touch_dive_site_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_dive_sites_touch_updated_at
  before update on public.dive_sites
  for each row execute function public.touch_dive_site_updated_at();

alter table public.dive_sites enable row level security;

grant select, insert, update, delete on table public.dive_sites to service_role;
grant select, insert, update, delete on table public.dive_sites to authenticated;

-- Any signed-in diver reads the catalog (the almanac form is a diver surface);
-- only an admin curates it.
create policy "Authenticated read dive sites"
  on public.dive_sites for select
  to authenticated
  using (true);

create policy "Admins write dive sites"
  on public.dive_sites for all
  to authenticated
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role = 'admin'
  ))
  with check (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role = 'admin'
  ));

-- ── Events point at a site too ─────────────────────────────────────

-- One catalog, every surface: an event says where it goes, the almanac says
-- what it was like there, and neither invents its own spelling of "Bat Cave".
-- Nullable because a course runs from the shop and has no site of its own.
-- ON DELETE SET NULL rather than the almanac's RESTRICT: losing the link
-- costs an event nothing, where losing an observation costs a record of a day.
alter table public.events
  add column site_id uuid references public.dive_sites (id) on delete set null;

create index events_site_idx on public.events (site_id);

-- ── Re-key the almanac onto sites ──────────────────────────────────

-- Deleting a site that carries observations would silently take them with it,
-- so the FK refuses; `active = false` is how a site retires.
alter table public.almanac_records
  add column site_id uuid references public.dive_sites (id) on delete restrict;

-- Nothing to migrate: the RPCs the SPA calls never existed in cloud (the page
-- 404'd on every read), the table granted no client write path of its own that
-- any UI used, and production carried zero rows when this was written. Any row
-- that somehow predates the catalog has no site to point at.
delete from public.almanac_records where site_id is null;

alter table public.almanac_records alter column site_id set not null;

-- Drops almanac_records_event_idx and the (event_id, obs_date, diver_id)
-- unique constraint with it.
alter table public.almanac_records drop column event_id;

create unique index almanac_records_site_day_diver_key
  on public.almanac_records (site_id, obs_date, diver_id);
create index almanac_records_site_idx
  on public.almanac_records (site_id, obs_date desc);

-- ── RPCs ───────────────────────────────────────────────────────────

-- Reads are a date window now, not a list of event ids.
drop function if exists public.almanac_records_for_events(uuid[]);

create or replace function public.almanac_records_in_range(p_from date, p_to date)
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

-- Both of these change shape (a site id in, a site name out), and Postgres
-- will not rename a parameter or repoint a return type through CREATE OR
-- REPLACE, so they are dropped and rebuilt rather than replaced.
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
  p_summit_visible boolean default null
)
returns uuid
security definer
set search_path to 'public'
language plpgsql
as $$
declare
  v_record_id uuid;
  v_existing_status text;
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
      elevation_m, route_condition, summit_visible
    ) values (
      auth.uid(), p_site_id, p_obs_date,
      p_air_temp_c, p_water_temp_c, p_visibility_m,
      p_current_strength, p_wave_height_m, p_wave_period_s,
      p_weather, coalesce(p_wildlife, array[]::text[]), p_coral_health,
      p_elevation_m, p_route_condition, p_summit_visible
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
          summit_visible = p_summit_visible
      where id = v_record_id;
  end if;

  return v_record_id;
end;
$$;

revoke all on function public.submit_almanac_record(
  uuid, date, numeric, numeric, numeric, text, numeric, numeric,
  text, text[], text, numeric, text, boolean
) from public, anon;
grant execute on function public.submit_almanac_record(
  uuid, date, numeric, numeric, numeric, text, numeric, numeric,
  text, text[], text, numeric, text, boolean
) to authenticated, service_role;

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
    coalesce(p.nickname, p.name) as diver_display
  from public.almanac_records r
  join public.profiles p on p.id = r.diver_id
  join public.dive_sites s on s.id = r.site_id
  where r.status = 'pending'
  order by r.created_at;
end;
$$;

revoke all on function public.almanac_pending_records() from public, anon;
grant execute on function public.almanac_pending_records() to authenticated, service_role;
