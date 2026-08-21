-- Coral surveys: a structured coral-condition record, separate from the
-- almanac's single `coral_health` field.
--
-- The almanac asks one diver, once per site-day, how the coral looked, on a
-- five-level scale. That is a condition reading, and it is the right shape for
-- a page that summarizes a day. It cannot answer whether the reef is bleaching,
-- because a single ordinal judgment carries no colony count, no depth, no
-- water temperature at the moment of observation, and no reference standard
-- another observer could reproduce.
--
-- This is the survey shape instead, and it follows the CoralWatch Coral Health
-- Chart, the method that already has a decade of volunteer-collected data
-- behind it: a diver records a set of colonies, and for each one the palest and
-- darkest shade matched against a printed chart of four hue columns (B, C, D,
-- E) and six lightness levels. Level 1 is bleached; level 6 is fully
-- pigmented. Adopting the published scale rather than inventing one is what
-- makes these records comparable with everybody else's.
--
-- A survey is therefore two tables: the header says when, where and under what
-- conditions; the colony rows are the observations. Both are moderated as a
-- unit, exactly as an almanac record is, because a survey is only as trustworthy
-- as the person who filed it and staff are the ones who know them.

create table public.coral_surveys (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  diver_id    uuid not null references auth.users (id) on delete cascade,

  -- RESTRICT, matching almanac_records: a site that carries surveys is
  -- retired with active = false, never deleted out from under its history.
  site_id     uuid not null references public.dive_sites (id) on delete restrict,

  surveyed_on date not null,
  -- Time of day is not decoration. Chart matching is done by eye against
  -- ambient light, so a survey at 08:00 and one at 16:00 on the same colony
  -- are not directly comparable, and the analysis has to be able to tell.
  surveyed_at time,

  depth_m      numeric(4,1) check (depth_m is null or (depth_m >= 0 and depth_m <= 100)),
  water_temp_c numeric(4,1) check (water_temp_c is null or (water_temp_c >= -2 and water_temp_c <= 40)),

  survey_method text not null default 'random' check (
    survey_method in ('random', 'transect', 'quadrat')
  ),
  -- Only meaningful for a transect; the app hides it otherwise. Kept nullable
  -- rather than checked against survey_method so that correcting the method on
  -- an existing survey does not have to discard the measurement.
  transect_length_m numeric(5,1) check (
    transect_length_m is null or (transect_length_m > 0 and transect_length_m <= 500)
  ),

  notes text,

  status      text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected')
  ),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  staff_notes text
);

-- One survey per diver per site per day, the same rule the almanac uses. A
-- diver who surveys the same site twice in a day is revising, not adding.
create unique index coral_surveys_site_day_diver_key
  on public.coral_surveys (site_id, surveyed_on, diver_id);
create index coral_surveys_site_idx on public.coral_surveys (site_id, surveyed_on desc);
create index coral_surveys_status_idx on public.coral_surveys (status);

create table public.coral_survey_colonies (
  id         uuid primary key default gen_random_uuid(),
  survey_id  uuid not null references public.coral_surveys (id) on delete cascade,
  -- Position within the survey, so a colony keeps its identity across a
  -- revision and the analysis can say "colony 7" and mean the same one.
  ordinal    integer not null check (ordinal >= 1 and ordinal <= 100),

  coral_type text not null check (
    coral_type in ('branching', 'boulder', 'plate', 'soft')
  ),

  -- CoralWatch chart coordinates. Hue is the column, level the row.
  lightest_hue   text not null check (lightest_hue in ('B', 'C', 'D', 'E')),
  lightest_level integer not null check (lightest_level between 1 and 6),
  darkest_hue    text not null check (darkest_hue in ('B', 'C', 'D', 'E')),
  darkest_level  integer not null check (darkest_level between 1 and 6),
  -- The chart is read palest-first: a darkest shade lighter than the lightest
  -- one is a transposed pair, not an observation.
  constraint coral_colony_shade_order check (darkest_level >= lightest_level),

  diameter_cm numeric(5,1) check (
    diameter_cm is null or (diameter_cm > 0 and diameter_cm <= 2000)
  ),

  unique (survey_id, ordinal)
);

create index coral_survey_colonies_survey_idx
  on public.coral_survey_colonies (survey_id, ordinal);

create or replace function public.touch_coral_survey_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_coral_surveys_touch_updated_at
  before update on public.coral_surveys
  for each row execute function public.touch_coral_survey_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────
--
-- SELECT only for `authenticated`, as with almanac_records: every write goes
-- through a SECURITY DEFINER function so the rules about what a diver may
-- change, and when, live in one place instead of being spread across policies.

