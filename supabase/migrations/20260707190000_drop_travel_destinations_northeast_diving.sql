-- Drop travel_destinations.northeast_diving. It flagged a destination as a
-- Northeast-coast shore site to drive the calendar's local(green)/trip(yellow)
-- colour; that rule now keys off `divetype` alone — only 'Shore Diving'
-- destinations colour a dive local (see src/lib/event-colors.ts).
--
-- The "TravelDestinations" Wix compat view selects northeast_diving, so it's
-- dropped first and recreated without it (as with the coord drop before this).

begin;

drop view if exists public."TravelDestinations";

alter table public.travel_destinations drop column if exists northeast_diving;

create view public."TravelDestinations" as
select
  id as _id, admin_title, slug, tagline, country, divetype, sort_order,
  international, location_picture, background_picture, diver_requirements
from public.travel_destinations;

grant select on public."TravelDestinations" to anon, authenticated;

commit;

notify pgrst, 'reload schema';
