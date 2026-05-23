-- Track money the business owes a diver — typically issued when an
-- event is cancelled (weather, low signups, etc.) and we keep the
-- deposit on the books for them to spend on a future trip instead of
-- refunding cash. The payments table stays diver-to-business; credits
-- is the opposite direction.
--
-- Lifecycle:
--   open    — diver currently has this much credit available
--   settled — admin marked it gone: either paid back out of pocket or
--             applied to a new booking. The corresponding payment row
--             (when applied to a booking) is recorded separately and
--             not auto-linked, so the audit trail stays explicit.

create table public.credits (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  -- Optional pointer to the booking that triggered the credit (e.g. the
  -- weather-cancelled dive). on delete set null so we don't lose the
  -- credit if the historical booking row is cleaned up.
  booking_id   uuid references public.bookings(id) on delete set null,
  amount       numeric(10,2) not null check (amount > 0),
  currency     text not null default 'TWD',
  reason       text not null,
  status       text not null default 'open' check (status in ('open','settled')),
  created_by   uuid references public.profiles(id),
  settled_at   timestamptz,
  settled_note text
);

create index credits_user_id_idx on public.credits(user_id);
create index credits_open_idx on public.credits(user_id) where status = 'open';

alter table public.credits enable row level security;

-- Divers can read their own credits (so PaymentsPage / ProfilePage can
-- show the balance) but never write — issuance is admin-driven only.
drop policy if exists "credits: diver select own" on public.credits;
create policy "credits: diver select own"
  on public.credits for select
  using (auth.uid() = user_id);

-- Admin / staff full read+write. Mirrors the pattern used by payments
-- and booking_amendments.
drop policy if exists "credits: staff manage all" on public.credits;
create policy "credits: staff manage all"
  on public.credits for all
  using (exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','staff')
  ))
  with check (exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','staff')
  ));
