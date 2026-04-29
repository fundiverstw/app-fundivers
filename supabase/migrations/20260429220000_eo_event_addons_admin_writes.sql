-- Admin write + public read policies on the eo_dive_addons /
-- eo_course_addons junction tables.
--
-- 20260425000000_eo_admin_writes.sql assumed the junction tables had
-- RLS disabled and so needed no policies. That's true locally but
-- wrong in cloud: the rls_auto_enable event trigger
-- (20260421130941_remote_schema.sql) turns RLS on at CREATE TABLE
-- time, so the cloud junction tables ended up with RLS on and zero
-- policies. Effects:
--
--   * Admin INSERT/UPDATE on EO_dives or EO_courses fires
--     sync_eo_*_addons (plain plpgsql, runs as the invoker), which
--     INSERTs into the junction and gets 403'd.
--   * src/lib/events.ts reads from the junction with the SPA's
--     anon/authenticated key — RLS silently filters every row out.
--
-- Fix: mirror the EO_dives admin-write pattern, and add a public
-- select policy so addon resolution actually returns rows.
--
-- Also explicitly `enable row level security` on both tables so local
-- and cloud match. In cloud the rls_auto_enable event trigger turned
-- it on at CREATE TABLE; locally that trigger doesn't fire during
-- migration replay, leaving RLS off and the policies unenforced.

begin;

alter table public.eo_dive_addons   enable row level security;
alter table public.eo_course_addons enable row level security;

drop policy if exists "eo_dive_addons: public read"   on public.eo_dive_addons;
drop policy if exists "eo_dive_addons: admin insert"  on public.eo_dive_addons;
drop policy if exists "eo_dive_addons: admin update"  on public.eo_dive_addons;
drop policy if exists "eo_dive_addons: admin delete"  on public.eo_dive_addons;

create policy "eo_dive_addons: public read"
  on public.eo_dive_addons for select to anon, authenticated
  using (true);

create policy "eo_dive_addons: admin insert"
  on public.eo_dive_addons for insert to authenticated
  with check (public.is_admin());

create policy "eo_dive_addons: admin update"
  on public.eo_dive_addons for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

create policy "eo_dive_addons: admin delete"
  on public.eo_dive_addons for delete to authenticated
  using (public.is_admin());

drop policy if exists "eo_course_addons: public read"   on public.eo_course_addons;
drop policy if exists "eo_course_addons: admin insert"  on public.eo_course_addons;
drop policy if exists "eo_course_addons: admin update"  on public.eo_course_addons;
drop policy if exists "eo_course_addons: admin delete"  on public.eo_course_addons;

create policy "eo_course_addons: public read"
  on public.eo_course_addons for select to anon, authenticated
  using (true);

create policy "eo_course_addons: admin insert"
  on public.eo_course_addons for insert to authenticated
  with check (public.is_admin());

create policy "eo_course_addons: admin update"
  on public.eo_course_addons for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

create policy "eo_course_addons: admin delete"
  on public.eo_course_addons for delete to authenticated
  using (public.is_admin());

commit;
