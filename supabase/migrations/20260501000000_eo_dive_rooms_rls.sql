-- RLS for the eo_dive_rooms junction. Mirrors the eo_dive_addons /
-- eo_course_addons policies from 20260429220000_eo_event_addons_admin_writes.sql:
--
--   * public select  — anon + authenticated need to read which rooms
--                       are offered for a given dive (the registration
--                       form's room dropdown).
--   * admin writes   — direct mutation requires an admin profile, but
--                       the trigger keeps the junction in sync so this
--                       is mostly defense in depth.
--
-- Earlier I assumed RLS would stay disabled on eo_dive_rooms (the
-- migration didn't enable it explicitly), but supabase enabled it
-- during the schema pull, and without policies the anon role got
-- empty results — surfacing as missing room options on the diver
-- registration form.

begin;

alter table public.eo_dive_rooms enable row level security;

drop policy if exists "eo_dive_rooms: public read"   on public.eo_dive_rooms;
drop policy if exists "eo_dive_rooms: admin insert"  on public.eo_dive_rooms;
drop policy if exists "eo_dive_rooms: admin update"  on public.eo_dive_rooms;
drop policy if exists "eo_dive_rooms: admin delete"  on public.eo_dive_rooms;

create policy "eo_dive_rooms: public read"
  on public.eo_dive_rooms for select to anon, authenticated
  using (true);

create policy "eo_dive_rooms: admin insert"
  on public.eo_dive_rooms for insert to authenticated
  with check (public.is_admin());

create policy "eo_dive_rooms: admin update"
  on public.eo_dive_rooms for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

create policy "eo_dive_rooms: admin delete"
  on public.eo_dive_rooms for delete to authenticated
  using (public.is_admin());

notify pgrst, 'reload schema';

commit;
