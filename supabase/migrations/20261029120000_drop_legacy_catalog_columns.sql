-- Drop catalog columns nothing reads.
--
-- trip_templates and travel_destinations were imported from the shop's old
-- Wix site and kept its page fields: Wix page paths (slug), links and a
-- document field that are empty in every row, and Wix photo refs
-- (location_picture / background_picture) that no page displays — the public
-- site picks destination photos from its own dive-site library. The only code
-- that touched any of them was the admin Destinations form, which edited them
-- for nobody. cert_levels.name_zh is a Chinese name the app never reads; the
-- translations carry certification names.
--
-- The second trip_templates list is columns the baseline still creates but
-- that one database (FunDivers production) had already lost outside any
-- migration. Dropping them everywhere makes every database match, and
-- `if exists` makes this safe on both kinds.
--
-- No function, view or policy references any of these columns.

alter table public.trip_templates
  drop column if exists slug,
  drop column if exists trip_link,
  drop column if exists planned_trip,
  drop column if exists details_document,
  drop column if exists local_event_link,
  -- already gone from FunDivers production; present in a fresh database
  drop column if exists description,
  drop column if exists details,
  drop column if exists event_date,
  drop column if exists event_type,
  drop column if exists local,
  drop column if exists picture,
  drop column if exists price,
  drop column if exists sort_order,
  drop column if exists tagline,
  drop column if exists trip;

alter table public.travel_destinations
  drop column if exists slug,
  drop column if exists location_picture,
  drop column if exists background_picture;

alter table public.cert_levels
  drop column if exists name_zh;
