-- ============================================================
-- Unify trusted_partners + partner_shops into ONE table
-- ============================================================
-- We had two tables modelling the same real-world thing — "a dive shop abroad
-- we vouch for":
--   * partner_shops  — the richer registry that HOSTS Packages (country/
--     location, logo, default kickback rate, internal contact). Referenced by
--     packages.partner_shop_id (on delete restrict).
--   * trusted_partners — a thin directory (name/region/blurb/email/website)
--     powering the diver-facing Trusted Partners tab + the messaging edge fn.
--
-- They drift apart the moment an admin enters a shop in one but not the other.
-- This collapses them into a single table. partner_shops is the superset AND is
-- FK-anchored by packages, so it's kept as the physical table and RENAMED to
-- `trusted_partners` (the FK follows the rename — no package row is touched).
-- The old thin trusted_partners rows are copied in first, then that table is
-- dropped. Supersedes 20260707200000 / 20260707210000, which had list_trusted_
-- partners() UNION the two tables as a bridge; there's now just one table.
--
-- After this: one table, one admin editor (the Trusted Partners page), and the
-- diver directory shows every active partner that has a contact email.

begin;

-- ── 1. Absorb the thin directory into the richer table ──────────────────────
-- country was required on partner_shops (a real dive-travel shop always has
-- one); directory-only partners may not, so relax it. Map the thin columns:
-- region→location, blurb→vouch_notes, email→contact_email.
alter table public.partner_shops alter column country drop not null;

insert into public.partner_shops (name, location, website, contact_email, vouch_notes, active, created_by, created_at)
select name, region, website, email, blurb, active, created_by, created_at
from public.trusted_partners;

-- ── 2. Drop the old directory table + its (bridge) diver RPC ────────────────
drop function if exists public.list_trusted_partners();
drop table if exists public.trusted_partners;

-- ── 3. partner_shops IS the trusted-partners table now — rename it ──────────
alter table public.partner_shops rename to trusted_partners;
alter policy "partner_shops: admin manage" on public.trusted_partners
  rename to "trusted_partners: admin manage";
create index if not exists trusted_partners_active_idx
  on public.trusted_partners (active) where active;

-- ── 4. packages now reference a trusted partner (rename the FK column) ──────
-- The FK constraint + index track the column through the rename; only names
-- change. Keeps the "partner shop" concept out of the schema entirely.
alter table public.packages rename column partner_shop_id to trusted_partner_id;
alter index public.packages_partner_idx rename to packages_trusted_partner_idx;

-- ── 5. Diver directory projection (active + reachable; no email/kickback) ───
create function public.list_trusted_partners()
returns table (id uuid, name text, region text, blurb text, website text)
language sql
stable
security definer
set search_path = public
as $$
  select id, name, coalesce(location, country) as region, vouch_notes as blurb, website
  from public.trusted_partners
  where active and contact_email is not null
  order by name
$$;

grant execute on function public.list_trusted_partners() to authenticated, anon, service_role;

-- ── 6. Repoint the Packages definer functions to the renamed table/column ───
-- Diver-facing projection aliases stay `partner_*` (that's how a hosting shop
-- reads to divers on the board — "In cooperation with …"); only the id alias
-- becomes trusted_partner_id to match the column.
create or replace function public.list_package_board()
returns table (
  id uuid, title text, destination text, summary text, description text,
  start_date date, end_date date, price numeric, currency text,
  hero_image_url text, highlights text[], booking_url text, published_at timestamptz,
  trusted_partner_id uuid, partner_name text, partner_country text, partner_location text,
  partner_website text, partner_logo_url text, partner_vouch_notes text)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id, p.title, p.destination, p.summary, p.description,
    p.start_date, p.end_date, p.price, p.currency,
    p.hero_image_url, p.highlights, p.booking_url, p.published_at,
    tp.id, tp.name, tp.country, tp.location, tp.website, tp.logo_url, tp.vouch_notes
  from public.packages p
  join public.trusted_partners tp on tp.id = p.trusted_partner_id
  where p.status = 'published'
$$;

create or replace function public.list_my_package_referrals()
returns table (
  id uuid, package_id uuid, referral_code text, status text, created_at timestamptz,
  package_title text, package_destination text, partner_name text)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id, r.package_id, r.referral_code, r.status, r.created_at,
    p.title, p.destination, tp.name
  from public.package_referrals r
  join public.packages p           on p.id = r.package_id
  join public.trusted_partners tp  on tp.id = p.trusted_partner_id
  where r.diver_id = auth.uid()
$$;

grant execute on function public.list_package_board()        to authenticated, anon, service_role;
grant execute on function public.list_my_package_referrals() to authenticated, anon, service_role;

commit;

notify pgrst, 'reload schema';
