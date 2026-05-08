-- Append-only ledger of admin-issued adjustments to a booking's balance.
-- Each row is an immutable line item: signed `amount` (positive = the diver
-- owes more, negative = the diver owes less) plus the admin's `note`
-- explaining why. The diver-facing booking view itemises these along with
-- the original total, so the moving balance is always traceable.
--
-- Mutability:
--   * INSERT — admin only, with created_by = auth.uid() (the row records who).
--   * UPDATE / DELETE — no policy granted → blocked by RLS for everyone but
--     the service role. To "reverse" an amendment, admins add a new
--     opposite-sign amendment with a note. This keeps the audit trail intact.
--
-- Visibility:
--   * Diver → own bookings only (joined via bookings.user_id = auth.uid()).
--   * Staff / admin → all rows.

begin;

create table public.booking_amendments (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  amount      integer not null check (amount <> 0),
  note        text not null check (length(btrim(note)) > 0 and length(note) <= 1000),
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

create index booking_amendments_booking_idx
  on public.booking_amendments (booking_id, created_at);

alter table public.booking_amendments enable row level security;

create policy "booking_amendments: diver select own"
  on public.booking_amendments for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_amendments.booking_id
        and b.user_id = auth.uid()
    )
  );

create policy "booking_amendments: staff_or_admin select"
  on public.booking_amendments for select to authenticated
  using (public.is_staff_or_admin());

create policy "booking_amendments: admin insert"
  on public.booking_amendments for insert to authenticated
  with check (
    public.is_admin()
    and created_by = auth.uid()
  );

commit;
