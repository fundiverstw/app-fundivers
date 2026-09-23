-- Remove profiles.nickname.
--
-- The informal nickname sat one field above the legal name on every identity
-- form, and divers kept answering it with the name they actually go by,
-- leaving the legal name blank or wrong. Boat manifests and dive insurance
-- need the name exactly as it reads on the ID document, so the shop-floor
-- nickname goes and one name question is left standing.
--
-- Four reporting functions and one view showed "nickname, else name". They
-- read the legal name alone now, and are recreated here before the column
-- drop so nothing is left pointing at a column that no longer exists.
--
-- The divers who answered the wrong question are the ones this would hurt:
-- a row with a nickname and no name is the whole reason the field is going,
-- and dropping the column outright would leave them as "(unnamed)" on the
-- manifest with nothing to look them up by. Their nickname becomes the name,
-- to be corrected against an ID the next time they are in front of staff.

create or replace view public.staff_availability_view
  with (security_invoker = 'on') as
select
  sa.id,
  sa.user_id,
  sa.start_date,
  sa.start_time,
  sa.end_date,
  sa.title,
  sa.details,
  p.name as owner_display_name,
  sa.created_at,
  sa.updated_at
from public.staff_availability sa
  left join public.profiles p on p.id = sa.user_id;


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
  wildlife_taxa uuid[],
  wildlife_unmatched text[],
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
    r.weather,
    coalesce((
      select array_agg(sg.taxon_id order by sg.created_at)
      from public.almanac_sightings sg
      where sg.record_id = r.id and sg.taxon_id is not null
    ), array[]::uuid[]) as wildlife_taxa,
    coalesce((
      select array_agg(sg.raw_label order by sg.raw_label)
      from public.almanac_sightings sg
      where sg.record_id = r.id and sg.raw_label is not null
    ), array[]::text[]) as wildlife_unmatched,
    r.coral_health,
    r.elevation_m, r.route_condition, r.summit_visible,
    r.trash_band, r.trash_count, r.trash_kinds,
    p.name as diver_display
  from public.almanac_records r
  join public.profiles p on p.id = r.diver_id
  join public.dive_sites s on s.id = r.site_id
  where r.status = 'approved'
    and r.obs_date between p_from and p_to
  order by r.obs_date desc, s.name, r.created_at desc;
$$;

create or replace function public.almanac_pending_records()
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
  wildlife_taxa uuid[],
  wildlife_unmatched text[],
  coral_health text,
  elevation_m numeric(5,0),
  route_condition text,
  summit_visible boolean,
  trash_band text,
  trash_count integer,
  trash_kinds text[],
  diver_display text,
  unreviewed_taxa uuid[]
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
    r.weather,
    coalesce((
      select array_agg(sg.taxon_id order by sg.created_at)
      from public.almanac_sightings sg
      where sg.record_id = r.id and sg.taxon_id is not null
    ), array[]::uuid[]) as wildlife_taxa,
    coalesce((
      select array_agg(sg.raw_label order by sg.raw_label)
      from public.almanac_sightings sg
      where sg.record_id = r.id and sg.raw_label is not null
    ), array[]::text[]) as wildlife_unmatched,
    r.coral_health,
    r.elevation_m, r.route_condition, r.summit_visible,
    r.trash_band, r.trash_count, r.trash_kinds,
    p.name as diver_display,
    -- Which of this record's animals are themselves waiting on a ruling. The
    -- record cannot be approved while any are, so the queue says so up front
    -- rather than letting staff press Approve and read an error.
    coalesce((
      select array_agg(t.id order by t.scientific_name)
      from public.almanac_sightings sg
      join public.taxa t on t.id = sg.taxon_id
      where sg.record_id = r.id and t.status = 'pending'
    ), array[]::uuid[]) as unreviewed_taxa
  from public.almanac_records r
  join public.profiles p on p.id = r.diver_id
  join public.dive_sites s on s.id = r.site_id
  where r.status = 'pending'
  order by r.created_at asc;
end;
$$;

create or replace function public.coral_surveys_in_range(p_from date, p_to date)
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
    p.name as diver_display,
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

create or replace function public.coral_pending_surveys()
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
    p.name as diver_display,
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

update public.profiles
   set name = btrim(nickname)
 where coalesce(btrim(name), '') = ''
   and coalesce(btrim(nickname), '') <> '';

alter table public.profiles drop column nickname;
