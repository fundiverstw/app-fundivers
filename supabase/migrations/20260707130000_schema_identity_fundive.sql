-- Close the remaining schema-identity gaps with fundive's canonical schema
-- (baseline 20260703000000 + later migrations). Dev convergence only.
--
--   1. compat views: key _id off coalesce(legacy_id, id) so app-created events
--      (legacy_id NULL) still project a non-null id to external readers.
--   2. events + junction RLS: adopt fundive's 4-policy shape (no colon in name,
--      authenticated role for writes, authenticated+anon for select).
--   3. reference-table RLS policy names: rename stale EO_*/Bubble names left
--      behind by ALTER TABLE RENAME to the new table-matched names.
--   4. function EXECUTE grants: align to fundive exactly.
--   5. drop 3 orphaned Bubble-era functions absent from fundive.

begin;

-- ── 1. compat views: coalesce(legacy_id, id) ─────────────────────────────────
create or replace view public."EO_dives" as
select
  coalesce(e.legacy_id, e.id)              as _id,
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

create or replace view public."EO_courses" as
select
  coalesce(e.legacy_id, e.id)              as _id,
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

create or replace view public.eo_dive_addons as
select coalesce(e.legacy_id, e.id) as eo_dive_id, ea.addon_id
from public.event_addons ea join public.events e on e.id = ea.event_id
where e.kind = 'dive';

create or replace view public.eo_course_addons as
select coalesce(e.legacy_id, e.id) as eo_course_id, ea.addon_id
from public.event_addons ea join public.events e on e.id = ea.event_id
where e.kind = 'course';

create or replace view public.eo_dive_rooms as
select coalesce(e.legacy_id, e.id) as eo_dive_id, er.room_id
from public.event_rooms er join public.events e on e.id = er.event_id
where e.kind = 'dive';

create or replace view public.eo_dive_destinations as
select coalesce(e.legacy_id, e.id) as eo_dive_id, ed.destination_id
from public.event_destinations ed join public.events e on e.id = ed.event_id
where e.kind = 'dive';

-- ── 2. events + junction RLS → fundive's 4-policy shape ──────────────────────
drop policy if exists "events: public select" on public.events;
drop policy if exists "events: admin insert" on public.events;
drop policy if exists "events: admin update" on public.events;
drop policy if exists "events: admin delete" on public.events;
drop policy if exists "event_addons: public read" on public.event_addons;
drop policy if exists "event_addons: admin write" on public.event_addons;
drop policy if exists "event_rooms: public read" on public.event_rooms;
drop policy if exists "event_rooms: admin write" on public.event_rooms;
drop policy if exists "event_destinations: public read" on public.event_destinations;
drop policy if exists "event_destinations: admin write" on public.event_destinations;

CREATE POLICY "events admin delete" ON public."events" FOR DELETE TO authenticated USING (public.is_admin());
CREATE POLICY "events admin insert" ON public."events" FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "events admin update" ON public."events" FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "events public select" ON public."events" FOR SELECT TO authenticated, anon USING (true);

CREATE POLICY "event_addons admin delete" ON public."event_addons" FOR DELETE TO authenticated USING (public.is_admin());
CREATE POLICY "event_addons admin insert" ON public."event_addons" FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "event_addons admin update" ON public."event_addons" FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "event_addons public select" ON public."event_addons" FOR SELECT TO authenticated, anon USING (true);

CREATE POLICY "event_rooms admin delete" ON public."event_rooms" FOR DELETE TO authenticated USING (public.is_admin());
CREATE POLICY "event_rooms admin insert" ON public."event_rooms" FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "event_rooms admin update" ON public."event_rooms" FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "event_rooms public select" ON public."event_rooms" FOR SELECT TO authenticated, anon USING (true);

CREATE POLICY "event_destinations admin delete" ON public."event_destinations" FOR DELETE TO authenticated USING (public.is_admin());
CREATE POLICY "event_destinations admin insert" ON public."event_destinations" FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "event_destinations admin update" ON public."event_destinations" FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "event_destinations public select" ON public."event_destinations" FOR SELECT TO authenticated, anon USING (true);

