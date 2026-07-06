-- Cutover re-backfill. On prod, migrations 20260707000000..040000 were pushed
-- early (events was backfilled THEN), but the live PWA kept writing EO_dives /
-- EO_courses / eo_*_id afterwards. So before the NOT-NULL + drop steps
-- (060000/070000) run, events + junctions + child event_id must be re-synced
-- from the CURRENT EO_* rows — otherwise app-created rows are missing from
-- events (dropped as data loss) and new bookings have event_id NULL (the
-- NOT NULL migration would abort).
--
-- Idempotent: on a fresh dev reset this runs right after the expand backfill,
-- so it is a no-op (events already matches EO_*). On prod it upserts the drift.
-- Runs while EO_dives/EO_courses + eo_*_id columns + the old junctions still
-- exist and events.divetravel_id/cancel_policy are still TEXT (pre-090000).

begin;

-- 1. Upsert events from EO_dives (insert new dives, update edited ones).
insert into public.events (
  legacy_id, kind, admin_title, display_title, calendar_title, price, dive_days,
  prereq_cert_id, cancel_date, cancel_policy, fully_booked, capacity,
  full_payment_deadline, cancelled_at, featured_image, featured, req_dives,
  start_date, end_date, start_time, is_private, nitrox_required, second_image,
  gear_rental, notes, divetravel_id, is_boat_dive, is_trip)
select
  d._id, 'dive', d.admin_title, d.display_title, d.calendar_title, d.price, d.dive_days,
  d.prereq_cert_id, d.cancel_date, d.cancel_policy, coalesce(d.fully_booked, false), d.capacity,
  d.full_payment_deadline, d.cancelled_at, d.featured_image, coalesce(d.featured, false),
  d.req_dives::int,
  d.start_date, d.end_date, d."time", coalesce(d.is_private, false), coalesce(d.nitrox_required, false),
  d.second_image, d.gear_rental, d.notes, d."DiveTravel_reference",
  coalesce(d.is_boat_dive, false), coalesce(d.is_trip, false)
from public."EO_dives" d
on conflict (legacy_id) do update set
  admin_title=excluded.admin_title, display_title=excluded.display_title,
  calendar_title=excluded.calendar_title, price=excluded.price, dive_days=excluded.dive_days,
  prereq_cert_id=excluded.prereq_cert_id, cancel_date=excluded.cancel_date,
  cancel_policy=excluded.cancel_policy, fully_booked=excluded.fully_booked, capacity=excluded.capacity,
  full_payment_deadline=excluded.full_payment_deadline, cancelled_at=excluded.cancelled_at,
  featured_image=excluded.featured_image, featured=excluded.featured, req_dives=excluded.req_dives,
  start_date=excluded.start_date, end_date=excluded.end_date, start_time=excluded.start_time,
  is_private=excluded.is_private, nitrox_required=excluded.nitrox_required,
  second_image=excluded.second_image, gear_rental=excluded.gear_rental, notes=excluded.notes,
  divetravel_id=excluded.divetravel_id, is_boat_dive=excluded.is_boat_dive, is_trip=excluded.is_trip;

-- 2. Upsert events from EO_courses.
insert into public.events (
  legacy_id, kind, admin_title, display_title, calendar_title, price, dive_days,
  prereq_cert_id, cancel_date, cancel_policy, fully_booked, capacity,
  full_payment_deadline, cancelled_at, featured_image, featured, req_dives,
  start_time, course_days, course_name, included, schedule, starting_at)
select
  c._id, 'course', c.admin_title, c.display_title, c.calendar_title, c.price, c.dive_days,
  c.prereq_cert_id, c.cancel_date, c.cancel_policy, coalesce(c.fully_booked, false), c.capacity,
  c.full_payment_deadline, c.cancelled_at, c.featured_image, false,
  nullif(regexp_replace(coalesce(c.req_dives, ''), '\D', '', 'g'), '')::int,
  c.start_time, c.course_days, c.course_name, c.included, c.schedule, c.starting_at
from public."EO_courses" c
on conflict (legacy_id) do update set
  admin_title=excluded.admin_title, display_title=excluded.display_title,
  calendar_title=excluded.calendar_title, price=excluded.price, dive_days=excluded.dive_days,
  prereq_cert_id=excluded.prereq_cert_id, cancel_date=excluded.cancel_date,
  cancel_policy=excluded.cancel_policy, fully_booked=excluded.fully_booked, capacity=excluded.capacity,
  full_payment_deadline=excluded.full_payment_deadline, cancelled_at=excluded.cancelled_at,
  featured_image=excluded.featured_image, req_dives=excluded.req_dives, start_time=excluded.start_time,
  course_days=excluded.course_days, course_name=excluded.course_name, included=excluded.included,
  schedule=excluded.schedule, starting_at=excluded.starting_at;

-- 3. Rebuild the junctions fully from the eo_* ones (captures add/remove of
--    rooms/addons/destinations since the original backfill). Leaf tables, so a
--    delete + reinsert is safe (nothing references them).
delete from public.event_addons;
insert into public.event_addons (event_id, addon_id)
select e.id, j.addon_id from public.eo_dive_addons j join public.events e on e.legacy_id = j.eo_dive_id
union
select e.id, j.addon_id from public.eo_course_addons j join public.events e on e.legacy_id = j.eo_course_id
on conflict do nothing;

delete from public.event_rooms;
insert into public.event_rooms (event_id, room_id)
select e.id, j.room_id from public.eo_dive_rooms j join public.events e on e.legacy_id = j.eo_dive_id
on conflict do nothing;

delete from public.event_destinations;
insert into public.event_destinations (event_id, destination_id)
select e.id, j.destination_id from public.eo_dive_destinations j join public.events e on e.legacy_id = j.eo_dive_id
on conflict do nothing;

-- 4. Fill event_id on child rows created since the original backfill (new
--    bookings/duties/etc. still carry only eo_dive_id/eo_course_id).
do $$
declare t text;
begin
  foreach t in array array['admin_notes','bookings','duties','event_vehicles','event_waivers','waiver_signatures']
  loop
    execute format(
      'update public.%I c set event_id = e.id from public.events e
         where e.legacy_id = coalesce(c.eo_dive_id, c.eo_course_id) and c.event_id is null', t);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
