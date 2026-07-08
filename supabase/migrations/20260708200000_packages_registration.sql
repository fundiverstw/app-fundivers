-- Packages redesign: turn the referral-code board into a partner-shop
-- registration flow. Parent "product" packages gain multiple price tiers and
-- reference our add-on/room catalog; divers register (picking a tier, a
-- preferred date range, add-ons and a room) instead of getting an FD-XXXXXX
-- code. The kickback ledger is now keyed on the registration's estimated cost.
--
-- Pre-production reshape: no rows to preserve, so we drop the old referral
-- table and code machinery outright rather than migrate them.

-- 1. Drop the diver-facing referral functions (replaced below).
drop function if exists public.express_package_interest(uuid);
drop function if exists public.list_package_board();
drop function if exists public.list_my_package_referrals();

-- 2. Drop the FD-XXXXXX code system. Dropping the table cascades its trigger,
--    indexes and RLS policy; then the now-unused code helpers go too.
drop table if exists public.package_referrals cascade;
drop function if exists public.package_referrals_set_code();
drop function if exists public.gen_referral_code();

-- 3. Reshape `packages` into the parent product. Dates are diver-picked now,
--    price lives on tiers, booking happens through us (no partner link). Add
--    the catalog references (mirroring how events carry addon/room id arrays).
drop index if exists public.packages_published_idx;
alter table public.packages
  drop column if exists start_date,
  drop column if exists end_date,
  drop column if exists price,
  drop column if exists booking_url,
  add column addon_ids uuid[] not null default '{}'::uuid[],
  add column room_type_ids uuid[] not null default '{}'::uuid[];
create index packages_published_idx on public.packages using btree ("status")
  where ("status" = 'published'::text);

-- 4. Price tiers (Package A/B/C). One product has many tiers.
create table public.package_tiers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  package_id uuid not null references public.packages(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null,
  currency text not null default 'TWD',
  sort_order int not null default 0,
  constraint package_tiers_price_check check (price >= 0)
);
create index package_tiers_package_idx on public.package_tiers using btree (package_id);
alter table public.package_tiers enable row level security;
create policy "package_tiers: admin manage" on public.package_tiers
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- 5. Registrations. One row per diver-interest; carries the frozen estimate
--    snapshot and doubles as the kickback ledger. kickback_amount is generated
--    from the estimated cost (not a partner-reported booked amount).
create table public.package_registrations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  package_id uuid not null references public.packages(id) on delete cascade,
  tier_id uuid references public.package_tiers(id) on delete set null,
  diver_id uuid not null references public.profiles(id) on delete cascade,
  preferred_start date,
  preferred_end date,
  estimated_cost numeric(10,2),
  estimated_currency text,
  details jsonb not null default '{}'::jsonb,
  notes text,
  status text not null default 'registered',
  kickback_rate numeric(5,4),
  kickback_amount numeric(12,2) generated always as (round(estimated_cost * kickback_rate, 2)) stored,
  kickback_status text not null default 'expected',
  paid_at timestamptz,
  admin_notes text,
  constraint package_registrations_status_check
    check (status = any (array['registered'::text, 'completed'::text, 'cancelled'::text])),
  constraint package_registrations_kickback_status_check
    check (kickback_status = any (array['expected'::text, 'paid'::text])),
  constraint package_registrations_kickback_rate_check
    check (kickback_rate is null or (kickback_rate >= 0::numeric and kickback_rate <= 1::numeric)),
  constraint package_registrations_estimated_cost_check
    check (estimated_cost is null or estimated_cost >= 0::numeric),
  constraint package_registrations_range_check
    check (preferred_end is null or preferred_start is null or preferred_end >= preferred_start)
);
create index package_registrations_diver_idx on public.package_registrations using btree (diver_id);
create index package_registrations_package_idx on public.package_registrations using btree (package_id);
-- One live registration per diver per product; a cancelled one frees a retry.
create unique index package_registrations_one_live_idx
  on public.package_registrations using btree (package_id, diver_id)
  where (status <> 'cancelled'::text);
