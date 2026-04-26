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

-- ~330 m offsets along the bay's NE/SW axis so the three Badouzi markers
-- read as three distinct points at the page's deepest zoom (~scale 40).
-- Tighter offsets visually stack on the same dot regardless of zoom; these
-- are still placeholders, swap in real GPS when known.
update public.dive_sites
   set latitude  = 25.1459625,
       longitude = 121.8159844
 where name = 'Iron House 2';

update public.dive_sites
   set latitude  = 25.1399625,
       longitude = 121.8099844
 where name = 'Shipwrecks';

alter table public.dive_sites
  add constraint dive_sites_unique_coord unique (latitude, longitude);

commit;
