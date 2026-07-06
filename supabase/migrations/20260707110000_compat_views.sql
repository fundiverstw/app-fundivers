-- Converge (7/7): transitional compatibility VIEWS under the OLD table names,
-- so external readers (site-fundivers + the Wix site) keep working while the
-- app-code cutover to the unified events model lands separately. These views
-- are the ONLY intentional schema difference from fundive and are dropped once
-- every external reader has moved to the new names.
--
-- EO_dives/EO_courses project _id = events.legacy_id (the original Bubble uuid
-- external readers key on). The eo_* junction views map back to those legacy
-- ids. Reference-table views just expose id AS _id (values are unchanged uuids).

begin;

-- ── EO_dives ─────────────────────────────────────────────────────────────────
create view public."EO_dives" as
select
  e.legacy_id                              as _id,
  e.admin_title,
  e.display_title,
  e.divetravel_id                          as "DiveTravel_reference",
  e.price,
  (select string_agg(ed.destination_id::text, ',')
     from public.event_destinations ed where ed.event_id = e.id) as destination_reference,
  e.start_date,
  e.start_time                             as "time",
  e.end_date,
  e.cancel_date,
  e.featured,
  e.featured_image,
  e.second_image,
  e.notes,
  e.fully_booked,
  e.prereqs,
  e.nitrox_required,
  e.req_dives::bigint                      as req_dives,
  e.gear_rental,
  e.cancel_policy,
  (select string_agg(er.room_id::text, ',')
     from public.event_rooms er where er.event_id = e.id) as room_types,
  exists (select 1 from public.event_rooms er where er.event_id = e.id)   as has_rooms,
  exists (select 1 from public.event_addons ea where ea.event_id = e.id)  as hasotheraddons,
  (select string_agg(ea.addon_id::text, ',')
     from public.event_addons ea where ea.event_id = e.id) as other_addons,
  e.dive_days,
  e.prereq_cert_id,
  e.cancelled_at,
  e.full_payment_deadline,
  e.calendar_title,
  e.capacity,
  e.is_private,
  e.is_boat_dive,
  e.is_trip
from public.events e
where e.kind = 'dive';

-- ── EO_courses (start_date/end_date derived from course_days) ────────────────
create view public."EO_courses" as
select
  e.legacy_id                              as _id,
  e.display_title,
  e.calendar_title,
  e.price,
  e.start_time,
  e.course_name,
  e.featured_image,
  e.prereqs,
  e.req_dives::text                        as req_dives,
  e.included,
  e.schedule,
  e.dive_days,
  (select string_agg(ea.addon_id::text, ',')
     from public.event_addons ea where ea.event_id = e.id) as other_addons,
  e.starting_at,
  e.prereq_cert_id,
  e.cancelled_at,
  e.full_payment_deadline,
  e.cancel_date,
  e.cancel_policy,
  e.admin_title,
  e.fully_booked,
  e.capacity,
  e.course_days,
  (select min(d) from unnest(e.course_days) d) as start_date,
  (select max(d) from unnest(e.course_days) d) as end_date
from public.events e
where e.kind = 'course';

-- ── Reference-table views (id AS _id) ────────────────────────────────────────
create view public."EO_prices" as
select id as _id, admin_title, price, starting_at, deposit_amount, transport
from public.prices;

create view public."EO_rooms" as
select id as _id, admin_title, display_title, added_price, currency
from public.rooms;

create view public."Other_Addons" as
select id as _id, admin_title, price, display_title, currency
from public.addons;

-- Columns limited to those that actually exist on prod dive_travel (dev had
-- extra Bubble columns — event_type/picture/description/tagline/details/
-- event_date/price/sort_order/local/trip — that prod never had). External
-- readers (Wix) access these tolerantly (JS undefined → ''), so absent columns
-- are a no-op rather than a break.
create view public."DiveTravel" as
select
  id as _id, admin_title, included, not_included, transportation, slug,
  tagline_text, prerequisites, itinerary,
  trip_link, planned_trip, details_document, local_event_link
from public.dive_travel;

-- prod travel_destinations has longitude but no latitude (dev drift) — omit it.
create view public."TravelDestinations" as
select
  id as _id, admin_title, slug, tagline, country, divetype, sort_order,
  longitude, international, northeast_diving, location_picture,
  background_picture, diver_requirements
from public.travel_destinations;

-- ── eo_* junction views (mapped back to legacy ids) ──────────────────────────
create view public.eo_dive_addons as
select e.legacy_id as eo_dive_id, ea.addon_id
from public.event_addons ea join public.events e on e.id = ea.event_id
where e.kind = 'dive';

create view public.eo_course_addons as
select e.legacy_id as eo_course_id, ea.addon_id
from public.event_addons ea join public.events e on e.id = ea.event_id
where e.kind = 'course';

create view public.eo_dive_rooms as
select e.legacy_id as eo_dive_id, er.room_id
from public.event_rooms er join public.events e on e.id = er.event_id
where e.kind = 'dive';

create view public.eo_dive_destinations as
select e.legacy_id as eo_dive_id, ed.destination_id
from public.event_destinations ed join public.events e on e.id = ed.event_id
where e.kind = 'dive';

-- Read access for the anon/authenticated PostgREST roles the external sites use.
grant select on public."EO_dives", public."EO_courses", public."EO_prices",
  public."EO_rooms", public."Other_Addons", public."DiveTravel",
  public."TravelDestinations", public.eo_dive_addons, public.eo_course_addons,
  public.eo_dive_rooms, public.eo_dive_destinations
  to anon, authenticated;

commit;

notify pgrst, 'reload schema';
