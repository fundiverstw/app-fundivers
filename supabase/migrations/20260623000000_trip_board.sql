-- Trip Board — a curated referral network.
--
-- FunDivers vouches for reputable dive shops abroad and publishes their trips
-- to our divers; when a diver we refer books one, the partner shop pays us a
-- ~5% kickback. The transaction happens entirely OFF-platform (the partner
-- takes the booking and the money), so this app only ever:
--   1. curates partner shops + their trips (admin),
--   2. exposes published trips to divers (the board), and
--   3. tracks the referral + the kickback we're owed.
--
-- This is deliberately separate from bookings/payments/credits. Those model
-- "the diver owes the shop, money flows IN, recorded manually". A trip
-- referral inverts both sides: the money is owed by the PARTNER to US, and the
-- booking isn't ours to take. Reusing bookings would break its XOR FK
-- (eo_dive_id / eo_course_id are internal events) and pollute the payment
-- ledger with a reversed flow. New tables keep both ledgers clean.
--
-- Attribution is by REFERRAL CODE: each diver-interest mints a short, unique
-- code (FD-XXXXXX). FunDivers brokers the intro and the code travels to the
-- partner; when the partner reports "code FD-… booked NT$X" we reconcile it
-- here. The code is stamped by a trigger (authoritative for every writer,
-- including the express-interest RPC) so it can never be spoofed or missing.
--
-- Divers must NEVER see the kickback columns (booked_amount, kickback_*), but
-- they do need their own code + status. So divers get no direct access to the
-- base tables at all: they read published trips through the owner-privileged
-- `trip_board` view and their own referrals through `my_trip_referrals`, each
-- of which selects only safe columns and embeds its own caller/status filter.
-- Interest is created through the express_trip_interest SECURITY DEFINER RPC.

begin;

-- ============================================================
-- 1. partner_shops — the vouching registry
-- ============================================================
-- The external shops we vouch for. contact_* + default_kickback_rate are
-- internal (admin brokers the intro and invoices the kickback); name / country
-- / location / website / logo / vouch_notes are diver-facing via trip_board.

create table public.partner_shops (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  name                  text not null,
  country               text not null,
  location              text,
  website               text,
  contact_name          text,
  contact_email         text,
  vouch_notes           text,
  logo_url              text,
  default_kickback_rate numeric(5,4) not null default 0.05
    check (default_kickback_rate >= 0 and default_kickback_rate <= 1),
  active                boolean not null default true,
  created_by            uuid references public.profiles(id)
);

-- ============================================================
-- 2. trips — curated external trips on the board
-- ============================================================
-- status: draft (admin still editing) → published (on the diver board) →
-- archived (off the board, history kept). kickback_rate snapshots the rate we
-- expect for this trip; it's internal and never exposed to divers.

