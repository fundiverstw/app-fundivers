-- Phase 4: per-booking selections (gear, room, add-ons, transport,
-- payment method). Stored as a single JSONB so the shape can evolve
-- without a migration per change. The app enforces the schema in
-- src/types/database.ts (BookingDetails).

begin;

alter table public.bookings
  add column details jsonb not null default '{}'::jsonb;

-- Minimal sanity check: details must be a json object, not an array or scalar.
alter table public.bookings
  add constraint bookings_details_is_object
  check (jsonb_typeof(details) = 'object');

commit;
