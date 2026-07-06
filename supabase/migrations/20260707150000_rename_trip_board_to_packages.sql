-- Rename the "Trip Board" feature to "Packages" end to end.
--
-- The diver-facing tab has always been titled "Packages" (open-ended travel
-- packages abroad, brokered through partner shops); the tables/views/RPCs were
-- named `trip*` from the feature's original "Trip Board" working name. That
-- split made the admin surface read "Trip Board" while divers saw "Packages",
-- and it collided conceptually with Scheduled Trips (the shop's own dated
-- calendar events). This migration makes the database speak one name — Packages
-- — so admin and diver surfaces line up one-to-one.
--
-- `partner_shops` keeps its name: it's the registry of external shops that HOST
-- the packages, not the package itself. The referral/kickback ledger and the
-- diver-facing definer functions all move to package* names.
--
-- App isn't deployed, so this is a clean rename with no back-compat shims: the
-- old trip_board / my_trip_referrals views (already superseded by the
-- list_* functions) are dropped, and the old-named functions are dropped after
-- their package* replacements exist.

begin;

-- ── 1. tables, columns, indexes ─────────────────────────────────────────────
alter table public.trips          rename to packages;
alter table public.trip_referrals rename to package_referrals;
alter table public.package_referrals rename column trip_id to package_id;

alter index public.trips_published_idx        rename to packages_published_idx;
alter index public.trips_partner_idx          rename to packages_partner_idx;
alter index public.trip_referrals_one_live_idx rename to package_referrals_one_live_idx;
alter index public.trip_referrals_diver_idx   rename to package_referrals_diver_idx;
alter index public.trip_referrals_trip_idx    rename to package_referrals_package_idx;

alter policy "trips: admin manage"          on public.packages          rename to "packages: admin manage";
alter policy "trip_referrals: admin manage" on public.package_referrals rename to "package_referrals: admin manage";

-- ── 2. referral-code generation (retarget to package_referrals) ─────────────
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
    exit when not exists (select 1 from public.package_referrals where referral_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.package_referrals_set_code()
returns trigger language plpgsql as $$
begin
  if new.referral_code is null or new.referral_code = '' then
    new.referral_code := public.gen_referral_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trip_referrals_set_code on public.package_referrals;
create trigger trg_package_referrals_set_code
  before insert on public.package_referrals
  for each row execute function public.package_referrals_set_code();

-- ── 3. express-interest RPC ─────────────────────────────────────────────────
create or replace function public.express_package_interest(p_package_id uuid)
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

  select status into v_status from public.packages where id = p_package_id;
  if v_status is null then
    raise exception 'package not found' using errcode = 'no_data_found';
  end if;
  if v_status <> 'published' then
    raise exception 'package is not open for interest' using errcode = 'check_violation';
  end if;

  select referral_code into v_code from public.package_referrals
    where package_id = p_package_id and diver_id = v_diver and status <> 'cancelled'
    limit 1;
  if v_code is not null then
    return v_code;
  end if;

  insert into public.package_referrals (package_id, diver_id)
    values (p_package_id, v_diver)
    returning referral_code into v_code;
  return v_code;
end;
$$;

revoke all on function public.express_package_interest(uuid) from public;
grant execute on function public.express_package_interest(uuid) to authenticated;

-- ── 4. diver-facing definer functions ──────────────────────────────────────
create or replace function public.list_package_board()
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
    p.id, p.title, p.destination, p.summary, p.description,
    p.start_date, p.end_date, p.price, p.currency,
    p.hero_image_url, p.highlights, p.booking_url, p.published_at,
    ps.id, ps.name, ps.country, ps.location, ps.website, ps.logo_url, ps.vouch_notes
  from public.packages p
  join public.partner_shops ps on ps.id = p.partner_shop_id
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
    p.title, p.destination, ps.name
  from public.package_referrals r
  join public.packages p       on p.id = r.package_id
  join public.partner_shops ps on ps.id = p.partner_shop_id
  where r.diver_id = auth.uid()
$$;

grant execute on function public.list_package_board()        to authenticated, anon, service_role;
grant execute on function public.list_my_package_referrals() to authenticated, anon, service_role;

-- ── 5. drop the old-named objects ───────────────────────────────────────────
drop function if exists public.list_trip_board();
drop function if exists public.list_my_trip_referrals();
drop function if exists public.express_trip_interest(uuid);
drop function if exists public.trip_referrals_set_code();
-- Superseded diver-facing views (already replaced by the list_* functions).
drop view if exists public.trip_board;
drop view if exists public.my_trip_referrals;

commit;

notify pgrst, 'reload schema';
