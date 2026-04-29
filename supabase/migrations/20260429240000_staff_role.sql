-- Introduce a third profile role: 'staff'. Staff users sit between
-- 'diver' and 'admin' — they can see backend event details (attendees,
-- gear map, memos) and their own duty assignments, but cannot mutate
-- any catalog or booking data.
--
-- Mechanics:
--   1. Widen profiles_role_check.
--   2. Add public.is_staff_or_admin() helper, mirroring is_admin().
--   3. Broaden the duties assignee trigger so staff can be assigned.
--   4. Add a staff-scoped SELECT on duties so a staff user sees their
--      own duties; admin SELECT (full visibility) is unchanged.
--   5. Broaden the read-side policies on profiles, bookings, payments
--      from admin-only to staff_or_admin. Writes stay admin-only.
--   6. Reshape admin_notes policies: read and insert open to staff +
--      admin (insert requires created_by = auth.uid() so staff can
--      only attribute notes to themselves); update + delete stay
--      admin-only.
--
-- Role promotion is intentionally NOT given a UI surface — the only
-- way a 'diver' becomes 'staff' or 'admin' is via the Supabase
-- dashboard / SQL editor with the service role.

begin;

-- 1. Widen the role check.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('diver','admin','staff'));

-- 2. Helper. SECURITY DEFINER for the same reason is_admin() uses it
-- (breaks the profiles-policy-recurses-into-profiles cycle).
create or replace function public.is_staff_or_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin','staff')
  )
$$;
grant execute on function public.is_staff_or_admin() to anon, authenticated;

-- 3. Broaden the duties assignee trigger to also accept staff.
create or replace function public.duties_enforce_assignee_is_admin() returns trigger
  language plpgsql as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = new.assignee_id and role in ('admin','staff')
  ) then
    raise exception 'duties.assignee_id must reference a profile with role in (admin, staff) (got %)', new.assignee_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- 4. duties: staff can see their own assignments. Admin select policy
-- (full visibility) is left in place untouched. Writes stay admin-only.
drop policy if exists "duties: staff select own" on public.duties;
create policy "duties: staff select own"
  on public.duties for select to authenticated
  using (assignee_id = auth.uid());

-- 5. Broaden read-side policies on profiles / bookings / payments.
--    Admin-only write policies are untouched.
drop policy if exists "profiles: admin select"        on public.profiles;
drop policy if exists "profiles: staff_or_admin select" on public.profiles;
create policy "profiles: staff_or_admin select"
  on public.profiles for select to authenticated
  using (public.is_staff_or_admin());

drop policy if exists "bookings: admin select"        on public.bookings;
drop policy if exists "bookings: staff_or_admin select" on public.bookings;
create policy "bookings: staff_or_admin select"
  on public.bookings for select to authenticated
  using (public.is_staff_or_admin());

drop policy if exists "payments: admin select"        on public.payments;
drop policy if exists "payments: staff_or_admin select" on public.payments;
create policy "payments: staff_or_admin select"
  on public.payments for select to authenticated
  using (public.is_staff_or_admin());

-- 6. admin_notes: staff get read + insert (own attribution only).
--    Update/delete stay admin-only — the original admin-update / admin-delete
--    policies already exist and aren't touched here.
drop policy if exists "admin_notes: admin select"       on public.admin_notes;
drop policy if exists "admin_notes: staff_or_admin select" on public.admin_notes;
create policy "admin_notes: staff_or_admin select"
  on public.admin_notes for select to authenticated
  using (public.is_staff_or_admin());

drop policy if exists "admin_notes: admin insert"       on public.admin_notes;
drop policy if exists "admin_notes: staff_or_admin insert" on public.admin_notes;
create policy "admin_notes: staff_or_admin insert"
  on public.admin_notes for insert to authenticated
  with check (
    public.is_staff_or_admin()
    and created_by = auth.uid()
  );

commit;
