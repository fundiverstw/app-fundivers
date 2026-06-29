-- ============================================================
-- event_vehicles — which car is dispatched to which event on which date
-- ============================================================
-- The vehicles catalog (20260624000000_vehicles.sql) is stateless: the
-- logistics day view computes a ride suggestion at view time but never records
-- which physical car actually goes out. This table makes that allocation
-- persistent — one row = "this vehicle is assigned to this event on this date".
--
-- A car can only be in one place at a time, so a vehicle is allocated to at
-- most ONE event per date, enforced by the unique (vehicle_id, event_date)
-- index. "Cars available for an event on a date" is then the active fleet minus
-- the vehicles already holding a row that date.
--
-- Each row targets exactly one event (XOR eo_dive_id / eo_course_id), mirroring
-- bookings and event_memos. Multi-day events get one row per date (the same
-- grain as duties), so a car can be assigned for some days of a course and not
-- others.
--
-- Staff + admin read (the logistics day view is staff-accessible); only admins
-- allocate — the same policy split as the vehicles catalog.

create table public.event_vehicles (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id) on delete set null,
  vehicle_id    uuid not null references public.vehicles(id) on delete cascade,
  event_date    date not null,
  eo_dive_id    uuid references public."EO_dives"(_id)   on delete cascade,
  eo_course_id  uuid references public."EO_courses"(_id) on delete cascade,
  notes         text check (notes is null or char_length(notes) between 1 and 2000),
  constraint event_vehicles_event_xor check (
    (eo_dive_id is not null)::int + (eo_course_id is not null)::int = 1
  )
);

-- A vehicle is in one place per day: at most one allocation per (vehicle, date).
-- This is the constraint that makes "which car is available" answerable.
create unique index event_vehicles_vehicle_date_uniq
  on public.event_vehicles (vehicle_id, event_date);

-- Lookups the logistics day view runs: allocations for a day's events, and
-- everything allocated on a date (to compute availability).
create index event_vehicles_dive_idx   on public.event_vehicles (eo_dive_id)   where eo_dive_id   is not null;
create index event_vehicles_course_idx on public.event_vehicles (eo_course_id) where eo_course_id is not null;
create index event_vehicles_date_idx   on public.event_vehicles (event_date);

alter table public.event_vehicles enable row level security;

create policy "event_vehicles: staff_or_admin read"
  on public.event_vehicles for select to authenticated
  using (public.is_staff_or_admin());

create policy "event_vehicles: admin manage"
  on public.event_vehicles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
