-- Convert EO_dives.nitrox_required from text to boolean.
--
-- The column was imported from Bubble as text storing 'true' / 'false'
-- string literals (or NULL). Every read in the app collapses to bool
-- via `(d.nitrox_required ?? '').toLowerCase() === 'true'`, and every
-- write supplies an explicit string. Storing it as text added nothing
-- and forced string parsing in three places.
--
-- Conversion rule mirrors the app's parse: lower(coalesce(.,'false'))
-- = 'true'. Any value that wasn't literally 'true' (case-insensitive)
-- — including NULL — becomes false.
--
-- Column stays nullable: the dumped seed.sql contains explicit NULLs
-- in this column position, and seeding runs *after* migrations on
-- `make reset`. The app continues to treat NULL as false.

begin;

alter table public."EO_dives"
  alter column nitrox_required drop default;

alter table public."EO_dives"
  alter column nitrox_required type boolean
    using (lower(coalesce(nitrox_required, 'false')) = 'true');

alter table public."EO_dives"
  alter column nitrox_required set default false;

commit;
