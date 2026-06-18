-- Local-only test users. Runs after seed.sql on every `make reset`
-- (configured in supabase/config.toml's [db.seed] sql_paths). NEVER
-- pushed to cloud — `make push` only ships migrations from
-- supabase/migrations/, not seed files. Lives under supabase/seeds/
-- alongside any other test-only fixtures we add later.
--
-- Credentials match the DEV_ACCOUNTS list on src/pages/LoginPage.tsx
-- so the dev "easy login" buttons work after every reset:
--
--   diver@diver.diver / diverdiver
--   admin@admin.admin / adminadmin
--   staff@staff.staff / staffstaff
--
-- Add more accounts here whenever you need a recurring local fixture.
-- Deterministic UUIDs + ON CONFLICT DO NOTHING make this safe to rerun.
-- email_confirmed_at is set so login skips the confirm gate.
--
-- Profile rows are created by the existing handle_new_user trigger on
-- auth.users insert; we patch role/name afterwards for non-divers.

do $$
declare
  -- Triplet shape: (uuid, email, plaintext password)
  rec record;
begin
  for rec in
    select * from (values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'diver@diver.diver', 'diverdiver'),
      ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'admin@admin.admin', 'adminadmin'),
      ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'staff@staff.staff', 'staffstaff')
    ) v(id, email, password)
  loop
    -- GoTrue scans these token columns into non-nullable Go strings,
    -- so NULL there causes "Database error querying schema" on signin.
    -- Postgres leaves them NULL by default; we set them to '' explicitly.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_anonymous,
      confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', rec.id,
      'authenticated', 'authenticated', rec.email,
      crypt(rec.password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), false,
      '', '',
      '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at, id
    ) values (
      rec.id::text, rec.id,
      jsonb_build_object(
        'sub', rec.id::text,
        'email', rec.email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(), now(), now(),
      gen_random_uuid()
    ) on conflict (provider, provider_id) do nothing;
  end loop;
end$$;

-- Patch the auto-created profiles. The handle_new_user trigger gave
-- everyone role='diver' by default; lift two so role-gating in the SPA
-- can be exercised. nickname is a person-style nickname (not the
-- role label) so surfaces that show "another user's display name" —
-- e.g. the staff_availability overlay — read as a real name in dev.
update public.profiles
set role = 'admin', name = 'Test Admin', nickname = 'Ada'
where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

update public.profiles
set role = 'staff', name = 'Test Staff', nickname = 'Sam'
where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

update public.profiles
set name = 'Test Diver', nickname = 'Dee'
where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';


-- ============================================================
-- Bulk fixtures for stressing list views
-- ============================================================
-- 25 extra diver accounts + two "crowded" events (one dive, one
-- course) with ~25 bookings each, spread across pending /
-- confirmed / waitlisted / cancelled. Lets the admin event detail
-- page, gear map, transportation view, and users directory show
-- realistic scroll depth without anyone clicking 25 registrations
-- by hand. Idempotent via ON CONFLICT DO NOTHING — safe to rerun
-- on every `make reset`.
--
-- ID conventions for grep-ability:
--   d0000000-…-XX → bulk diver auth.users.id (XX = 01..25)
--   e0000000-…-01 → crowded EO_dives row
--   e0000000-…-02 → crowded EO_courses row
--   b0000001-…-XX → bookings on the crowded dive
--   b0000002-…-XX → bookings on the crowded course

do $$
declare
  rec record;
  first_names text[] := array[
    'Liam','Emma','Noah','Ava','Ethan','Mia','Lucas','Isabella','Mason','Sophia',
    'Logan','Charlotte','Aiden','Amelia','Owen','Harper','Eli','Evelyn','Carter','Abigail',
    'Daniel','Ella','Henry','Scarlett','Jack'
  ];
  last_names text[] := array[
    'Anderson','Brown','Chen','Davis','Evans','Foster','Garcia','Hernandez','Iyer','Johnson',
    'Khan','Lin','Martinez','Nguyen','Olsen','Park','Quinn','Reyes','Singh','Tan',
    'Urbano','Vasquez','Wong','Xu','Yamada'
  ];
  agencies text[] := array['PADI','SSI','SDI','PADI','PADI'];
  levels   text[] := array['OW','AOW','Rescue','Divemaster','OW'];
  methods  text[] := array['line','whatsapp','phone','email'];
begin
  for i in 1..25 loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_anonymous,
      confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      ('d0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      'authenticated', 'authenticated',
      'diver' || lpad(i::text, 2, '0') || '@test.dev',
      crypt('diverdiver', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), false, '', '', '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at, id
    ) values (
      ('d0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::text,
      ('d0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      jsonb_build_object(
        'sub',   ('d0000000-0000-0000-0000-' || lpad(i::text, 12, '0')),
        'email', 'diver' || lpad(i::text, 2, '0') || '@test.dev',
        'email_verified', true,
        'phone_verified', false
      ),
      'email', now(), now(), now(), gen_random_uuid()
    ) on conflict (provider, provider_id) do nothing;

    -- handle_new_user trigger already minted a blank profile row; patch
    -- in identity + cert + contact + activate the verification gate so
    -- this account isn't treated as a fresh signup.
    update public.profiles
       set name        = first_names[i] || ' ' || last_names[i],
           nickname     = case when i % 4 = 0 then null else first_names[i] end,
           cert_agency      = agencies[1 + (i % array_length(agencies, 1))],
           cert_level       = levels[1 + (i % array_length(levels, 1))],
           nitrox_certified = (i % 3 = 0),
           deep_certified   = (i % 5 = 0),
           contact_method   = (methods[1 + (i % array_length(methods, 1))])::text,
           contact_id       = first_names[i] || '.' || methods[1 + (i % array_length(methods, 1))],
           logged_dives     = 5 + (i * 7) % 90,
           height_cm        = 155 + (i * 3) % 35,
           weight_kg        = 50 + (i * 5) % 40,
           shoe_size        = 'EU ' || (38 + (i % 8))::text,
           status           = 'active'
     where id = ('d0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid;
  end loop;
end$$;

-- Crowded dive: 14 days out. capacity set high so seeded pending rows
-- don't get auto-flipped to waitlisted by the BEFORE INSERT trigger.
insert into public."EO_dives" (
  _id, admin_title, display_title, calendar_title,
  start_date, "time", end_date,
  notes, featured, fully_booked, capacity,
  has_rooms, hasotheraddons, dive_days,
  price, "EO_price_reference"
) values (
  'e0000000-0000-0000-0000-000000000001'::uuid,
  'Crowded test dive',
  'Crowded test dive',
  'Crowded test dive',
  current_date + 14,
  '08:00:00'::time,
  current_date + 14,
  'Local dev fixture: 25+ registrants for stressing the admin event detail page.',
  false, false, 60,
  false, false, 1,
  '9fd90874-cd94-470c-b07c-c7655b558741'::uuid,
  '9fd90874-cd94-470c-b07c-c7655b558741'::uuid
) on conflict (_id) do nothing;

-- Crowded course: 28 days out, 4-day OW (course_days is the date source).
insert into public."EO_courses" (
  _id, admin_title, display_title, calendar_title,
  course_days, start_time,
  course_name, schedule, dive_days, capacity,
  price, starting_at
) values (
  'e0000000-0000-0000-0000-000000000002'::uuid,
  'Crowded test course',
  'Crowded test course',
  'Crowded test course',
  array[current_date + 28, current_date + 29, current_date + 30, current_date + 31]::date[],
  '09:00:00'::time,
  'Open Water',
  '4 days, Thu–Sun',
  4, 40,
  '7eca095c-6bc6-4adf-9e48-d8b70b59fb9f'::uuid,
  15400
) on conflict (_id) do nothing;

-- 25 bookings on the crowded dive — mixed statuses so the cards
-- render the full status / payment colour palette in dev.
do $$
declare
  statuses text[] := array['confirmed','confirmed','confirmed','confirmed',
                           'pending','pending','pending',
                           'waitlisted','cancelled'];
  payment_methods text[] := array['bank_transfer','cash','credit_card','paypal'];
begin
  for i in 1..25 loop
    insert into public.bookings (
      id, user_id, eo_dive_id, status, notes, details, created_at
    ) values (
      ('b0000001-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      ('d0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      'e0000000-0000-0000-0000-000000000001'::uuid,
      statuses[1 + (i % array_length(statuses, 1))],
      case when i % 6 = 0 then 'Vegetarian lunch please.'
           when i % 7 = 0 then 'Needs surface marker buoy on first dive.'
           else null end,
      jsonb_build_object(
        'gear',          case when i % 3 = 0
                              then jsonb_build_object('rent', true, 'mode', 'full',
                                                      'size_overrides', jsonb_build_object(
                                                        'height_cm', 155 + (i * 3) % 35,
                                                        'weight_kg', 50 + (i * 5) % 40,
                                                        'shoe_size', 'EU ' || (38 + (i % 8))::text))
                              else jsonb_build_object('rent', false) end,
        'total',         3600 + (i * 50),
        'deposit',       1800,
        'add_ons',       '[]'::jsonb,
        'transportation', (i % 2 = 0),
        'payment_method', payment_methods[1 + (i % array_length(payment_methods, 1))],
        'pay_deposit_only', (i % 5 = 0),
        'nitrox_course_addon', false
      ),
      now() - (i * interval '1 day')
    ) on conflict (id) do nothing;
  end loop;
end$$;

-- 22 bookings on the crowded course (a subset of the 25 divers).
do $$
declare
  statuses text[] := array['confirmed','confirmed','confirmed',
                           'pending','pending',
                           'waitlisted','cancelled'];
  payment_methods text[] := array['bank_transfer','cash','credit_card'];
begin
  for i in 1..22 loop
    insert into public.bookings (
      id, user_id, eo_course_id, status, notes, details, created_at
    ) values (
      ('b0000002-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      ('d0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
      'e0000000-0000-0000-0000-000000000002'::uuid,
      statuses[1 + (i % array_length(statuses, 1))],
      null,
      jsonb_build_object(
        'gear',          jsonb_build_object('rent', false, 'included', true),
        'total',         15400 + (i * 100),
        'deposit',       6000,
        'add_ons',       '[]'::jsonb,
        'transportation', (i % 2 = 1),
        'payment_method', payment_methods[1 + (i % array_length(payment_methods, 1))],
        'pay_deposit_only', false,
        'nitrox_course_addon', false
      ),
      now() - (i * interval '2 days')
    ) on conflict (id) do nothing;
  end loop;
end$$;
