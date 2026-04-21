-- Replace the bespoke `public.activities` table with the existing
-- catalog tables `EO_dives` and `EO_courses`. `bookings` now FKs the
-- specific event it was made for (XOR: exactly one of eo_dive_id or
-- eo_course_id must be set).
--
-- A `public.events` view was introduced here to UNION dives + courses.
-- It was later dropped in migration 20260421160000; the creation is
-- retained here because this migration was already applied to cloud
-- and applied migrations are immutable.

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

-- 4. Normalized events view (dropped in 20260421160000).
create or replace view public.events as
select
  d._id                                                                                  as id,
  'dive'::text                                                                           as type,
  coalesce(nullif(d.dive_title, ''), nullif(d.title, ''), 'Dive')                        as title,
  (d.start_date || ' ' || coalesce(nullif(d.time, ''), '00:00:00'))::timestamptz         as start_time,
  case when nullif(d.end_date, '') is null then null
       else (d.end_date || ' ' || coalesce(nullif(d.time, ''), '23:59:59'))::timestamptz
  end                                                                                    as end_time,
  coalesce(d.featured, false)                                                            as featured,
  coalesce(d.fully_booked, false)                                                        as fully_booked,
  p.starting_at::numeric                                                                 as price,
  p.deposit_amount::numeric                                                              as deposit_amount,
  'TWD'::text                                                                            as currency
from public."EO_dives" d
left join public."EO_prices" p on p._id = d.price

union all

select
  c._id                                                                                  as id,
  'course'::text                                                                         as type,
  coalesce(nullif(c.course_title, ''), nullif(c.title, ''), 'Course')                    as title,
  (c.start_date || ' ' || coalesce(nullif(c.start_time, ''), '00:00:00'))::timestamptz   as start_time,
  case when nullif(c.end_date, '') is null then null
       else (c.end_date || ' ' || coalesce(nullif(c.start_time, ''), '23:59:59'))::timestamptz
  end                                                                                    as end_time,
  false                                                                                  as featured,
  false                                                                                  as fully_booked,
  p.starting_at::numeric                                                                 as price,
  p.deposit_amount::numeric                                                              as deposit_amount,
  'TWD'::text                                                                            as currency
from public."EO_courses" c
left join public."EO_prices" p on p._id = c.price;

grant select on public.events to authenticated, anon, service_role;

commit;
