-- ============================================================
-- event_vehicles → event-level many-to-many
-- ============================================================
-- 20260627000000_event_vehicles.sql modelled allocation per DATE and made a
-- vehicle exclusive to one event per day (unique vehicle_id, event_date). The
-- shop actually wants the opposite: a vehicle is a reusable resource assigned
-- to an EVENT as a whole and may serve any number of events (even overlapping
-- ones). So we drop the date grain entirely and dedupe to one row per
-- (event, vehicle). Divers still ride via bookings.details.transportation, but
-- a ride is only offered when the diver's event has an assigned car with a free
-- seat (the event_ride_seats RPC already tallies per event, no change needed).

begin;

-- Collapse the old per-date rows: a multi-day event that had the same vehicle
-- on several days becomes a single (event, vehicle) allocation. Keep the lowest
-- ctid of each duplicate group; is-not-distinct-from so the null side of the
-- XOR compares equal.
delete from public.event_vehicles a
using public.event_vehicles b
where a.ctid > b.ctid
  and a.vehicle_id   = b.vehicle_id
  and a.eo_dive_id   is not distinct from b.eo_dive_id
  and a.eo_course_id is not distinct from b.eo_course_id;

-- Dropping event_date also drops the indexes that reference it
-- (event_vehicles_vehicle_date_uniq, event_vehicles_date_idx).
alter table public.event_vehicles drop column event_date;

-- One allocation per (event, vehicle). Two partial indexes cover the XOR shape,
-- mirroring event_waivers' dive/course split.
create unique index event_vehicles_dive_vehicle_uniq
  on public.event_vehicles (eo_dive_id, vehicle_id)   where eo_dive_id   is not null;
create unique index event_vehicles_course_vehicle_uniq
  on public.event_vehicles (eo_course_id, vehicle_id) where eo_course_id is not null;

commit;

notify pgrst, 'reload schema';
