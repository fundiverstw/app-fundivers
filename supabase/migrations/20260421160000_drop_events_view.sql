-- The public.events view was replaced by direct queries against
-- EO_dives + EO_courses normalized in src/lib/events.ts.
drop view if exists public.events;