alter table public.coral_surveys enable row level security;
alter table public.coral_survey_colonies enable row level security;

grant select on table public.coral_surveys to authenticated;
grant select on table public.coral_survey_colonies to authenticated;
grant select, insert, update, delete on table public.coral_surveys to service_role;
grant select, insert, update, delete on table public.coral_survey_colonies to service_role;

create policy "Divers read own and approved coral surveys"
  on public.coral_surveys for select
  to authenticated
  using (diver_id = auth.uid() or status = 'approved');

create policy "Staff read every coral survey"
  on public.coral_surveys for select
  to authenticated
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role in ('staff', 'admin')
  ));

create policy "Colonies follow their survey"
  on public.coral_survey_colonies for select
  to authenticated
  using (exists (
    select 1 from public.coral_surveys s
    where s.id = coral_survey_colonies.survey_id
      and (
        s.diver_id = auth.uid()
        or s.status = 'approved'
        or exists (
          select 1 from public.profiles
          where profiles.id = auth.uid() and profiles.role in ('staff', 'admin')
        )
      )
  ));

-- ── Submit ─────────────────────────────────────────────────────────

-- Colonies arrive as a JSON array rather than as parallel arrays: a colony is
-- six correlated values, and six same-length array arguments is a shape that
-- goes wrong silently the first time one of them is short.
create function public.submit_coral_survey(
  p_site_id uuid,
  p_surveyed_on date,
  p_colonies jsonb,
  p_surveyed_at time default null,
  p_depth_m numeric default null,
  p_water_temp_c numeric default null,
  p_survey_method text default 'random',
  p_transect_length_m numeric default null,
  p_notes text default null
)
returns uuid
security definer
set search_path to 'public'
language plpgsql
as $$
declare
  v_survey_id uuid;
  v_existing_status text;
  v_colony jsonb;
  v_ordinal integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_surveyed_on > current_date then
    raise exception 'coral_survey_date_in_future' using errcode = '23514';
  end if;

  if p_colonies is null or jsonb_typeof(p_colonies) <> 'array' then
    raise exception 'coral_survey_colonies_must_be_array' using errcode = '22023';
  end if;

  -- A survey of nothing is not an observation that the reef is empty; it is a
  -- form somebody abandoned.
  if jsonb_array_length(p_colonies) = 0 then
    raise exception 'coral_survey_needs_a_colony' using errcode = '23514';
  end if;

  if jsonb_array_length(p_colonies) > 100 then
    raise exception 'coral_survey_too_many_colonies' using errcode = '23514';
  end if;

  select id, status into v_survey_id, v_existing_status
    from public.coral_surveys
    where site_id = p_site_id
      and surveyed_on = p_surveyed_on
      and diver_id = auth.uid();

  -- Same rule as the almanac: revisable while pending, frozen once staff have
  -- ruled on it. A diver who disagrees with a rejection talks to the shop.
  if v_survey_id is not null and v_existing_status <> 'pending' then
    raise exception 'coral_survey_already_reviewed' using errcode = '23505';
  end if;

  if v_survey_id is null then
    insert into public.coral_surveys (
      diver_id, site_id, surveyed_on, surveyed_at,
      depth_m, water_temp_c, survey_method, transect_length_m, notes
    ) values (
      auth.uid(), p_site_id, p_surveyed_on, p_surveyed_at,
      p_depth_m, p_water_temp_c, coalesce(p_survey_method, 'random'),
      p_transect_length_m, p_notes
    ) returning id into v_survey_id;
  else
    update public.coral_surveys
      set surveyed_at = p_surveyed_at,
          depth_m = p_depth_m,
          water_temp_c = p_water_temp_c,
          survey_method = coalesce(p_survey_method, 'random'),
          transect_length_m = p_transect_length_m,
          notes = p_notes
      where id = v_survey_id;
    -- The colony list is replaced wholesale rather than merged. A revision is
    -- the diver saying what they saw, and merging would leave rows from an
    -- earlier attempt standing in a survey nobody meant to include them in.
    delete from public.coral_survey_colonies where survey_id = v_survey_id;
  end if;

  for v_colony in select * from jsonb_array_elements(p_colonies)
  loop
    v_ordinal := v_ordinal + 1;
    insert into public.coral_survey_colonies (
      survey_id, ordinal, coral_type,
      lightest_hue, lightest_level, darkest_hue, darkest_level, diameter_cm
    ) values (
      v_survey_id,
      v_ordinal,
      v_colony ->> 'coral_type',
      v_colony ->> 'lightest_hue',
      (v_colony ->> 'lightest_level')::integer,
      v_colony ->> 'darkest_hue',
      (v_colony ->> 'darkest_level')::integer,
      nullif(v_colony ->> 'diameter_cm', '')::numeric
    );
  end loop;

  return v_survey_id;
