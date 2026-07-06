-- Resolve the "SECURITY DEFINER view" linter warnings on trip_board /
-- my_trip_referrals. The views intentionally expose a curated, scoped, diver-safe
-- projection past the admin-only RLS on trips/partner_shops/trip_referrals — but
-- a SECURITY DEFINER *view* is the flagged anti-pattern. Reimplement them as
-- SECURITY DEFINER *functions* with a pinned search_path (the accepted pattern,
-- same as list_trusted_partners): identical projection + scope, base tables stay
-- hidden from direct diver queries, no kickback columns exposed.

begin;

create or replace function public.list_trip_board()
returns table (
  id uuid, title text, destination text, summary text, description text,
  start_date date, end_date date, price numeric, currency text,
  hero_image_url text, highlights text[], booking_url text, published_at timestamptz,
  partner_shop_id uuid, partner_name text, partner_country text, partner_location text,
  partner_website text, partner_logo_url text, partner_vouch_notes text)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id, t.title, t.destination, t.summary, t.description,
    t.start_date, t.end_date, t.price, t.currency,
    t.hero_image_url, t.highlights, t.booking_url, t.published_at,
    ps.id, ps.name, ps.country, ps.location, ps.website, ps.logo_url, ps.vouch_notes
  from public.trips t
  join public.partner_shops ps on ps.id = t.partner_shop_id
  where t.status = 'published'
$$;

create or replace function public.list_my_trip_referrals()
returns table (
  id uuid, trip_id uuid, referral_code text, status text, created_at timestamptz,
  trip_title text, trip_destination text, partner_name text)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id, r.trip_id, r.referral_code, r.status, r.created_at,
    t.title, t.destination, ps.name
  from public.trip_referrals r
  join public.trips t          on t.id = r.trip_id
  join public.partner_shops ps on ps.id = t.partner_shop_id
  where r.diver_id = auth.uid()
$$;

grant execute on function public.list_trip_board()        to authenticated;
grant execute on function public.list_my_trip_referrals() to authenticated;

drop view if exists public.trip_board;
drop view if exists public.my_trip_referrals;

commit;

notify pgrst, 'reload schema';
