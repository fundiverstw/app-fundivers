-- Local-only catch-up backfill for the eo_dive_destinations junction.
--
-- 20260505000000_travel_destinations_and_dive_destinations.sql contains
-- a backfill that runs as part of the migration. On cloud that's enough:
-- the migration applies against an already-populated EO_dives table.
-- Locally, migrations run before seed.sql loads EO_dives, and the
-- destination_reference sync trigger is silenced during seed.sql by its
-- `SET session_replication_role = replica;`. Result: a fresh `make
-- reset` would leave the junction empty even though EO_dives.destination
-- _reference holds the JSON arrays.
--
-- Same SQL as the migration's backfill, just re-run after seed.sql has
-- populated EO_dives. Idempotent (on conflict do nothing). Becomes a
-- no-op once `make dump-data` captures the cloud-populated junction
-- into seed.sql -- safe to leave wired up.

insert into public.eo_dive_destinations (eo_dive_id, destination_id)
select d._id, elem
from public."EO_dives" d
cross join lateral public.parse_addon_ids(d.destination_reference) as elem
where exists (select 1 from public."TravelDestinations" t where t._id = elem)
on conflict do nothing;
