-- Let a parent read the financial rows behind a child's booking.
--
-- The diver-facing balance is
--     owed(details.total + amendments) - payments - credits
-- and RLS decided only three of those four inputs were a parent's business:
--
--   bookings            self + parent + staff/admin
--   payments            self + parent + staff/admin
--   booking_amendments  self only              <- missing
--   credits             self only              <- missing
--
-- So a parent looking at a child's booking saw the full undiscounted total and
-- the payments against it, but none of the discounts (negative amendments) or
-- awarded credits. Those simply returned zero rows, so `amendmentsDelta` and
-- the open-credit lookup both silently came back 0 and the parent was shown a
-- balance higher than the child actually owed. Nothing in the app code was
-- wrong; it was asking for rows RLS would never hand over.
--
-- These mirror `payments: parent select children` exactly. SELECT only —
-- writing an amendment stays admin-only, and credits are still awarded by the
-- shop; this is purely about a parent seeing what their child is charged.

create policy "booking_amendments: parent select children"
  on public.booking_amendments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.bookings b
      join public.profiles p on p.id = b.user_id
      where b.id = booking_amendments.booking_id
        and p.parent_account = auth.uid()
    )
  );

create policy "credits: parent select children"
  on public.credits
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = credits.user_id
        and p.parent_account = auth.uid()
    )
  );
