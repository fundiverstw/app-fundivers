-- Almanac: crowdsourced environmental observations attached to events.
--
-- Divers submit what they saw (temperatures, visibility, current, weather,
-- wildlife, coral health, and the terrain fields an adventure needs); staff
-- review each submission; only approved rows are visible to the crowd.
--
-- Every write goes through a SECURITY DEFINER RPC. `authenticated` gets SELECT
-- on the table and nothing else, so the moderation state machine cannot be
-- driven from the client: a diver can only reach `submit_almanac_record`
-- (which always lands on 'pending'), and approve/reject lives behind a
-- role check inside `moderate_almanac_record`.

create table public.almanac_records (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  diver_id    uuid not null references auth.users (id) on delete cascade,

  event_id    uuid not null references public.events (id) on delete cascade,

  obs_date    date not null,

  air_temp_c   numeric(4,1),
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

  wildlife text[] not null default array[]::text[],
  coral_health text check (
    coral_health is null
    or coral_health in ('excellent', 'good', 'fair', 'poor', 'bleaching')
  ),

  -- Terrain fields: only the kinds that travel overland collect these.
  elevation_m numeric(5,0),
  route_condition text check (
    route_condition is null
    or route_condition in ('dry', 'wet', 'muddy', 'icy', 'snow', 'rockfall')
  ),
  summit_visible boolean,

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
create index almanac_records_diver_idx on public.almanac_records (diver_id);

create or replace function public.touch_almanac_record_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_almanac_records_touch_updated_at
  before update on public.almanac_records
  for each row execute function public.touch_almanac_record_updated_at();

alter table public.almanac_records enable row level security;

-- RLS decides which rows; the GRANT decides which verbs. Writes are RPC-only,
-- so authenticated never gets insert/update/delete here.
grant select, insert, update, delete on table public.almanac_records to service_role;
grant select on table public.almanac_records to authenticated;

-- A diver sees their own submissions (including the pending and rejected ones,
-- so the page can tell them where a record stands) plus everyone's approved
-- observations. Staff see the queue.
create policy "Divers read own and approved almanac records"
  on public.almanac_records for select
  to authenticated
  using (diver_id = auth.uid() or status = 'approved');

create policy "Staff read all almanac records"
  on public.almanac_records for select
  to authenticated
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('staff', 'admin')
  ));

-- RPC: approved observations for a set of events, newest first.
--
-- Takes an array rather than one event id because the almanac page renders a
-- whole date range at once; one call per event was a request per event.
-- SECURITY DEFINER only to reach `profiles` for the submitter's display name —
-- the row filter is still `status = 'approved'`.
create or replace function public.almanac_records_for_events(p_event_ids uuid[])
returns table (
  id uuid,
  event_id uuid,
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
    r.id, r.event_id, r.created_at, r.obs_date,
    r.air_temp_c, r.water_temp_c, r.visibility_m,
    r.current_strength, r.wave_height_m, r.wave_period_s,
    r.weather, r.wildlife, r.coral_health,
    r.elevation_m, r.route_condition, r.summit_visible,
    coalesce(p.nickname, p.name) as diver_display
  from public.almanac_records r
  join public.profiles p on p.id = r.diver_id
  where r.event_id = any (p_event_ids)
    and r.status = 'approved'
  order by r.obs_date desc, r.created_at desc;
$$;

grant execute on function public.almanac_records_for_events(uuid[]) to authenticated;

-- RPC: submit (or revise) the caller's own observation for an event-day.
--
-- Fields are assigned outright rather than coalesced: the form always posts
-- the whole record, so a coalescing update would make a cleared field
-- un-clearable. Revising is only allowed while the record is still pending —
-- once staff have ruled on it, editing it would silently un-review it.
create or replace function public.submit_almanac_record(
  p_event_id uuid,
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

  if p_obs_date > current_date then
    raise exception 'almanac_obs_date_in_future' using errcode = '23514';
  end if;

  select id, status into v_record_id, v_existing_status
    from public.almanac_records
    where event_id = p_event_id
      and obs_date = p_obs_date
      and diver_id = auth.uid();

  if v_record_id is not null and v_existing_status <> 'pending' then
    raise exception 'almanac_record_already_reviewed' using errcode = '23505';
  end if;

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

grant execute on function public.submit_almanac_record(
  uuid, date, numeric, numeric, numeric, text, numeric, numeric,
  text, text[], text, numeric, text, boolean
) to authenticated;

-- RPC: the staff review queue — every record still awaiting a ruling, with the
-- submitter and the event it belongs to.
create or replace function public.almanac_pending_records()
returns table (
  id uuid,
  event_id uuid,
  event_title text,
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
    r.id, r.event_id,
    coalesce(e.display_title, e.admin_title) as event_title,
    r.obs_date, r.created_at,
    r.air_temp_c, r.water_temp_c, r.visibility_m,
    r.current_strength, r.wave_height_m, r.wave_period_s,
    r.weather, r.wildlife, r.coral_health,
    r.elevation_m, r.route_condition, r.summit_visible,
    coalesce(p.nickname, p.name) as diver_display
  from public.almanac_records r
  join public.profiles p on p.id = r.diver_id
  join public.events e on e.id = r.event_id
  where r.status = 'pending'
  order by r.created_at;
end;
$$;

grant execute on function public.almanac_pending_records() to authenticated;

-- RPC: rule on a submission. Staff/admin only; stamps who ruled and when.
create or replace function public.moderate_almanac_record(
  p_record_id uuid,
  p_status text,
  p_staff_notes text default null
)
returns void
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

  if p_status not in ('approved', 'rejected') then
    raise exception 'almanac_status_must_be_approved_or_rejected' using errcode = '23514';
  end if;

  update public.almanac_records
    set status = p_status,
        staff_notes = p_staff_notes,
        approved_by = auth.uid(),
        approved_at = now()
    where id = p_record_id;

  if not found then
    raise exception 'almanac_record_not_found' using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.moderate_almanac_record(uuid, text, text) to authenticated;
