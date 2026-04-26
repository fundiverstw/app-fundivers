-- Strip the "Badouzi Bay:" prefix from the three Badouzi sites so their
-- labels fit cleanly inside the zoomed-in Keelung view. The bay name is
-- already implied by the region context — the prefix only added clutter.
--
-- Forward-only update so the data is corrected on cloud as well as on a
-- clean local reset (where the previous migration's seed inserts the long
-- names first; this migration runs afterward and shortens them).

begin;

update public.dive_sites
   set name = 'Iron House / Iron Reef'
 where name = 'Badouzi Bay: Iron House / Iron Reef';

update public.dive_sites
   set name = 'Shipwrecks'
 where name = 'Badouzi Bay: Shipwrecks';

update public.dive_sites
   set name = 'Crystal Temple Wall'
 where name = 'Badouzi Bay: Crystal Temple Wall';

commit;
