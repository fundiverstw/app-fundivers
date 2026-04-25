-- Admin-write RLS policies on EO_dives and EO_courses.
--
-- Today only the service role can mutate these tables (per the
-- public_read migration's note). The /admin/new tab needs admins to
-- create dives + courses directly from the SPA, so we add explicit
-- insert/update/delete policies gated on profile.role = 'admin' via the
-- existing public.is_admin() helper from
-- core_rls_and_booking_immutability.sql.
--
-- Junction tables (eo_dive_addons, eo_course_addons) need no policies of
-- their own: they're auto-reconciled by sync_eo_dive_addons /
-- sync_eo_course_addons triggers when other_addons changes on the parent
-- row, so admin writes to EO_dives/EO_courses propagate naturally. RLS is
-- also currently disabled on those tables.
--
-- Idempotent via `drop policy if exists`.

begin;

drop policy if exists "EO_dives: admin insert"   on public."EO_dives";
drop policy if exists "EO_dives: admin update"   on public."EO_dives";
drop policy if exists "EO_dives: admin delete"   on public."EO_dives";
drop policy if exists "EO_courses: admin insert" on public."EO_courses";
drop policy if exists "EO_courses: admin update" on public."EO_courses";
drop policy if exists "EO_courses: admin delete" on public."EO_courses";

create policy "EO_dives: admin insert"
  on public."EO_dives"   for insert to authenticated
  with check (public.is_admin());

create policy "EO_dives: admin update"
  on public."EO_dives"   for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

create policy "EO_dives: admin delete"
  on public."EO_dives"   for delete to authenticated
  using (public.is_admin());

create policy "EO_courses: admin insert"
  on public."EO_courses" for insert to authenticated
  with check (public.is_admin());

create policy "EO_courses: admin update"
  on public."EO_courses" for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

create policy "EO_courses: admin delete"
  on public."EO_courses" for delete to authenticated
  using (public.is_admin());

commit;
