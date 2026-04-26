-- Convert EO_*._id (and every column that FKs to one) from text to uuid.
--
-- All current rows are already UUID-shaped (verified against the cloud
-- export), so the type change is a pure ::uuid cast. Going forward, _id
-- defaults to gen_random_uuid() (no ::text wrapper) and PostgreSQL
-- enforces the format on insert — no more accidental "test_dive_abc"
-- IDs sneaking in.
--
-- Touches:
--   _id columns on EO_dives, EO_courses, EO_prices, EO_rooms, Other_Addons
--   FK columns on EO_dives.price, EO_dives.EO_price_reference,
--                 EO_courses.price
--   FK columns on bookings, admin_notes, duties,
--                 eo_dive_addons, eo_course_addons (both sides)
--
-- Existing CSV / JSON-string columns (room_types, other_addons,
-- room_options, EO_*_room_options, etc.) keep their text/jsonb types —
-- they store ids as strings inside structured text, which Postgres
-- doesn't type-check anyway. The addon-sync triggers cast their text
-- payload to uuid when inserting into the (now uuid) junction tables.

begin;

-- Drop FK constraints first so the type change is unambiguous on both sides.
alter table public."EO_dives"   drop constraint if exists "EO_dives_price_fkey";
alter table public."EO_dives"   drop constraint if exists "EO_dives_EO_price_reference_fkey";
alter table public."EO_courses" drop constraint if exists "EO_courses_price_fkey";

alter table public.bookings        drop constraint if exists bookings_eo_dive_id_fkey;
alter table public.bookings        drop constraint if exists bookings_eo_course_id_fkey;
alter table public.admin_notes     drop constraint if exists admin_notes_eo_dive_id_fkey;
alter table public.admin_notes     drop constraint if exists admin_notes_eo_course_id_fkey;
alter table public.duties          drop constraint if exists duties_eo_dive_id_fkey;
alter table public.duties          drop constraint if exists duties_eo_course_id_fkey;
alter table public.eo_dive_addons  drop constraint if exists eo_dive_addons_eo_dive_id_fkey;
alter table public.eo_dive_addons  drop constraint if exists eo_dive_addons_addon_id_fkey;
alter table public.eo_course_addons drop constraint if exists eo_course_addons_eo_course_id_fkey;
alter table public.eo_course_addons drop constraint if exists eo_course_addons_addon_id_fkey;

-- Defaults that produce text need to come off before the type change.
alter table public."EO_dives"     alter column "_id" drop default;
alter table public."EO_courses"   alter column "_id" drop default;
alter table public."EO_prices"    alter column "_id" drop default;
alter table public."EO_rooms"     alter column "_id" drop default;
alter table public."Other_Addons" alter column "_id" drop default;

-- Convert _id columns to uuid. Cast is safe — every existing row is a UUID.
alter table public."EO_dives"     alter column "_id" type uuid using "_id"::uuid;
alter table public."EO_courses"   alter column "_id" type uuid using "_id"::uuid;
alter table public."EO_prices"    alter column "_id" type uuid using "_id"::uuid;
alter table public."EO_rooms"     alter column "_id" type uuid using "_id"::uuid;
alter table public."Other_Addons" alter column "_id" type uuid using "_id"::uuid;

-- Cross-table FK columns. nullif() lets blank text become NULL so the
-- cast doesn't choke on legacy rows that store '' instead of NULL.
alter table public."EO_dives"
  alter column price                type uuid using nullif(price, '')::uuid;
alter table public."EO_dives"
  alter column "EO_price_reference" type uuid using nullif("EO_price_reference", '')::uuid;
alter table public."EO_courses"
  alter column price                type uuid using nullif(price, '')::uuid;

alter table public.bookings        alter column eo_dive_id   type uuid using nullif(eo_dive_id, '')::uuid;
alter table public.bookings        alter column eo_course_id type uuid using nullif(eo_course_id, '')::uuid;
alter table public.admin_notes     alter column eo_dive_id   type uuid using nullif(eo_dive_id, '')::uuid;
alter table public.admin_notes     alter column eo_course_id type uuid using nullif(eo_course_id, '')::uuid;
alter table public.duties          alter column eo_dive_id   type uuid using nullif(eo_dive_id, '')::uuid;
alter table public.duties          alter column eo_course_id type uuid using nullif(eo_course_id, '')::uuid;

