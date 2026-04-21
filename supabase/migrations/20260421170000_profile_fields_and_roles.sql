-- Phase 1 of the diver/admin user-model revamp:
--   * profiles.role narrows from (customer|staff|admin) → (diver|admin)
--     with customer→diver and staff→admin as the data migration
--   * profiles gains fields the diver registration form collects
--     (physical sizing, contact preference, cert status)
--
-- The `handle_new_user` trigger unchanged — it still inserts a bare row;
-- the new default on `role` ('diver') handles new signups.

begin;

-- 1. Drop the old CHECK first so the data migration can introduce new values.
alter table public.profiles drop constraint profiles_role_check;

-- 2. Migrate existing rows.
update public.profiles set role = 'diver' where role = 'customer';
update public.profiles set role = 'admin' where role = 'staff';

-- 3. Install the new CHECK + default.
alter table public.profiles
  add constraint profiles_role_check check (role in ('diver','admin'));
alter table public.profiles alter column role set default 'diver';

-- 3. New columns driven by the registration form.
alter table public.profiles
  add column height_cm        numeric,
  add column weight_kg        numeric,
  add column shoe_size        text,
  add column gender           text,
  add column contact_method   text check (contact_method in ('whatsapp','line','phone','email')),
  add column contact_id       text,
  add column nitrox_certified boolean not null default false,
  add column logged_dives     integer not null default 0 check (logged_dives >= 0),
  add column last_dive_date   date;

commit;
