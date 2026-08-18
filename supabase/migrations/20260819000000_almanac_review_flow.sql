-- Almanac: put the review flow behind RPCs, and make the table read-only to
-- clients.
--
-- 20260818000000 shipped the almanac with three writer policies and no way for
-- staff to rule on a submission: every record sat 'pending' forever, so the
-- crowd read nothing and the moderation columns were never written. It also
-- left the SPA reading one RPC per event, and no function carried a
-- `search_path`. That file is already applied, so the correction is this
-- forward migration rather than an edit to it.
--
-- Where this lands:
--   * `authenticated` holds SELECT only. Submissions go through
--     submit_almanac_record() (always 'pending'), rulings through
--     moderate_almanac_record() (staff/admin), so the moderation state machine
--     cannot be driven from the client.
--   * Reads: almanac_records_for_events() for the approved crowd history (a
--     batch, not one call per event) and almanac_pending_records() for the
--     staff queue.
--
-- fundive carries the same end state as a single migration — it never pushed
-- the first one, so there was nothing there to correct forward.

-- ── Table ──────────────────────────────────────────────────────────

update public.almanac_records set wildlife = array[]::text[] where wildlife is null;
alter table public.almanac_records alter column wildlife set not null;

create index if not exists almanac_records_diver_idx on public.almanac_records (diver_id);

create or replace function public.touch_almanac_record_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_almanac_records_touch_updated_at on public.almanac_records;
create trigger trg_almanac_records_touch_updated_at
  before update on public.almanac_records
  for each row execute function public.touch_almanac_record_updated_at();

-- ── Reads only, for everyone but the service role ──────────────────

drop policy if exists "Divers can insert almanac records" on public.almanac_records;
drop policy if exists "Divers can update own pending records" on public.almanac_records;
drop policy if exists "Staff can update almanac records" on public.almanac_records;
drop policy if exists "Divers can read own almanac records" on public.almanac_records;
drop policy if exists "Staff can read all almanac records" on public.almanac_records;

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

revoke all on table public.almanac_records from anon, authenticated;
grant select on table public.almanac_records to authenticated;
grant select, insert, update, delete on table public.almanac_records to service_role;

-- ── RPCs ───────────────────────────────────────────────────────────

-- Replaced by almanac_records_for_events: the page renders a whole date range,
-- and one call per event was one request per event.
drop function if exists public.almanac_event_records(uuid);

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

revoke all on function public.almanac_records_for_events(uuid[]) from public, anon;
grant execute on function public.almanac_records_for_events(uuid[]) to authenticated, service_role;

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

revoke all on function public.submit_almanac_record(
  uuid, date, numeric, numeric, numeric, text, numeric, numeric,
  text, text[], text, numeric, text, boolean
) from public, anon;
grant execute on function public.submit_almanac_record(
  uuid, date, numeric, numeric, numeric, text, numeric, numeric,
  text, text[], text, numeric, text, boolean
) to authenticated, service_role;

-- The staff review queue — every record still awaiting a ruling, with the
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

revoke all on function public.almanac_pending_records() from public, anon;
grant execute on function public.almanac_pending_records() to authenticated, service_role;

-- Rule on a submission. Staff/admin only; stamps who ruled and when.
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

revoke all on function public.moderate_almanac_record(uuid, text, text) from public, anon;
grant execute on function public.moderate_almanac_record(uuid, text, text) to authenticated, service_role;
