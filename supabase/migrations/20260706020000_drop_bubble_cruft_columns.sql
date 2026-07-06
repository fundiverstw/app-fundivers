-- Drop Bubble/Wix import cruft columns from the EO_* + reference tables.
-- All verified: 0 app usage, only definitional/import SQL references, and
-- NOT read by site-fundivers (which reads these tables off prod). Covers
-- Bubble row metadata (Created Date / Updated Date / Owner), dead link/URL
-- columns, the old google_calendar_event_id, and redundant reverse-FK list
-- columns superseded by the modern junction tables.

begin;

alter table public."cancellation_policies" drop column if exists "Created Date";
alter table public."cancellation_policies" drop column if exists "Owner";
alter table public."cancellation_policies" drop column if exists "Updated Date";
alter table public."DiveTravel" drop column if exists "Created Date";
alter table public."DiveTravel" drop column if exists "details_document";
alter table public."DiveTravel" drop column if exists "local_event_link";
alter table public."DiveTravel" drop column if exists "Owner";
alter table public."DiveTravel" drop column if exists "planned_trip";
alter table public."DiveTravel" drop column if exists "trip_link";
alter table public."DiveTravel" drop column if exists "Updated Date";
alter table public."EO_courses" drop column if exists "Created Date";
alter table public."EO_courses" drop column if exists "google_calendar_event_id";
alter table public."EO_courses" drop column if exists "link-eo-courses-course_title";
alter table public."EO_courses" drop column if exists "Owner";
alter table public."EO_courses" drop column if exists "Updated Date";
alter table public."EO_courses" drop column if exists "URL";
alter table public."EO_dives" drop column if exists "Created Date";
alter table public."EO_dives" drop column if exists "EO_price_reference";
alter table public."EO_dives" drop column if exists "google_calendar_event_id";
alter table public."EO_dives" drop column if exists "link-eo-dives-dive_title";
alter table public."EO_dives" drop column if exists "Owner";
alter table public."EO_dives" drop column if exists "Updated Date";
alter table public."EO_prices" drop column if exists "Created Date";
alter table public."EO_prices" drop column if exists "EO_dives_price";
alter table public."EO_prices" drop column if exists "Owner";
alter table public."EO_prices" drop column if exists "Updated Date";
alter table public."EO_rooms" drop column if exists "added_price_display";
alter table public."EO_rooms" drop column if exists "Created Date";
alter table public."EO_rooms" drop column if exists "EO_dives_room_types";
alter table public."EO_rooms" drop column if exists "EO_prices_room_options";
alter table public."EO_rooms" drop column if exists "Owner";
alter table public."EO_rooms" drop column if exists "per_night";
alter table public."EO_rooms" drop column if exists "Updated Date";
alter table public."Other_Addons" drop column if exists "Created Date";
alter table public."Other_Addons" drop column if exists "EO_courses_other_addons";
alter table public."Other_Addons" drop column if exists "EO_dives_other_addons";
alter table public."Other_Addons" drop column if exists "Owner";
alter table public."Other_Addons" drop column if exists "Updated Date";
alter table public."TravelDestinations" drop column if exists "Created Date";
alter table public."TravelDestinations" drop column if exists "Owner";
alter table public."TravelDestinations" drop column if exists "Updated Date";

commit;

notify pgrst, 'reload schema';
