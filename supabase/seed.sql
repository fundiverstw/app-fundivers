-- ============================================================
-- FunDivers TW — Seed Data
-- Applied automatically on: npx supabase db reset
-- ============================================================

-- ============================================================
-- Users (auth.users + profiles)
-- All passwords: devdevdev
-- ============================================================

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated', 'authenticated',
    'dev@dev.dev',
    crypt('devdevdev', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{}', false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-2222-2222-222222222222',
    'authenticated', 'authenticated',
    'alice@example.com',
    crypt('devdevdev', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{}', false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '33333333-3333-3333-3333-333333333333',
    'authenticated', 'authenticated',
    'bob@example.com',
    crypt('devdevdev', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{}', false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '44444444-4444-4444-4444-444444444444',
    'authenticated', 'authenticated',
    'staff@fundiverstw.com',
    crypt('devdevdev', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{}', false
  );

-- auth.identities required for email login
insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at
) values
  ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '{"sub":"11111111-1111-1111-1111-111111111111","email":"dev@dev.dev"}', 'email', now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', '{"sub":"22222222-2222-2222-2222-222222222222","email":"alice@example.com"}', 'email', now(), now(), now()),
  ('33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', '{"sub":"33333333-3333-3333-3333-333333333333","email":"bob@example.com"}', 'email', now(), now(), now()),
  ('44444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', '{"sub":"44444444-4444-4444-4444-444444444444","email":"staff@fundiverstw.com"}', 'email', now(), now(), now());

-- Profiles
update public.profiles set
  full_name = 'Dev User',
  display_name = 'Dev',
  phone = '+886-900-000-000',
  cert_agency = 'PADI',
  cert_level = 'Open Water',
  cert_number = 'DEV001',
  nationality = 'Taiwanese',
  emergency_contact_name = 'Emergency Contact',
  emergency_contact_phone = '+886-900-000-001'
where id = '11111111-1111-1111-1111-111111111111';

update public.profiles set
  full_name = 'Alice Chen',
  display_name = 'Alice',
  phone = '+886-912-345-678',
  cert_agency = 'PADI',
  cert_level = 'Advanced Open Water',
  cert_number = 'PADI-AOW-2024-001',
  nationality = 'Taiwanese',
  emergency_contact_name = 'Chen Wei',
  emergency_contact_phone = '+886-912-000-001'
where id = '22222222-2222-2222-2222-222222222222';

update public.profiles set
  full_name = 'Bob Williams',
  display_name = 'Bob',
  phone = '+1-555-234-5678',
  cert_agency = 'SSI',
  cert_level = 'Open Water',
  cert_number = 'SSI-OW-2023-042',
  nationality = 'American',
  emergency_contact_name = 'Sarah Williams',
  emergency_contact_phone = '+1-555-234-0000'
where id = '33333333-3333-3333-3333-333333333333';

update public.profiles set
  full_name = 'Staff Member',
  display_name = 'Staff',
  role = 'staff'
where id = '44444444-4444-4444-4444-444444444444';

-- ============================================================
-- Activities
-- ============================================================

insert into public.activities (id, title, type, description, start_time, end_time, location, capacity, price, currency, is_published) values
  (
    'aaaaaaaa-0001-0000-0000-000000000000',
    'Fun Dive — Xiaoliuqiu',
    'dive',
    'Two-tank fun dive around Little Liuqiu island. Sea turtles almost guaranteed! Suitable for Open Water certified divers and above.',
    now() + interval '3 days',
    now() + interval '3 days' + interval '8 hours',
    'Xiaoliuqiu (小琉球), Pingtung',
    8, 2800, 'TWD', true
  ),
  (
    'aaaaaaaa-0002-0000-0000-000000000000',
    'PADI Open Water Course',
    'course',
    'Full PADI Open Water Diver certification. Includes 5 knowledge development sessions, 5 confined water dives, and 4 open water dives. Materials included.',
    now() + interval '7 days',
    now() + interval '11 days',
    'FunDivers TW Shop + Kenting',
    4, 18000, 'TWD', true
  ),
  (
    'aaaaaaaa-0003-0000-0000-000000000000',
    'Night Dive — Kenting',
    'dive',
    'Experience the reef after dark. Witness nocturnal marine life including octopus, lobster, and sleeping fish. Min. Advanced OW certification.',
    now() + interval '10 days',
    now() + interval '10 days' + interval '4 hours',
    'Kenting National Park (墾丁)',
    6, 1800, 'TWD', true
  ),
  (
    'aaaaaaaa-0004-0000-0000-000000000000',
    'PADI Advanced Open Water Course',
    'course',
    'Expand your skills with 5 adventure dives including Deep, Navigation, and 3 electives of your choice.',
    now() + interval '14 days',
    now() + interval '16 days',
    'FunDivers TW Shop + Kenting',
    4, 12000, 'TWD', true
  ),
  (
    'aaaaaaaa-0005-0000-0000-000000000000',
    'Ocean Clean-Up Dive',
    'event',
    'Join us for our quarterly ocean clean-up dive. Free for all certified divers. Equipment provided. Help keep our reefs beautiful!',
    now() + interval '18 days',
    now() + interval '18 days' + interval '5 hours',
    'Cijin Island (旗津), Kaohsiung',
    20, 0, 'TWD', true
  ),
  (
    'aaaaaaaa-0006-0000-0000-000000000000',
    'Fun Dive — Green Island',
    'dive',
    'Three-tank dive trip to Green Island (Lyudao). Famous for its crystal clear water and diverse marine life. Overnight trip available.',
    now() + interval '21 days',
    now() + interval '21 days' + interval '10 hours',
    'Green Island (綠島), Taitung',
    6, 3800, 'TWD', true
  ),
  (
    'aaaaaaaa-0007-0000-0000-000000000000',
    'Dive & BBQ Social',
    'event',
    'Two fun dives followed by a BBQ on the beach. Great way to meet fellow divers. Family and non-divers welcome for the BBQ portion.',
    now() + interval '25 days',
    now() + interval '25 days' + interval '7 hours',
    'Baisha Bay (白沙灣), New Taipei',
    15, 1200, 'TWD', true
  );

-- ============================================================
-- Bookings
-- ============================================================

insert into public.bookings (user_id, activity_id, status) values
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0001-0000-0000-000000000000', 'confirmed'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0001-0000-0000-000000000000', 'confirmed'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0001-0000-0000-000000000000', 'pending'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0002-0000-0000-000000000000', 'confirmed'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0005-0000-0000-000000000000', 'confirmed'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0006-0000-0000-000000000000', 'pending');

-- ============================================================
-- Payments
-- ============================================================

insert into public.payments (user_id, booking_id, amount, currency, status, method, note, recorded_by)
select
  b.user_id,
  b.id,
  a.price,
  a.currency,
  'paid',
  'Bank transfer',
  'Paid in full',
  '44444444-4444-4444-4444-444444444444'
from public.bookings b
join public.activities a on a.id = b.activity_id
where b.status = 'confirmed' and a.price > 0;

-- Pending payment for dev user's Xiaoliuqiu booking
insert into public.payments (user_id, booking_id, amount, currency, status, method, note, recorded_by)
select
  b.user_id,
  b.id,
  a.price,
  a.currency,
  'pending',
  null,
  'Awaiting payment',
  '44444444-4444-4444-4444-444444444444'
from public.bookings b
join public.activities a on a.id = b.activity_id
where b.user_id = '11111111-1111-1111-1111-111111111111'
  and b.activity_id = 'aaaaaaaa-0001-0000-0000-000000000000';
