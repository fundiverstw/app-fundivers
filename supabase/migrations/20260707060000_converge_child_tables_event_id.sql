-- Converge (2/7): cut the child tables over to event_id as the sole event
-- reference. Drop the eo_dive_id/eo_course_id columns, their FKs to
-- EO_dives/EO_courses, the XOR CHECKs, and the split dive/course indexes;
-- replace them with fundive's event_id present-CHECKs and event_id indexes.
--
-- event_vehicles keeps its app-fundivers event-level shape (no event_date): its
-- uniqueness is (event_id, vehicle_id), not fundive's (vehicle_id, event_date).

begin;

-- ── bookings ─────────────────────────────────────────────────────────────────
alter table public.bookings drop constraint if exists bookings_event_xor;
alter table public.bookings drop constraint if exists bookings_eo_dive_id_fkey;
alter table public.bookings drop constraint if exists bookings_eo_course_id_fkey;
drop index if exists public.bookings_one_active_dive_per_user_idx;
drop index if exists public.bookings_one_active_course_per_user_idx;
drop index if exists public.bookings_event_id_idx;
alter table public.bookings drop column if exists eo_dive_id;
alter table public.bookings drop column if exists eo_course_id;
alter table public.bookings add constraint bookings_event_present check (event_id is not null);
alter table public.bookings alter column event_id set not null;
create unique index bookings_one_active_per_user_idx on public.bookings
  using btree (user_id, event_id) where ((event_id is not null) and (status <> 'cancelled'::text));

-- ── admin_notes (event_id XOR booking_id — event_id stays nullable) ──────────
alter table public.admin_notes drop constraint if exists admin_notes_target_xor;
alter table public.admin_notes drop constraint if exists admin_notes_eo_dive_id_fkey;
alter table public.admin_notes drop constraint if exists admin_notes_eo_course_id_fkey;
drop index if exists public.admin_notes_dive_idx;
drop index if exists public.admin_notes_course_idx;
drop index if exists public.admin_notes_event_id_idx;
alter table public.admin_notes drop column if exists eo_dive_id;
alter table public.admin_notes drop column if exists eo_course_id;
alter table public.admin_notes add constraint admin_notes_target_present
  check ((((event_id is not null))::integer + ((booking_id is not null))::integer) = 1);
create index admin_notes_event_idx on public.admin_notes using btree (event_id) where (event_id is not null);

-- ── duties (event_id stays nullable) ─────────────────────────────────────────
alter table public.duties drop constraint if exists duties_eo_dive_id_fkey;
alter table public.duties drop constraint if exists duties_eo_course_id_fkey;
drop index if exists public.duties_dive_idx;
drop index if exists public.duties_course_idx;
drop index if exists public.duties_event_id_idx;
alter table public.duties drop column if exists eo_dive_id;
alter table public.duties drop column if exists eo_course_id;
create index duties_event_idx on public.duties using btree (event_id) where (event_id is not null);

-- ── event_vehicles (event-level; NOT NULL event_id) ──────────────────────────
alter table public.event_vehicles drop constraint if exists event_vehicles_event_xor;
alter table public.event_vehicles drop constraint if exists event_vehicles_eo_dive_id_fkey;
alter table public.event_vehicles drop constraint if exists event_vehicles_eo_course_id_fkey;
drop index if exists public.event_vehicles_dive_idx;
drop index if exists public.event_vehicles_course_idx;
drop index if exists public.event_vehicles_dive_vehicle_uniq;
drop index if exists public.event_vehicles_course_vehicle_uniq;
drop index if exists public.event_vehicles_event_id_idx;
alter table public.event_vehicles drop column if exists eo_dive_id;
alter table public.event_vehicles drop column if exists eo_course_id;
alter table public.event_vehicles add constraint event_vehicles_event_present check (event_id is not null);
alter table public.event_vehicles alter column event_id set not null;
create index event_vehicles_event_idx on public.event_vehicles using btree (event_id) where (event_id is not null);
create unique index event_vehicles_event_vehicle_uniq on public.event_vehicles using btree (event_id, vehicle_id);

-- ── event_waivers (NOT NULL event_id) ────────────────────────────────────────
alter table public.event_waivers drop constraint if exists event_waivers_event_xor;
alter table public.event_waivers drop constraint if exists event_waivers_eo_dive_id_fkey;
alter table public.event_waivers drop constraint if exists event_waivers_eo_course_id_fkey;
drop index if exists public.event_waivers_dive_code_uniq;
drop index if exists public.event_waivers_course_code_uniq;
drop index if exists public.event_waivers_event_id_idx;
alter table public.event_waivers drop column if exists eo_dive_id;
alter table public.event_waivers drop column if exists eo_course_id;
alter table public.event_waivers add constraint event_waivers_event_present check (event_id is not null);
alter table public.event_waivers alter column event_id set not null;
create unique index event_waivers_event_code_uniq on public.event_waivers
  using btree (event_id, waiver_code) where (event_id is not null);

-- ── waiver_signatures (event_id stays nullable; fundive has no present-CHECK) ─
alter table public.waiver_signatures drop constraint if exists waiver_signatures_event_atmost_one;
alter table public.waiver_signatures drop constraint if exists waiver_signatures_eo_dive_id_fkey;
alter table public.waiver_signatures drop constraint if exists waiver_signatures_eo_course_id_fkey;
drop index if exists public.waiver_signatures_dive_idx;
drop index if exists public.waiver_signatures_course_idx;
drop index if exists public.waiver_signatures_event_id_idx;
alter table public.waiver_signatures drop column if exists eo_dive_id;
alter table public.waiver_signatures drop column if exists eo_course_id;
create index waiver_signatures_event_idx on public.waiver_signatures using btree (event_id) where (event_id is not null);

commit;

notify pgrst, 'reload schema';
