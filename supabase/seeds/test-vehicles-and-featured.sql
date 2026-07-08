-- Local-only test fixtures: the shop transport fleet and a few FEATURED
-- upcoming dives. Gives the dashboard "Featured trips" panel something to show
-- and the logistics ride-planner a real fleet to pack divers into.
--
-- Runs after seed.sql / test-users.sql on every `make reset` (configured in
-- supabase/config.toml's [db.seed] sql_paths). NEVER pushed to cloud — `make
-- push` only ships migrations from supabase/migrations/, not seed files.
--
-- Dive dates are derived from CURRENT_DATE so the trips are always upcoming
-- (and thus pass the dashboard's !isPastEvent filter) no matter when the reset
-- runs. Deterministic ids + ON CONFLICT DO NOTHING keep this safe to rerun.

-- Transport fleet --------------------------------------------------------
-- passenger_seats is each vehicle's total physical seats, all available for
-- riders. A Delica and a smaller Veryca.
insert into public.vehicles (id, name, passenger_seats, active) values
  ('d0000000-0000-4000-8000-000000000001', 'Delica', 8, true),
  ('d0000000-0000-4000-8000-000000000002', 'Veryca', 2, true)
on conflict (id) do nothing;

-- Price row shared by the featured test dives ----------------------------
insert into public.prices ("id", "admin_title", "price", "starting_at", "deposit_amount", "transport")
values ('fee00000-0000-4000-8000-000000000001', 'Featured Test Dive', 'NTD 2,800', 2800, 1000, 1300)
on conflict ("id") do nothing;

-- Featured upcoming dives ------------------------------------------------
-- Three variants so the panel and calendar show range: a single-day trip, a
-- multi-day trip, and a fully-booked one (renders the "waitlist" flag). Two
-- carry a featured_image (wix ref → self-hosted /imgs/media copy) so the
-- image-led hero cards are exercised; the third has none, exercising the
-- gradient fallback.
insert into public.events
  ("id", "kind", "admin_title", "display_title", "calendar_title", "notes", "featured_image",
   "start_date", "start_time", "end_date",
   "featured", "fully_booked", "price", "nitrox_required", "dive_days", "is_private")
values
  ('fdd00000-0000-4000-8000-000000000001', 'dive',
   'Green Island Boat Dives', 'Green Island Boat Dives', 'Green Island', '2 Boat Dives',
   'wix:image://v1/b37fef_336fa72d68ae4cd19dcf205ba6cc555a~mv2.jpg/P1010608.jpg#originWidth=1883&originHeight=1062',
   CURRENT_DATE + 10, '08:00:00', NULL,
   true, false, 'fee00000-0000-4000-8000-000000000001', false, 2, false),
  ('fdd00000-0000-4000-8000-000000000002', 'dive',
   'Kenting Weekend Getaway', 'Kenting Weekend Getaway', 'Kenting', '3D2N 5 Boat Dives',
   'wix:image://v1/b37fef_a4be3af87a29488185d944aee75ffda9~mv2.jpg/P2080453-Giant%20Trevally-Similan-Surin%20Islands.jpg#originWidth=3684&originHeight=2078',
   CURRENT_DATE + 24, '07:30:00', CURRENT_DATE + 26,
   true, false, 'fee00000-0000-4000-8000-000000000001', false, 3, false),
  ('fdd00000-0000-4000-8000-000000000003', 'dive',
   'Orchid Island Liveaboard', 'Orchid Island Liveaboard', 'Orchid Island', '4D3N 8 Boat Dives',
   NULL,
   CURRENT_DATE + 40, '06:30:00', CURRENT_DATE + 43,
   true, true, 'fee00000-0000-4000-8000-000000000001', false, 4, false)
on conflict ("id") do nothing;
