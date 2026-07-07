-- Drop the lat/long columns from travel_destinations — the app doesn't use
-- geocoordinates for destinations (the /map page is driven by dive_sites, a
-- separate table). Both are dropped with `if exists`: dev carries `latitude`
-- and `longitude` from the original seed migration, while prod only ever had
-- `longitude` (a known dev/prod drift), so this converges both.
--
-- The "TravelDestinations" Wix compat view selects `longitude`, so it's dropped
-- first and recreated without it. (latitude was already omitted from the view.)

begin;

drop view if exists public."TravelDestinations";

alter table public.travel_destinations drop column if exists longitude;
alter table public.travel_destinations drop column if exists latitude;

create view public."TravelDestinations" as
select
  id as _id, admin_title, slug, tagline, country, divetype, sort_order,
  international, northeast_diving, location_picture,
  background_picture, diver_requirements
from public.travel_destinations;

grant select on public."TravelDestinations" to anon, authenticated;

commit;

notify pgrst, 'reload schema';
