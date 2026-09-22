-- Local-only fixtures for the Logistics board's diver / non-diver split
-- (events.enters_water, 20260922100000). Runs after the other seeds on every
-- `make reset` (supabase/config.toml's [db.seed] sql_paths). NEVER pushed to
-- cloud — `make push` only ships migrations.
--
-- Without this the split is invisible in dev: every seeded row defaults to
-- diving, because the migration deliberately refuses to guess a course's
-- answer from its title. Here we ARE the shop, so we can say.

-- The dumped courses that are dry first-aid / classroom work. EFR students
-- and an Equipment class are on the roster all day and never get wet.
update public.events
   set enters_water = false
 where kind = 'course'
   and admin_title in ('EFR', 'Equip');

-- A shop BBQ: the whole reason the column exists. Deliberately on the same day
-- as the crowded test dive (test-users.sql, current_date + 14) so one board
-- shows both halves of the roster at once. enters_water is set explicitly even
-- though the kind already answers it — the row says what the app says.
insert into public.events (
  id, kind, admin_title, display_title, calendar_title,
  start_date, start_time, end_date,
  notes, capacity, enters_water
) values (
  'e0000000-0000-0000-0000-000000000003'::uuid, 'adventure',
  'Beach BBQ',
  'Beach BBQ',
  'Beach BBQ',
  current_date + 14,
  '16:00:00'::time,
  current_date + 14,
  'Local dev fixture: a dry event, for the non-diver half of the logistics board.',
  20, false
) on conflict (id) do nothing;

-- Who is at the BBQ. Three who are there and nowhere else — the non-divers —
-- and one who dives the same morning, to exercise the rule that any in-water
-- booking wins: they stay a diver, listed once.
--
--   diver@diver.diver      — no other booking that day
--   divers 08 and 17       — their crowded-dive booking is cancelled
--   diver 01               — confirmed on the crowded dive
insert into public.bookings (id, user_id, event_id, status, notes, details, created_at)
select
  ('b0000003-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  who,
  'e0000000-0000-0000-0000-000000000003'::uuid,
  'confirmed',
  null,
  jsonb_build_object(
    'gear',          jsonb_build_object('rent', false),
    'total',         800,
    'deposit',       0,
    'add_ons',       '[]'::jsonb,
    'transportation', (i % 2 = 0),
    'payment_method', 'cash',
    'pay_deposit_only', false,
    'nitrox_course_addon', false
  ),
  now()
from (values
  (1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  (2, 'd0000000-0000-0000-0000-000000000008'::uuid),
  (3, 'd0000000-0000-0000-0000-000000000017'::uuid),
  (4, 'd0000000-0000-0000-0000-000000000001'::uuid)
) v(i, who)
on conflict (id) do nothing;
