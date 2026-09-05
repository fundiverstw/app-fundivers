-- Trash, banded: how much there was, answered as a range instead of a tally.
--
-- Counting pieces of trash underwater is not something a diver does. On a
-- normal dive nobody stops to tally; back on the boat the honest answer is
-- "some" or "a lot", and a form demanding an integer got either a blank or an
-- invented number. Both are worse than a band: the blank throws away a real
-- observation, and the invented number carries a precision the diver never
-- had, into every average the almanac takes.
--
-- The bands are wide on purpose, and the boundaries are the ones a diver can
-- actually place a dive either side of. `none` stays its own answer rather
-- than folding into `minimal`, because the difference between "looked, saw
-- nothing" and "looked, saw a few pieces" is the whole reason for collecting
-- this: a clean site has to be able to report itself as clean.
--
-- NULL still means "did not look". That distinction is unchanged and is what
-- keeps an unsurveyed site from reading as a pristine one.
--
-- `trash_count` is kept, not dropped. Rows filed before this migration hold a
-- number a diver really did count, on cleanup dives where counting was the
-- point, and throwing that away to tidy the schema would destroy the most
-- precise data the almanac has. It is backfilled into a band below so every
-- row answers the new question, and the reading surfaces still print the exact
-- count beside the band where one exists. Nothing writes it going forward.
alter table public.almanac_records
  add column trash_band text;

alter table public.almanac_records
  add constraint almanac_records_trash_band_check
    check (trash_band is null or trash_band in (
      'none', 'minimal', 'noticeable', 'heavy', 'severe'
    ));

-- The rule the count used to carry, moved to the column that now answers the
-- question: "none, and here is what it was made of" is not an observation
-- anyone can make. The count's version of it goes, or a pending row filed as a
-- zero and then revised upwards to a band with materials would be refused by a
-- constraint guarding a field the form no longer writes.
alter table public.almanac_records
  drop constraint if exists almanac_records_trash_none_has_no_kinds;

alter table public.almanac_records
  add constraint almanac_records_trash_none_band_has_no_kinds
    check (trash_band is distinct from 'none' or cardinality(trash_kinds) = 0);

-- Existing counts bucket into the band they fall in, so every row that ever
-- answered the trash question answers the new one too and nothing has to
-- bucket a raw number at read time.
update public.almanac_records
   set trash_band = case
         when trash_count = 0 then 'none'
         when trash_count between 1 and 10 then 'minimal'
         when trash_count between 11 and 50 then 'noticeable'
         when trash_count between 51 and 200 then 'heavy'
         else 'severe'
       end
 where trash_count is not null;


-- ── RPCs ───────────────────────────────────────────────────────────
--
-- All three change shape, and Postgres will not repoint a return type or
-- retype a parameter through CREATE OR REPLACE, so each is dropped and rebuilt.

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
  trash_band text,
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
    r.trash_band, r.trash_count, r.trash_kinds,
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
  trash_band text,
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
    r.trash_band, r.trash_count, r.trash_kinds,
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


-- The count parameter goes with the field that fed it. A revision of a record
-- filed before the bands leaves its `trash_count` where it is: the diver is
-- answering the banded question now, and the number they counted then is not
-- something a later edit of the weather should silently erase.
drop function if exists public.submit_almanac_record(
  uuid, date, numeric, numeric, numeric, text, numeric, numeric,
  text, text[], text, numeric, text, boolean, integer, text[]
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
  p_trash_band text default null,
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

  -- A band of "none" settles the kinds question on its own, so a stale
  -- selection left behind by a diver correcting their answer downwards is
  -- dropped rather than rejected. Anything else the check constraints judge.
  v_kinds := coalesce(p_trash_kinds, array[]::text[]);
  if p_trash_band = 'none' then
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
      trash_band, trash_kinds
    ) values (
      auth.uid(), p_site_id, p_obs_date,
      p_air_temp_c, p_water_temp_c, p_visibility_m,
      p_current_strength, p_wave_height_m, p_wave_period_s,
      p_weather, coalesce(p_wildlife, array[]::text[]), p_coral_health,
      p_elevation_m, p_route_condition, p_summit_visible,
      p_trash_band, v_kinds
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
          trash_band = p_trash_band,
          trash_kinds = v_kinds
      where id = v_record_id;
  end if;

  return v_record_id;
end;
$$;

revoke all on function public.submit_almanac_record(
  uuid, date, numeric, numeric, numeric, text, numeric, numeric,
  text, text[], text, numeric, text, boolean, text, text[]
) from public, anon;
grant execute on function public.submit_almanac_record(
  uuid, date, numeric, numeric, numeric, text, numeric, numeric,
  text, text[], text, numeric, text, boolean, text, text[]
) to authenticated, service_role;
