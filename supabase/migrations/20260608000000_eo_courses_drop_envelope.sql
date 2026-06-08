-- EO_courses no longer carries a start_date / end_date envelope. The
-- course_days date[] (added in 20260607000000) is now the sole source of
-- truth for which days a course runs on. Calendar range queries use the
-- array-overlap operator against course_days instead of the scalar
-- envelope; per-day rendering and schedule labels already read the array.
--
-- Dives are unchanged — EO_dives keeps its start_date / end_date.
--
-- No index / policy / view / trigger references these columns (the Wix
-- sync trigger serializes whole rows generically), so the drop is clean.

alter table public."EO_courses"
  drop column if exists start_date,
  drop column if exists end_date;
