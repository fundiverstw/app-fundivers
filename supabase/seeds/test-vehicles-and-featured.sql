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
-- passenger_seats EXCLUDES the staff driver (the planner reserves one driver
-- per vehicle). Matches the real shop: a 7-seat Delica and a 1-seat Veryca.
insert into public.vehicles (id, name, passenger_seats, active) values
  ('d0000000-0000-4000-8000-000000000001', 'Delica', 7, true),
  ('d0000000-0000-4000-8000-000000000002', 'Veryca', 1, true)
on conflict (id) do nothing;

-- Price row shared by the featured test dives ----------------------------
insert into public."EO_prices" ("_id", "admin_title", "price", "starting_at", "deposit_amount", "transport")
values ('fee00000-0000-4000-8000-000000000001', 'Featured Test Dive', 'NTD 2,800', 2800, 1000, 1300)
on conflict ("_id") do nothing;

-- Featured upcoming dives ------------------------------------------------
-- Three variants so the panel and calendar show range: a single-day trip, a
-- multi-day trip, and a fully-booked one (renders the "waitlist" flag).
insert into public."EO_dives"
  ("_id", "admin_title", "display_title", "calendar_title", "notes",
   "start_date", "time", "end_date",
   "featured", "fully_booked", "price", "nitrox_required", "dive_days", "is_private")
values
  ('fdd00000-0000-4000-8000-000000000001',
   'Green Island Boat Dives', 'Green Island Boat Dives', 'Green Island', '2 Boat Dives',
   CURRENT_DATE + 10, '08:00:00', NULL,
   true, false, 'fee00000-0000-4000-8000-000000000001', false, 2, false),
  ('fdd00000-0000-4000-8000-000000000002',
   'Kenting Weekend Getaway', 'Kenting Weekend Getaway', 'Kenting', '3D2N 5 Boat Dives',
   CURRENT_DATE + 24, '07:30:00', CURRENT_DATE + 26,
   true, false, 'fee00000-0000-4000-8000-000000000001', false, 3, false),
  ('fdd00000-0000-4000-8000-000000000003',
   'Orchid Island Liveaboard', 'Orchid Island Liveaboard', 'Orchid Island', '4D3N 8 Boat Dives',
   CURRENT_DATE + 40, '06:30:00', CURRENT_DATE + 43,
   true, true, 'fee00000-0000-4000-8000-000000000001', false, 4, false)
on conflict ("_id") do nothing;
