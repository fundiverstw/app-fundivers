-- Almanac: crowdsourced environmental and weather observations for dive sites
-- and adventure events. Divers submit; staff/admin review and approve;
-- approved records appear on the event detail and the almanac page.

create table public.almanac_records (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  diver_id    uuid not null references auth.users (id) on delete cascade,

  event_id    uuid not null references public.events (id) on delete cascade,

  obs_date    date not null,

  air_temp_c  numeric(4,1),
  water_temp_c numeric(4,1),
  visibility_m numeric(4,1),

  current_strength text check (
    current_strength is null
    or current_strength in ('calm', 'light', 'moderate', 'strong', 'very_strong')
  ),
  wave_height_m   numeric(3,1),
  wave_period_s   numeric(3,1),

  weather text check (
    weather is null
    or weather in ('clear', 'partly_cloudy', 'cloudy', 'overcast',
                   'rain', 'thunderstorm', 'windy', 'fog', 'typhoon')
  ),

  wildlife text[] default array[]::text[],
  coral_health text check (
    coral_health is null
    or coral_health in ('excellent', 'good', 'fair', 'poor', 'bleaching')
  ),

  -- Adventure-specific
  elevation_m numeric(5,0),
  route_condition text check (
    route_condition is null
    or route_condition in ('dry', 'wet', 'muddy', 'icy', 'snow', 'rockfall')
  ),
  summit_visible boolean default null,

  -- Moderation
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected')
  ),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  staff_notes text,

  unique (event_id, obs_date, diver_id)
);

create index almanac_records_event_idx on public.almanac_records (event_id, obs_date desc);
create index almanac_records_status_idx on public.almanac_records (status);

alter table public.almanac_records enable row level security;

-- Divers can read their own records and all approved records.
create policy "Divers can read own almanac records"
  on public.almanac_records for select
  to authenticated
  using (diver_id = auth.uid() or status = 'approved');

-- Divers can insert their own observations (always pending).
create policy "Divers can insert almanac records"
  on public.almanac_records for insert
  to authenticated
  with check (diver_id = auth.uid() and status = 'pending');

-- Divers can update only their own pending records.
create policy "Divers can update own pending records"
  on public.almanac_records for update
  to authenticated
  using (diver_id = auth.uid() and status = 'pending')
  with check (diver_id = auth.uid() and status = 'pending');

-- Staff and admins can read all records.
create policy "Staff can read all almanac records"
  on public.almanac_records for select
  to authenticated
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('staff', 'admin')
  ));

-- Staff and admins can approve/reject records.
create policy "Staff can update almanac records"
  on public.almanac_records for update
  to authenticated
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('staff', 'admin')
  ))
  with check (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role in ('staff', 'admin')
  ));

-- RPC: Get all approved almanac records for an event, newest first.
-- Public so divers can see the crowd-sourced history without RLS complexity.
create or replace function public.almanac_event_records(p_event_id uuid)
returns table (
  id uuid,
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
  diver_name text,
  diver_nickname text
)
security definer
language plpgsql
as $$
begin
  return query
  select
    r.id, r.created_at, r.obs_date,
    r.air_temp_c, r.water_temp_c, r.visibility_m,
    r.current_strength, r.wave_height_m, r.wave_period_s,
    r.weather, r.wildlife, r.coral_health,
    r.elevation_m, r.route_condition, r.summit_visible,
    p.name as diver_name,
    p.nickname as diver_nickname
  from public.almanac_records r
  join public.profiles p on p.id = r.diver_id
  where r.event_id = p_event_id
    and r.status = 'approved'
  order by r.obs_date desc;
end;
$$;

-- RPC: Submit or update a diver's own almanac record.
-- Returns the record id. Only works for pending records owned by the caller.
create or replace function public.submit_almanac_record(
  p_event_id uuid,
  p_obs_date date,
  p_air_temp_c numeric(4,1) default null,
  p_water_temp_c numeric(4,1) default null,
  p_visibility_m numeric(4,1) default null,
  p_current_strength text default null,
  p_wave_height_m numeric(3,1) default null,
  p_wave_period_s numeric(3,1) default null,
  p_weather text default null,
  p_wildlife text[] default null,
  p_coral_health text default null,
  p_elevation_m numeric(5,0) default null,
  p_route_condition text default null,
  p_summit_visible boolean default null
)
returns uuid
security definer
language plpgsql
as $$
declare
  v_record_id uuid;
begin
  -- Upsert: update existing pending record or insert new one.
  update public.almanac_records
    set air_temp_c = coalesce(p_air_temp_c, air_temp_c),
        water_temp_c = coalesce(p_water_temp_c, water_temp_c),
        visibility_m = coalesce(p_visibility_m, visibility_m),
        current_strength = coalesce(p_current_strength, current_strength),
        wave_height_m = coalesce(p_wave_height_m, wave_height_m),
        wave_period_s = coalesce(p_wave_period_s, wave_period_s),
        weather = coalesce(p_weather, weather),
        wildlife = coalesce(p_wildlife, wildlife),
        coral_health = coalesce(p_coral_health, coral_health),
        elevation_m = coalesce(p_elevation_m, elevation_m),
        route_condition = coalesce(p_route_condition, route_condition),
        summit_visible = coalesce(p_summit_visible, summit_visible),
        updated_at = now()
    where event_id = p_event_id
      and obs_date = p_obs_date
      and diver_id = auth.uid()
      and status = 'pending'
    returning id into v_record_id;

  if v_record_id is null then
    insert into public.almanac_records (
      diver_id, event_id, obs_date,
      air_temp_c, water_temp_c, visibility_m,
      current_strength, wave_height_m, wave_period_s,
      weather, wildlife, coral_health,
      elevation_m, route_condition, summit_visible
    ) values (
      auth.uid(), p_event_id, p_obs_date,
      p_air_temp_c, p_water_temp_c, p_visibility_m,
      p_current_strength, p_wave_height_m, p_wave_period_s,
      p_weather, p_wildlife, p_coral_health,
      p_elevation_m, p_route_condition, p_summit_visible
    ) returning id into v_record_id;
  end if;

  return v_record_id;
end;
$$;
