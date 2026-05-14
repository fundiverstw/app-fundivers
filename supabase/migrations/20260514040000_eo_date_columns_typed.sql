-- Convert EO_dives / EO_courses date + time columns from text to proper
-- date / time types.
--
-- These columns were imported from Bubble as text storing 'YYYY-MM-DD'
-- dates and 'HH:MM:SS.SSS' times (or empty strings). Every consumer —
-- src/lib/events.ts, the admin EventForm, the Wix backend, the
-- upcoming_* widgets — already treats them as those exact ISO shapes,
-- and the dropped public.events view from 20260421150000 had to do
-- `(start_date || ' ' || time)::timestamptz` casts at read time. Storing
-- the real types instead gives us range filters and ordering without
-- per-query coercion, and PostgREST serializes date/time back as the
-- same 'YYYY-MM-DD' / 'HH:MM:SS' strings, so all the JS consumers stay
-- byte-compatible.
--
-- Empty strings collapse to NULL via nullif(...). EO_courses.cancel_date
-- was already `date` (20260430010000_eo_courses_cancel_policy.sql), so
-- it is omitted here.

begin;

alter table public."EO_dives"
  alter column start_date  type date using nullif(start_date,  '')::date,
  alter column end_date    type date using nullif(end_date,    '')::date,
  alter column cancel_date type date using nullif(cancel_date, '')::date,
  alter column "time"      type time using nullif("time",      '')::time;

alter table public."EO_courses"
  alter column start_date   type date using nullif(start_date,   '')::date,
  alter column end_date     type date using nullif(end_date,     '')::date,
  alter column special_date type date using nullif(special_date, '')::date,
  alter column start_time   type time using nullif(start_time,   '')::time;

notify pgrst, 'reload schema';

commit;
