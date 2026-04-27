-- Admin write policies on EO_rooms and Other_Addons.
--
-- Public select policies on these two tables already exist
-- (20260423120000_eo_public_read.sql) so the wix-site iframe can read room
-- prices and add-on labels via the anon key. Admin writes were missing —
-- the new /admin/rooms and /admin/addons manage pages need them.
--
-- Mirrors the DiveTravel admin policies added in
-- 20260429000000_dive_travel_and_cancellation_policies.sql line-for-line.

begin;

drop policy if exists "EO_rooms: admin insert" on public."EO_rooms";
drop policy if exists "EO_rooms: admin update" on public."EO_rooms";
drop policy if exists "EO_rooms: admin delete" on public."EO_rooms";

create policy "EO_rooms: admin insert"
  on public."EO_rooms" for insert to authenticated
  with check (public.is_admin());
create policy "EO_rooms: admin update"
  on public."EO_rooms" for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());
create policy "EO_rooms: admin delete"
  on public."EO_rooms" for delete to authenticated
  using (public.is_admin());

drop policy if exists "Other_Addons: admin insert" on public."Other_Addons";
drop policy if exists "Other_Addons: admin update" on public."Other_Addons";
drop policy if exists "Other_Addons: admin delete" on public."Other_Addons";

create policy "Other_Addons: admin insert"
  on public."Other_Addons" for insert to authenticated
  with check (public.is_admin());
create policy "Other_Addons: admin update"
  on public."Other_Addons" for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());
create policy "Other_Addons: admin delete"
  on public."Other_Addons" for delete to authenticated
  using (public.is_admin());

commit;
