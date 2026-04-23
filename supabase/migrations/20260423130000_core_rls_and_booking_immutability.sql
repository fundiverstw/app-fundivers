-- Tighten RLS on the three sensitive tables (profiles, bookings, payments)
-- and lock the booking `details` JSON against diver edits after submission.
--
-- Motivation: the initial_schema migration declared policies on these tables,
-- but cloud has them turned OFF (dashboard toggle, legacy Wix-sync workaround).
-- With RLS off, anyone with the anon key (which ships in every page load)
-- could read and write any row. This migration flips RLS back on with an
-- explicit, app-matching policy set, and adds an immutability trigger so
-- divers cannot rewrite their registration after submit — admins still can.
--
-- Idempotent via `drop policy if exists` — safe whether policies from the
-- original schema still exist on cloud or have since been dropped.

begin;

-- ============================================================
-- Admin-check helper (breaks RLS recursion)
-- ============================================================
-- A naive `exists (select 1 from profiles where id=auth.uid() and role='admin')`
-- inline in a profiles policy recurses: the subquery re-runs RLS on profiles,
-- which re-evaluates the admin-check subquery, which queries profiles again.
-- Wrapping the lookup in a SECURITY DEFINER function breaks the loop — the
-- internal SELECT runs as the function owner (postgres), bypassing RLS.
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- ============================================================
-- RLS: enable + policies
-- ============================================================

alter table public.profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;

-- --- profiles ------------------------------------------------

-- Drop legacy names from the initial schema (if they survive) + any names
-- we might have tried previously.
drop policy if exists "Users can view own profile"   on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Staff can view all profiles"  on public.profiles;
drop policy if exists "profiles: self select"        on public.profiles;
drop policy if exists "profiles: admin select"       on public.profiles;
drop policy if exists "profiles: self update"        on public.profiles;

create policy "profiles: self select"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

create policy "profiles: admin select"
  on public.profiles for select to authenticated
  using (public.is_admin());

create policy "profiles: self update"
  on public.profiles for update to authenticated
  using     (auth.uid() = id)
  with check (auth.uid() = id);

-- (No insert policy: handle_new_user runs SECURITY DEFINER on auth.users
--  signup, bypassing RLS. No delete policy: auth.users CASCADE handles it.)

-- --- bookings ------------------------------------------------

drop policy if exists "Users can view own bookings"    on public.bookings;
drop policy if exists "Users can insert own bookings"  on public.bookings;
drop policy if exists "Users can update own bookings"  on public.bookings;
drop policy if exists "Staff can view all bookings"    on public.bookings;
drop policy if exists "bookings: self select"          on public.bookings;
drop policy if exists "bookings: admin select"         on public.bookings;
drop policy if exists "bookings: self insert"          on public.bookings;
drop policy if exists "bookings: self update"          on public.bookings;
drop policy if exists "bookings: admin update"         on public.bookings;

create policy "bookings: self select"
  on public.bookings for select to authenticated
  using (auth.uid() = user_id);

create policy "bookings: admin select"
  on public.bookings for select to authenticated
  using (public.is_admin());

create policy "bookings: self insert"
  on public.bookings for insert to authenticated
  with check (auth.uid() = user_id);

create policy "bookings: self update"
  on public.bookings for update to authenticated
  using     (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "bookings: admin update"
  on public.bookings for update to authenticated
  using     (public.is_admin())
  with check (public.is_admin());

-- (No delete policy: the app cancels via status, never hard-deletes.)

-- --- payments ------------------------------------------------

drop policy if exists "Users can view own payments"    on public.payments;
drop policy if exists "Staff can manage payments"      on public.payments;
drop policy if exists "payments: self select"          on public.payments;
drop policy if exists "payments: admin select"         on public.payments;

create policy "payments: self select"
  on public.payments for select to authenticated
  using (auth.uid() = user_id);

create policy "payments: admin select"
  on public.payments for select to authenticated
  using (public.is_admin());

-- No write policies: payments are recorded via the Supabase dashboard using
-- the service role, which bypasses RLS. If an admin payments UI ships later,
-- that migration adds its own insert/update policies.


-- ============================================================
-- bookings.details immutability (diver-only lock)
-- ============================================================
-- Once a diver submits a registration, the detail JSON (gear choices, room,
-- add-ons, transportation, payment method, totals) is frozen from their side.
-- They can still cancel the booking and request a refund — those hit `status`
-- and `refund_requested_at`, not `details`. Admins edit freely, reusing the
-- same RegisterForm via a modal on AdminEventDetailPage.

create or replace function public.bookings_block_diver_detail_edits() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.details is not distinct from old.details then
    return new;
  end if;

  -- auth.uid() is null under service-role / superuser contexts (migrations,
  -- workers, dashboard SQL editor). Those callers are trusted to edit freely.
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() then
    raise exception 'bookings.details is locked after submission; contact staff to change it'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_detail_lock_trg on public.bookings;
create trigger bookings_detail_lock_trg
  before update of details on public.bookings
  for each row execute function public.bookings_block_diver_detail_edits();

commit;
