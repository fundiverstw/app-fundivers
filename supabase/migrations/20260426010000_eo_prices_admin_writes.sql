-- Admin-write RLS on EO_prices.
--
-- Mirrors 20260425000000_eo_admin_writes.sql for EO_prices so admins can
-- create new price tiers from the /admin/new sub-form. Today the table is
-- service-role-only for writes (per eo_public_read.sql), so the SPA
-- couldn't insert without this policy.
--
-- Idempotent via `drop policy if exists`.

begin;

drop policy if exists "EO_prices: admin insert" on public."EO_prices";
drop policy if exists "EO_prices: admin update" on public."EO_prices";
drop policy if exists "EO_prices: admin delete" on public."EO_prices";

create policy "EO_prices: admin insert"
  on public."EO_prices" for insert to authenticated
  with check (public.is_admin());

create policy "EO_prices: admin update"
  on public."EO_prices" for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

create policy "EO_prices: admin delete"
  on public."EO_prices" for delete to authenticated
  using (public.is_admin());

commit;