alter table public.package_registrations enable row level security;
create policy "package_registrations: admin manage" on public.package_registrations
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- 6. Diver-facing SECURITY DEFINER reads. Base tables are admin-only; these
--    functions expose only diver-safe columns (never the kickback rate/amount).

-- Published products for the board: joined partner + a "from" price + the
-- catalog id arrays the register form needs. No kickback columns.
create or replace function public.list_package_board() returns table(
  "id" uuid, "title" text, "destination" text, "summary" text, "description" text,
  "currency" text, "hero_image_url" text, "highlights" text[],
  "addon_ids" uuid[], "room_type_ids" uuid[], "min_price" numeric, "tier_count" bigint,
  "published_at" timestamptz, "trusted_partner_id" uuid,
  "partner_name" text, "partner_country" text, "partner_location" text,
  "partner_website" text, "partner_logo_url" text, "partner_vouch_notes" text)
  language sql stable security definer set search_path to 'public'
  as $$
  select
    p.id, p.title, p.destination, p.summary, p.description,
    p.currency, p.hero_image_url, p.highlights,
    p.addon_ids, p.room_type_ids,
    (select min(t.price) from public.package_tiers t where t.package_id = p.id),
    (select count(*) from public.package_tiers t where t.package_id = p.id),
    p.published_at, tp.id, tp.name, tp.country, tp.location, tp.website, tp.logo_url, tp.vouch_notes
  from public.packages p
  join public.trusted_partners tp on tp.id = p.trusted_partner_id
  where p.status = 'published' and tp.active
$$;
alter function public.list_package_board() owner to postgres;

-- The tiers of a published package (for the detail page / register form).
create or replace function public.list_package_tiers("p_package_id" uuid) returns table(
  "id" uuid, "package_id" uuid, "name" text, "price" numeric, "currency" text, "sort_order" int)
  language sql stable security definer set search_path to 'public'
  as $$
  select t.id, t.package_id, t.name, t.price, t.currency, t.sort_order
  from public.package_tiers t
  join public.packages p on p.id = t.package_id
  where t.package_id = p_package_id and p.status = 'published'
  order by t.sort_order, t.price
$$;
alter function public.list_package_tiers(uuid) owner to postgres;

-- The caller's own registrations with labels + estimate — no kickback ledger.
create or replace function public.list_my_package_registrations() returns table(
  "id" uuid, "package_id" uuid, "tier_id" uuid, "status" text, "created_at" timestamptz,
  "preferred_start" date, "preferred_end" date, "estimated_cost" numeric, "estimated_currency" text,
  "package_title" text, "package_destination" text, "partner_name" text, "tier_name" text)
  language sql stable security definer set search_path to 'public'
  as $$
  select
    r.id, r.package_id, r.tier_id, r.status, r.created_at,
    r.preferred_start, r.preferred_end, r.estimated_cost, r.estimated_currency,
    p.title, p.destination, tp.name, t.name
  from public.package_registrations r
  join public.packages p on p.id = r.package_id
  join public.trusted_partners tp on tp.id = p.trusted_partner_id
  left join public.package_tiers t on t.id = r.tier_id
  where r.diver_id = auth.uid()
$$;
alter function public.list_my_package_registrations() owner to postgres;

-- Diver-owned cancel: base tables are admin-only, so a diver frees a retry
-- through this definer function scoped to their own registration.
create or replace function public.cancel_my_package_registration("p_id" uuid) returns void
  language sql security definer set search_path to 'public'
  as $$
  update public.package_registrations set status = 'cancelled'
  where id = p_id and diver_id = auth.uid() and status <> 'cancelled'
$$;
alter function public.cancel_my_package_registration(uuid) owner to postgres;

grant all on function public.list_package_board() to authenticated, anon, service_role;
grant all on function public.list_package_tiers(uuid) to authenticated, anon, service_role;
grant all on function public.list_my_package_registrations() to authenticated, anon, service_role;
grant all on function public.cancel_my_package_registration(uuid) to authenticated, service_role;
