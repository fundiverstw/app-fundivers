-- Stage 2 (expand) of the prod conversion — see docs/prod-conversion.md.
-- Create the unified `events` table (fundive's shape) and backfill it from
-- EO_dives (kind='dive') + EO_courses (kind='course'). This is the ADDITIVE
-- expand step only: the old tables + child eo_dive_id/eo_course_id FKs stay in
-- place, so nothing that reads them breaks yet. Junction backfill, child-table
-- event_id, compatibility views, and the app-code cutover follow in later steps.
--
-- Reference FKs stay TEXT here (price/cancel_policy/prereq_cert_id/divetravel_id
-- point at the Bubble text _id); the reference-table → uuid stage converts them
-- later, matching fundive's own sequence.

begin;

create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  legacy_id     text unique,                 -- source EO_dives/EO_courses _id, for FK remap
  kind          text not null check (kind in ('dive', 'course')),
  -- shared identity / catalog
  admin_title   text,
  display_title text,
  calendar_title text,
  price         text,                         -- → EO_prices._id (text for now)
  dive_days     bigint,
  prereq_cert_id text,                        -- → cert_levels._id
  cancel_date   date,
  cancel_policy text,                         -- → cancellation_policies._id
  fully_booked  boolean not null default false,
  capacity      integer,
  full_payment_deadline date,
  cancelled_at  timestamptz,
  featured_image text,
  prereqs       text,
  featured      boolean not null default false,
  req_dives     integer,
  -- dive temporal envelope
  start_date    date,
  end_date      date,
  start_time    time,
  -- course discrete days
  course_days   date[],
  -- dive-only
  is_private    boolean not null default false,
  nitrox_required boolean not null default false,
  second_image  text,
  gear_rental   text,
  notes         text,
  divetravel_id text,                         -- → DiveTravel._id
  is_boat_dive  boolean not null default false,
  is_trip       boolean not null default false,
  -- course-only
  course_name   text,
  included      text,
  schedule      text,
  starting_at   integer
);

create index if not exists events_kind_start_idx on public.events (kind, start_date);

-- Dive half. EO_dives.time → start_time; DiveTravel_reference → divetravel_id.
insert into public.events (
  legacy_id, kind, admin_title, display_title, calendar_title, price, dive_days,
  prereq_cert_id, cancel_date, cancel_policy, fully_booked, capacity,
  full_payment_deadline, cancelled_at, featured_image, prereqs, featured, req_dives,
  start_date, end_date, start_time, is_private, nitrox_required, second_image,
  gear_rental, notes, divetravel_id, is_boat_dive, is_trip)
select
  d._id, 'dive', d.admin_title, d.display_title, d.calendar_title, d.price, d.dive_days,
  d.prereq_cert_id, d.cancel_date, d.cancel_policy, coalesce(d.fully_booked, false), d.capacity,
  d.full_payment_deadline, d.cancelled_at, d.featured_image, d.prereqs, coalesce(d.featured, false),
  d.req_dives::int,
  d.start_date, d.end_date, d."time", coalesce(d.is_private, false), coalesce(d.nitrox_required, false),
  d.second_image, d.gear_rental, d.notes, d."DiveTravel_reference",
  coalesce(d.is_boat_dive, false), coalesce(d.is_trip, false)
from public."EO_dives" d
on conflict (legacy_id) do nothing;

-- Course half. req_dives is free text on courses → digit-only cast (matches the
-- app's Number()-coerce). Courses use course_days, not the date envelope.
insert into public.events (
  legacy_id, kind, admin_title, display_title, calendar_title, price, dive_days,
  prereq_cert_id, cancel_date, cancel_policy, fully_booked, capacity,
  full_payment_deadline, cancelled_at, featured_image, prereqs, featured, req_dives,
  start_time, course_days, course_name, included, schedule, starting_at)
select
  c._id, 'course', c.admin_title, c.display_title, c.calendar_title, c.price, c.dive_days,
  c.prereq_cert_id, c.cancel_date, c.cancel_policy, coalesce(c.fully_booked, false), c.capacity,
  c.full_payment_deadline, c.cancelled_at, c.featured_image, c.prereqs, false,
  nullif(regexp_replace(coalesce(c.req_dives, ''), '\D', '', 'g'), '')::int,
  c.start_time, c.course_days, c.course_name, c.included, c.schedule, c.starting_at
from public."EO_courses" c
on conflict (legacy_id) do nothing;

commit;

notify pgrst, 'reload schema';
