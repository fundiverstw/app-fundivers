-- Manual account verification: introduce a profiles.status state machine.
--
--   pending  -- new signups land here. They have a profile row, can read
--              their own data, but cannot insert into bookings /
--              push_subscriptions through the SPA's user JWT — defense in
--              depth on top of the SPA-side RequireActive gate.
--   active   -- regular state. All existing users are backfilled here.
--   rejected -- admin-denied application. Same write-block as pending.
--
-- The first booking from create-registration is inserted under the
-- service-role client and bypasses RLS — that path stays open by design,
-- so a pending user's submitted application + first booking are visible
-- in the admin "applications" view. The is_active_user() gate kicks in
-- only on direct PostgREST inserts from a user JWT, where it should.
--
-- See docs/plan-manual-verification.md (in-flight at time of writing).

begin;

-- ============================================================
-- 1. Schema
-- ============================================================

alter table public.profiles
  add column status text not null default 'pending'
  check (status in ('pending','active','rejected'));

-- Backfill: every existing user is opted into the new gate as 'active'
-- so production behaviour is unchanged at deploy time. Only signups
-- after this migration land as 'pending'.
update public.profiles set status = 'active';

-- Partial index for the admin "pending applications" listing — avoids a
-- full scan when the queue is small (which it should usually be).
create index profiles_status_pending_idx
  on public.profiles (created_at desc) where status = 'pending';

-- ============================================================
-- 2. Helper
-- ============================================================
-- Mirrors is_admin() / is_staff_or_admin(). SECURITY DEFINER so a
-- profiles RLS policy that calls it doesn't recurse into profiles RLS.

create or replace function public.is_active_user() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  )
$$;
grant execute on function public.is_active_user() to authenticated;

-- ============================================================
-- 3. RLS: gate diver-side inserts behind is_active_user()
-- ============================================================
-- Drop + recreate (the supported pattern in this codebase since
-- migrations are immutable). Service-role bypasses RLS, so
-- create-registration's booking insert is unaffected.

drop policy if exists "bookings: self insert" on public.bookings;
create policy "bookings: self insert"
  on public.bookings for insert to authenticated
  with check (auth.uid() = user_id and public.is_active_user());

drop policy if exists "user inserts own push sub" on public.push_subscriptions;
create policy "user inserts own push sub"
  on public.push_subscriptions for insert to authenticated
  with check (auth.uid() = user_id and public.is_active_user());

commit;
