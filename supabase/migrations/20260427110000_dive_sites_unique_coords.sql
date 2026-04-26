-- One marker, one coord. Three Badouzi sites (Iron House / Iron Reef,
-- Iron House 2, Shipwrecks) were seeded at the SAME (lat, lon) because
-- the Wix booking system pinned them all to one Badouzi Bay placeholder.
-- Visually that meant three labels stacked on one dot, with three leader
-- lines converging — confusing, and impossible for the radial-placement
-- algorithm to fully separate.
--
-- This migration:
--   1. Nudges Iron House 2 and Shipwrecks to small offsets within Badouzi
--      Bay so each site has its own location. The offsets are placeholders
--      (~30m from the original); update with real GPS when known.
--   2. Adds a UNIQUE constraint on (latitude, longitude) so two sites can
--      never share a coord again.

begin;

update public.dive_sites
   set latitude  = 25.1432625,
       longitude = 121.8132844
 where name = 'Iron House 2';

update public.dive_sites
   set latitude  = 25.1426625,
       longitude = 121.8126844
 where name = 'Shipwrecks';

alter table public.dive_sites
  add constraint dive_sites_unique_coord unique (latitude, longitude);

commit;
