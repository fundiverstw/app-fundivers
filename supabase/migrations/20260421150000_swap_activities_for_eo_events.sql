-- Replace the bespoke `public.activities` table with the existing
-- catalog tables `EO_dives` and `EO_courses`. `bookings` now FKs the
-- specific event it was made for (XOR: exactly one of eo_dive_id or
-- eo_course_id must be set). The UI queries the two catalog tables
-- directly; normalization happens in app code.

begin;

-- 1. Existing bookings all reference `activities`, which is about to go.
--    Drop them; ON DELETE SET NULL on payments.booking_id keeps payments intact.
delete from public.bookings;

-- 2. Remove the old activities table; cascade drops the bookings.activity_id FK.
drop table public.activities cascade;

-- 3. Reshape bookings to reference the real catalog tables.
alter table public.bookings drop column activity_id;

alter table public.bookings
  add column eo_dive_id   text references public."EO_dives"(_id)   on delete cascade,
  add column eo_course_id text references public."EO_courses"(_id) on delete cascade,
  add constraint bookings_event_xor check (
    (eo_dive_id is not null)::int + (eo_course_id is not null)::int = 1
  );

-- One booking per user per event.
create unique index bookings_user_dive_uniq
  on public.bookings (user_id, eo_dive_id)
  where eo_dive_id is not null;

create unique index bookings_user_course_uniq
  on public.bookings (user_id, eo_course_id)
  where eo_course_id is not null;

commit;