create table public.trips (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  partner_shop_id uuid not null references public.partner_shops(id) on delete restrict,
  title           text not null,
  destination     text not null,
  summary         text,
  description      text,
  start_date      date,
  end_date        date,
  price           numeric(10,2),
  currency        text not null default 'TWD',
  hero_image_url  text,
  highlights      text[] not null default '{}',
  booking_url     text,
  kickback_rate   numeric(5,4) not null default 0.05
    check (kickback_rate >= 0 and kickback_rate <= 1),
  status          text not null default 'draft'
    check (status in ('draft','published','archived')),
  published_at    timestamptz,
  created_by      uuid references public.profiles(id),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create index trips_published_idx on public.trips (status, start_date)
  where status = 'published';
create index trips_partner_idx on public.trips (partner_shop_id);

-- ============================================================
-- 3. trip_referrals — diver interest + the kickback ledger
-- ============================================================
-- One row per diver-interest; it doubles as the lead pipeline (status) and the
-- kickback ledger (booked_amount / kickback_*). kickback_amount is generated
-- from the amount the partner reports * the rate we snapshot at booking time.

create table public.trip_referrals (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  trip_id         uuid not null references public.trips(id) on delete cascade,
  diver_id        uuid not null references public.profiles(id) on delete cascade,
  referral_code   text not null unique,
  status          text not null default 'interested'
    check (status in ('interested','introduced','booked','completed','cancelled')),
  -- Kickback ledger, filled in by an admin as the referral converts:
  booked_amount   numeric(10,2) check (booked_amount is null or booked_amount >= 0),
  booked_currency text,
  kickback_rate   numeric(5,4)
    check (kickback_rate is null or (kickback_rate >= 0 and kickback_rate <= 1)),
  kickback_amount numeric(12,2)
    generated always as (round(booked_amount * kickback_rate, 2)) stored,
  kickback_status text not null default 'pending'
    check (kickback_status in ('pending','invoiced','received')),
  received_at     timestamptz,
  admin_notes     text
);

-- At most one live referral per diver per trip — re-expressing interest
-- returns the existing one (see the RPC). Cancelled rows don't block a retry.
create unique index trip_referrals_one_live_idx
  on public.trip_referrals (trip_id, diver_id)
  where status <> 'cancelled';
create index trip_referrals_diver_idx on public.trip_referrals (diver_id);
create index trip_referrals_trip_idx on public.trip_referrals (trip_id);

-- ============================================================
-- 4. referral_code generation (authoritative trigger)
-- ============================================================
-- A short, human-sayable code in Crockford base32 (no ambiguous I/L/O/U).
-- ~32^6 ≈ 1B codes; the unique index is the collision backstop, the loop just
-- avoids the rare retry. Stamped BEFORE INSERT so it lands ahead of the
-- not-null/unique checks and no writer (RPC, admin, service role) can omit it.

create or replace function public.gen_referral_code()
returns text language plpgsql as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  code text;
  i int;
begin
  loop
    code := 'FD-';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.trip_referrals where referral_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.trip_referrals_set_code()
returns trigger language plpgsql as $$
begin
  if new.referral_code is null or new.referral_code = '' then
    new.referral_code := public.gen_referral_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trip_referrals_set_code on public.trip_referrals;
create trigger trg_trip_referrals_set_code
  before insert on public.trip_referrals
  for each row execute function public.trip_referrals_set_code();

-- ============================================================
-- 5. express_trip_interest RPC
-- ============================================================
-- A diver taps "I'm interested" → this mints (or returns the existing live)
-- referral and hands back just the code. Returning only the code keeps the
-- diver from ever reading the kickback columns of their own row. Idempotent:
-- a second tap returns the same code rather than erroring on the unique index.

create or replace function public.express_trip_interest(p_trip_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_diver  uuid := auth.uid();
  v_status text;
  v_code   text;
begin
  if v_diver is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select status into v_status from public.trips where id = p_trip_id;
  if v_status is null then
    raise exception 'trip not found' using errcode = 'no_data_found';
  end if;
  if v_status <> 'published' then
    raise exception 'trip is not open for interest' using errcode = 'check_violation';
  end if;

  select referral_code into v_code from public.trip_referrals
    where trip_id = p_trip_id and diver_id = v_diver and status <> 'cancelled'
    limit 1;
  if v_code is not null then
    return v_code;
  end if;

  insert into public.trip_referrals (trip_id, diver_id)
    values (p_trip_id, v_diver)
    returning referral_code into v_code;
  return v_code;
end;
$$;

revoke all on function public.express_trip_interest(uuid) from public;
grant execute on function public.express_trip_interest(uuid) to authenticated;

-- ============================================================
-- 6. RLS — base tables are admin-only; divers read via the views
-- ============================================================
-- Divers get NO policy on any base table, so they can't reach the kickback
-- columns or unpublished/internal data even with the anon key. Admins manage
-- everything. Diver reads are served by the owner-privileged views below.

alter table public.partner_shops  enable row level security;
alter table public.trips          enable row level security;
alter table public.trip_referrals enable row level security;

create policy "partner_shops: admin manage" on public.partner_shops
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "trips: admin manage" on public.trips
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "trip_referrals: admin manage" on public.trip_referrals
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 7. Diver-facing views (owner-privileged, safe columns only)
-- ============================================================
-- These views are owned by postgres, so they bypass the base-table RLS and
-- each embeds its own scope (published / own-rows). They expose only the
-- diver-safe columns — kickback_rate and the whole kickback ledger are absent.

create view public.trip_board as
  select
    t.id,
    t.title,
    t.destination,
    t.summary,
    t.description,
    t.start_date,
    t.end_date,
    t.price,
    t.currency,
    t.hero_image_url,
    t.highlights,
    t.booking_url,
    t.published_at,
    ps.id           as partner_shop_id,
    ps.name         as partner_name,
    ps.country      as partner_country,
    ps.location     as partner_location,
    ps.website      as partner_website,
    ps.logo_url     as partner_logo_url,
    ps.vouch_notes  as partner_vouch_notes
  from public.trips t
  join public.partner_shops ps on ps.id = t.partner_shop_id
  where t.status = 'published';

create view public.my_trip_referrals as
  select
    r.id,
    r.trip_id,
    r.referral_code,
    r.status,
    r.created_at,
    t.title       as trip_title,
    t.destination as trip_destination,
    ps.name       as partner_name
  from public.trip_referrals r
  join public.trips t          on t.id = r.trip_id
  join public.partner_shops ps on ps.id = t.partner_shop_id
  where r.diver_id = auth.uid();

revoke all on public.trip_board       from anon, authenticated;
revoke all on public.my_trip_referrals from anon, authenticated;
grant select on public.trip_board       to authenticated;
grant select on public.my_trip_referrals to authenticated;

commit;
