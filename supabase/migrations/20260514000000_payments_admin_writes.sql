-- Admin write policies for public.payments.
--
-- 20260423130000_core_rls_and_booking_immutability.sql dropped the original
-- "Staff can manage payments" FOR ALL policy and only re-created SELECT
-- policies, with a note: "If an admin payments UI ships later, that
-- migration adds its own insert/update policies." That UI now exists on
-- AdminEventDetailPage (the deposit / partial-payment buttons), so wire up
-- the missing writes here. Inserts and updates only — payments rows are
-- never deleted; corrections are made by inserting a refund row.

drop policy if exists "payments: admin insert" on public.payments;
drop policy if exists "payments: admin update" on public.payments;

create policy "payments: admin insert"
  on public.payments for insert to authenticated
  with check (public.is_admin());

create policy "payments: admin update"
  on public.payments for update to authenticated
  using     (public.is_admin())
  with check (public.is_admin());