alter table public.eo_dive_addons   alter column eo_dive_id   type uuid using eo_dive_id::uuid;
alter table public.eo_dive_addons   alter column addon_id     type uuid using addon_id::uuid;
alter table public.eo_course_addons alter column eo_course_id type uuid using eo_course_id::uuid;
alter table public.eo_course_addons alter column addon_id     type uuid using addon_id::uuid;

-- New defaults: gen_random_uuid() returns uuid directly.
alter table public."EO_dives"     alter column "_id" set default gen_random_uuid();
alter table public."EO_courses"   alter column "_id" set default gen_random_uuid();
alter table public."EO_prices"    alter column "_id" set default gen_random_uuid();
alter table public."EO_rooms"     alter column "_id" set default gen_random_uuid();
alter table public."Other_Addons" alter column "_id" set default gen_random_uuid();

-- Recreate every FK with the same on-update / on-delete behavior it had.
alter table public."EO_dives"
  add constraint "EO_dives_price_fkey"
  foreign key (price) references public."EO_prices"(_id)
  on update cascade on delete set null;

alter table public."EO_dives"
  add constraint "EO_dives_EO_price_reference_fkey"
  foreign key ("EO_price_reference") references public."EO_prices"(_id)
  on update cascade on delete set null;

alter table public."EO_courses"
  add constraint "EO_courses_price_fkey"
  foreign key (price) references public."EO_prices"(_id);

alter table public.bookings
  add constraint bookings_eo_dive_id_fkey
  foreign key (eo_dive_id)   references public."EO_dives"(_id)   on delete cascade;
alter table public.bookings
  add constraint bookings_eo_course_id_fkey
  foreign key (eo_course_id) references public."EO_courses"(_id) on delete cascade;

alter table public.admin_notes
  add constraint admin_notes_eo_dive_id_fkey
  foreign key (eo_dive_id)   references public."EO_dives"(_id)   on delete cascade;
alter table public.admin_notes
  add constraint admin_notes_eo_course_id_fkey
  foreign key (eo_course_id) references public."EO_courses"(_id) on delete cascade;

alter table public.duties
  add constraint duties_eo_dive_id_fkey
  foreign key (eo_dive_id)   references public."EO_dives"(_id)   on delete cascade;
alter table public.duties
  add constraint duties_eo_course_id_fkey
  foreign key (eo_course_id) references public."EO_courses"(_id) on delete cascade;

alter table public.eo_dive_addons
  add constraint eo_dive_addons_eo_dive_id_fkey
  foreign key (eo_dive_id) references public."EO_dives"(_id)     on delete cascade;
alter table public.eo_dive_addons
  add constraint eo_dive_addons_addon_id_fkey
  foreign key (addon_id)   references public."Other_Addons"(_id) on delete cascade;
alter table public.eo_course_addons
  add constraint eo_course_addons_eo_course_id_fkey
  foreign key (eo_course_id) references public."EO_courses"(_id)   on delete cascade;
alter table public.eo_course_addons
  add constraint eo_course_addons_addon_id_fkey
  foreign key (addon_id)     references public."Other_Addons"(_id) on delete cascade;

-- The addon-sync triggers compare a parsed text id (from EO_*.other_addons)
-- against Other_Addons._id, which is now uuid. Cast both sides to text for
-- the EXISTS check (preserves the existing "drop garbage rows" behavior in
-- parse_addon_ids), and cast elem to uuid when inserting into the junction.

create or replace function public.sync_eo_dive_addons() returns trigger
  language plpgsql as $$
begin
  delete from public.eo_dive_addons where eo_dive_id = new._id;
  insert into public.eo_dive_addons (eo_dive_id, addon_id)
  select new._id, elem::uuid
  from public.parse_addon_ids(new.other_addons) as elem
  where exists (select 1 from public."Other_Addons" a where a._id::text = elem)
  on conflict do nothing;
  return new;
end;
$$;

create or replace function public.sync_eo_course_addons() returns trigger
  language plpgsql as $$
begin
  delete from public.eo_course_addons where eo_course_id = new._id;
  insert into public.eo_course_addons (eo_course_id, addon_id)
  select new._id, elem::uuid
  from public.parse_addon_ids(new.other_addons) as elem
  where exists (select 1 from public."Other_Addons" a where a._id::text = elem)
  on conflict do nothing;
  return new;
end;
$$;

commit;
