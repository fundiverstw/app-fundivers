-- Add dive_type to public.dive_sites for the shore-vs-boat filter on /map.
--
-- 'shore' / 'boat' / NULL — NULL means "unspecified / always show". The
-- map's filter toggles only hide sites with the *opposite* known type;
-- NULL-typed sites stay visible regardless of toggle state so we don't
-- silently drop sites that haven't been classified yet.
--
-- Initial classification mirrors the FunDivers booking system's `Divetype`
-- column for the 19 seed rows; five sites (Penghu, Kenting, Green Island,
-- Lambai Island, Orchid Island) were left blank in that source and stay
-- NULL here.

begin;

alter table public.dive_sites
  add column dive_type text;

alter table public.dive_sites
  add constraint dive_sites_dive_type_check
  check (dive_type is null or dive_type in ('shore', 'boat'));

update public.dive_sites set dive_type = 'boat'  where name = 'Cauliflower Garden';
update public.dive_sites set dive_type = 'boat'  where name = 'Iron House / Iron Reef';
update public.dive_sites set dive_type = 'shore' where name = 'Secret Garden';
update public.dive_sites set dive_type = 'boat'  where name = 'Turtle Island';
update public.dive_sites set dive_type = 'boat'  where name = 'Cathedral';
update public.dive_sites set dive_type = 'shore' where name = 'Canyons';
update public.dive_sites set dive_type = 'boat'  where name = 'Shipwrecks';
update public.dive_sites set dive_type = 'boat'  where name = 'Iron House 2';
update public.dive_sites set dive_type = 'shore' where name = '82.5';
update public.dive_sites set dive_type = 'boat'  where name = 'Crystal Temple Wall';
update public.dive_sites set dive_type = 'shore' where name = 'Long Dong Bay';
update public.dive_sites set dive_type = 'boat'  where name = 'Wan An Jian Navy Wreck';
update public.dive_sites set dive_type = 'boat'  where name = 'Rainbow Reef';
update public.dive_sites set dive_type = 'shore' where name = 'Bat Cave';

commit;