end;
$$;

revoke all on function public.submit_coral_survey(
  uuid, date, jsonb, time, numeric, numeric, text, numeric, text
) from public, anon;
grant execute on function public.submit_coral_survey(
  uuid, date, jsonb, time, numeric, numeric, text, numeric, text
) to authenticated, service_role;

-- ── Read ───────────────────────────────────────────────────────────

-- One row per survey, with the colony observations aggregated into it. The
-- caller wants surveys, not a join it has to regroup, and the aggregate is
-- what the bleaching figures are computed from client-side.
create function public.coral_surveys_in_range(p_from date, p_to date)
returns table (
  id uuid,
  site_id uuid,
  site_name text,
  surveyed_on date,
  surveyed_at time,
  depth_m numeric(4,1),
  water_temp_c numeric(4,1),
  survey_method text,
  transect_length_m numeric(5,1),
  notes text,
  created_at timestamptz,
  diver_display text,
  colonies jsonb
)
security definer
set search_path to 'public'
language sql
as $$
  select
    s.id, s.site_id, d.name as site_name,
    s.surveyed_on, s.surveyed_at, s.depth_m, s.water_temp_c,
    s.survey_method, s.transect_length_m, s.notes, s.created_at,
    coalesce(p.nickname, p.name) as diver_display,
    coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'ordinal', c.ordinal,
           'coral_type', c.coral_type,
           'lightest_hue', c.lightest_hue,
           'lightest_level', c.lightest_level,
           'darkest_hue', c.darkest_hue,
           'darkest_level', c.darkest_level,
           'diameter_cm', c.diameter_cm
         ) order by c.ordinal)
       from public.coral_survey_colonies c
       where c.survey_id = s.id),
      '[]'::jsonb
    ) as colonies
  from public.coral_surveys s
  join public.profiles p on p.id = s.diver_id
  join public.dive_sites d on d.id = s.site_id
  where s.status = 'approved'
    and s.surveyed_on between p_from and p_to
  order by s.surveyed_on desc, d.name, s.created_at desc;
$$;

revoke all on function public.coral_surveys_in_range(date, date) from public, anon;
grant execute on function public.coral_surveys_in_range(date, date) to authenticated, service_role;

create function public.coral_pending_surveys()
returns table (
  id uuid,
  site_id uuid,
  site_name text,
  surveyed_on date,
  surveyed_at time,
  depth_m numeric(4,1),
  water_temp_c numeric(4,1),
  survey_method text,
  transect_length_m numeric(5,1),
  notes text,
  created_at timestamptz,
  diver_display text,
  colonies jsonb
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
    s.id, s.site_id, d.name as site_name,
    s.surveyed_on, s.surveyed_at, s.depth_m, s.water_temp_c,
    s.survey_method, s.transect_length_m, s.notes, s.created_at,
    coalesce(p.nickname, p.name) as diver_display,
    coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'ordinal', c.ordinal,
           'coral_type', c.coral_type,
           'lightest_hue', c.lightest_hue,
           'lightest_level', c.lightest_level,
           'darkest_hue', c.darkest_hue,
           'darkest_level', c.darkest_level,
           'diameter_cm', c.diameter_cm
         ) order by c.ordinal)
       from public.coral_survey_colonies c
       where c.survey_id = s.id),
      '[]'::jsonb
    ) as colonies
  from public.coral_surveys s
  join public.profiles p on p.id = s.diver_id
  join public.dive_sites d on d.id = s.site_id
  where s.status = 'pending'
  order by s.created_at;
end;
$$;

revoke all on function public.coral_pending_surveys() from public, anon;
grant execute on function public.coral_pending_surveys() to authenticated, service_role;

-- ── Moderate ───────────────────────────────────────────────────────

create function public.moderate_coral_survey(
  p_survey_id uuid,
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
    raise exception 'coral_status_must_be_approved_or_rejected' using errcode = '23514';
  end if;

  update public.coral_surveys
    set status = p_status,
        staff_notes = p_staff_notes,
        approved_by = auth.uid(),
        approved_at = now()
    where id = p_survey_id;

  if not found then
    raise exception 'coral_survey_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.moderate_coral_survey(uuid, text, text) from public, anon;
grant execute on function public.moderate_coral_survey(uuid, text, text) to authenticated, service_role;
