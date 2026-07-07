-- Drop the transitional Bubble/Wix compatibility VIEWS. They existed only to let
-- external readers (the Wix site + site-fundivers) keep querying the old
-- EO_* / DiveTravel / TravelDestinations names while the app cut over to the
-- unified `events` model and the fundive-named reference tables. Every reader
-- has since moved to the real tables (events, prices, rooms, addons,
-- trip_templates, travel_destinations, cancellation_policies + the event_*
-- junctions), so these views are now dead weight.
--
-- No app code reads them (verified: zero .from('EO_*') in src), the Wix sync
-- pulls the real tables (SYNC_TABLES), and no wix_sync trigger targets a view.
-- The wix_sync infrastructure and the unrelated staff_availability_view are
-- intentionally left in place. DiveTravel was already dropped in
-- 20260707170000; it's listed here with `if exists` for completeness.

begin;

drop view if exists public."EO_dives";
drop view if exists public."EO_courses";
drop view if exists public."EO_prices";
drop view if exists public."EO_rooms";
drop view if exists public."Other_Addons";
drop view if exists public."DiveTravel";
drop view if exists public."TravelDestinations";
drop view if exists public.eo_dive_addons;
drop view if exists public.eo_course_addons;
drop view if exists public.eo_dive_rooms;
drop view if exists public.eo_dive_destinations;

commit;

notify pgrst, 'reload schema';