-- ── 3. rename stale reference-table policy names ─────────────────────────────
ALTER POLICY "EO_prices: admin delete"  ON public.prices RENAME TO "prices: admin delete";
ALTER POLICY "EO_prices: admin insert"  ON public.prices RENAME TO "prices: admin insert";
ALTER POLICY "EO_prices: admin update"  ON public.prices RENAME TO "prices: admin update";
ALTER POLICY "EO_prices: public select" ON public.prices RENAME TO "prices: public select";

ALTER POLICY "EO_rooms: admin delete"  ON public.rooms RENAME TO "rooms: admin delete";
ALTER POLICY "EO_rooms: admin insert"  ON public.rooms RENAME TO "rooms: admin insert";
ALTER POLICY "EO_rooms: admin update"  ON public.rooms RENAME TO "rooms: admin update";
ALTER POLICY "EO_rooms: public select" ON public.rooms RENAME TO "rooms: public select";

ALTER POLICY "Other_Addons: admin delete"  ON public.addons RENAME TO "addons: admin delete";
ALTER POLICY "Other_Addons: admin insert"  ON public.addons RENAME TO "addons: admin insert";
ALTER POLICY "Other_Addons: admin update"  ON public.addons RENAME TO "addons: admin update";
ALTER POLICY "Other_Addons: public select" ON public.addons RENAME TO "addons: public select";

ALTER POLICY "DiveTravel: admin delete"  ON public.dive_travel RENAME TO "dive_travel: admin delete";
ALTER POLICY "DiveTravel: admin insert"  ON public.dive_travel RENAME TO "dive_travel: admin insert";
ALTER POLICY "DiveTravel: admin update"  ON public.dive_travel RENAME TO "dive_travel: admin update";
ALTER POLICY "DiveTravel: public select" ON public.dive_travel RENAME TO "dive_travel: public select";

ALTER POLICY "TravelDestinations: admin delete"  ON public.travel_destinations RENAME TO "travel_destinations: admin delete";
ALTER POLICY "TravelDestinations: admin insert"  ON public.travel_destinations RENAME TO "travel_destinations: admin insert";
ALTER POLICY "TravelDestinations: admin update"  ON public.travel_destinations RENAME TO "travel_destinations: admin update";
ALTER POLICY "TravelDestinations: public select" ON public.travel_destinations RENAME TO "travel_destinations: public select";

-- ── 4. function EXECUTE grants → fundive ─────────────────────────────────────
-- SECURITY DEFINER helpers: fundive keeps PUBLIC's default execute and, via the
-- postgres default-privileges, also grants anon/authenticated/service_role.
grant execute on function public.list_trip_board()               to anon, service_role;
grant execute on function public.list_my_trip_referrals()        to anon, service_role;
grant execute on function public.list_trusted_partners()         to anon, service_role;
grant execute on function public.replace_gear_model_sizes(uuid, jsonb) to anon, service_role;
grant execute on function public.notify_admins_ride_waitlist()   to anon, authenticated, service_role;

-- fundive REVOKEs PUBLIC and grants only the three Supabase roles.
revoke execute on function public.set_event_relations(uuid, uuid[], uuid[], uuid[]) from public;
grant execute on function public.set_event_relations(uuid, uuid[], uuid[], uuid[]) to anon, authenticated, service_role;

revoke execute on function public.sign_waiver(text, integer, text, uuid) from public;
grant execute on function public.sign_waiver(text, integer, text, uuid) to anon, authenticated, service_role;

-- ── 5. drop orphaned Bubble-era functions ────────────────────────────────────
drop function if exists public.parse_addon_ids(text);
drop function if exists public.parse_room_ids(text);
drop function if exists public.wix_sync_notify();

commit;

notify pgrst, 'reload schema';
