-- Medium-tier defence-in-depth bundle: M1 + M2 + M3 + M6 + M7.
-- All five fixes touch RLS / triggers on existing tables, so they
-- land together in one forward migration.
--
-- M1 — credits: split staff_or_admin/admin
--   The "credits: staff manage all" policy let staff INSERT/UPDATE/
--   DELETE credits (and self-issue arbitrary amounts to themselves).
--   The original migration's own comment says issuance is admin-only;
--   the policy was too broad. Split: staff_or_admin get SELECT,
--   admin gets INSERT/UPDATE/DELETE.
--
-- M2 — push_subscriptions: tighten the UPDATE policy
--   The existing policy was `for update using (auth.uid() = user_id)`
--   with no `to authenticated`, no `with check`. Two issues:
--   * default-role of `public` exposes anon to the policy.
--   * missing `with check` lets a user UPDATE their own row to set
--     user_id = <victim>, redirecting their device endpoint to receive
--     pushes meant for the victim. Fix the UPDATE; also tighten the
--     SELECT/INSERT/DELETE policies to `to authenticated` for consistency.
--
-- M3 — bookings: parent-insert-for-children needs is_active_user()
--   The diver self-insert policy gates on is_active_user() so a pending
--   diver can't insert bookings until admin approves them. The
--   parent-insert-for-children policy doesn't have the gate, so a
--   pending parent can book their child before being approved.
--
-- M6 — admin_audit_log: trigger-level immutability
--   RLS gives admin SELECT only — no INSERT/UPDATE/DELETE. But the
--   Supabase dashboard SQL editor runs as `postgres` and bypasses RLS,
--   so any admin with dashboard access can rewrite history. Add a
--   BEFORE UPDATE/DELETE trigger that raises unconditionally; the
--   trigger itself runs at default trigger depth so the audit-write
--   trigger (which inserts into this table) is unaffected. Service-role
--   contexts can still `ALTER TABLE … DISABLE TRIGGER` for legitimate
--   redactions, and that act is auditable in pg_stat / log tail.
--
-- M7 — replace inline admin subqueries with is_admin() helper
--   Multiple late migrations reintroduced
--     `exists (select 1 from profiles where role = 'admin')`
--   instead of calling the existing helper. Works today because
--   self-select RLS lets the EXISTS read the caller's own row, but
--   the helper is the canonical pattern (SECURITY DEFINER, no policy
--   recursion). Drops + recreates each affected policy via is_admin().

begin;

-- ============================================================
-- M1 — credits
-- ============================================================

drop policy if exists "credits: staff manage all" on public.credits;

drop policy if exists "credits: staff_or_admin select" on public.credits;
create policy "credits: staff_or_admin select"
  on public.credits for select to authenticated
  using (public.is_staff_or_admin());

drop policy if exists "credits: admin insert" on public.credits;
create policy "credits: admin insert"
  on public.credits for insert to authenticated
  with check (public.is_admin());

drop policy if exists "credits: admin update" on public.credits;
create policy "credits: admin update"
  on public.credits for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

drop policy if exists "credits: admin delete" on public.credits;
create policy "credits: admin delete"
  on public.credits for delete to authenticated
  using (public.is_admin());

-- ============================================================
-- M2 — push_subscriptions
-- ============================================================

drop policy if exists "user reads own push sub" on public.push_subscriptions;
drop policy if exists "user reads own push subs" on public.push_subscriptions;
create policy "push_subs: user reads own"
  on public.push_subscriptions for select to authenticated
  using (auth.uid() = user_id);

-- Note: the "user inserts own push sub" policy is owned by
-- 20260501100000_profile_status.sql (which adds the is_active_user()
-- gate). We leave it untouched.

drop policy if exists "user updates own push sub" on public.push_subscriptions;
create policy "push_subs: user updates own"
  on public.push_subscriptions for update to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user deletes own push sub" on public.push_subscriptions;
create policy "push_subs: user deletes own"
  on public.push_subscriptions for delete to authenticated
  using (auth.uid() = user_id);

-- ============================================================
-- M3 — bookings: parent insert + active-user gate
-- ============================================================

drop policy if exists "bookings: parent insert for children" on public.bookings;
create policy "bookings: parent insert for children"
  on public.bookings for insert to authenticated
  with check (
    public.is_active_user()
    and exists (
      select 1 from public.profiles p
      where p.id = bookings.user_id and p.parent_account = auth.uid()
    )
  );

-- ============================================================
-- M6 — admin_audit_log immutability trigger
-- ============================================================

create or replace function public.audit_log_no_mutations()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'admin_audit_log rows are immutable'
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists admin_audit_log_block_update on public.admin_audit_log;
create trigger admin_audit_log_block_update
  before update on public.admin_audit_log
  for each row execute function public.audit_log_no_mutations();

drop trigger if exists admin_audit_log_block_delete on public.admin_audit_log;
create trigger admin_audit_log_block_delete
  before delete on public.admin_audit_log
  for each row execute function public.audit_log_no_mutations();

-- ============================================================
-- M7 — replace inline admin subqueries with is_admin() helper
-- ============================================================

-- duties (4 policies, all from 20260423000000_duties.sql)
drop policy if exists "duties: admin select" on public.duties;
create policy "duties: admin select"
  on public.duties for select to authenticated
  using (public.is_admin());

drop policy if exists "duties: admin insert" on public.duties;
create policy "duties: admin insert"
  on public.duties for insert to authenticated
  with check (public.is_admin());

drop policy if exists "duties: admin update" on public.duties;
create policy "duties: admin update"
  on public.duties for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

drop policy if exists "duties: admin delete" on public.duties;
create policy "duties: admin delete"
  on public.duties for delete to authenticated
  using (public.is_admin());

-- admin_notes update/delete (the select/insert were already migrated to
-- is_staff_or_admin() in 20260429240000_staff_role.sql)
drop policy if exists "admin_notes: admin update" on public.admin_notes;
create policy "admin_notes: admin update"
  on public.admin_notes for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin_notes: admin delete" on public.admin_notes;
create policy "admin_notes: admin delete"
  on public.admin_notes for delete to authenticated
  using (public.is_admin());

-- storage.objects — three buckets, 4 policies each (read/insert/update/delete)
do $$
declare
  bucket text;
begin
  foreach bucket in array array['cert-cards', 'nitrox-cards', 'deep-cards'] loop
    execute format('drop policy if exists %I on storage.objects', bucket || ': admin read');
    execute format(
      'create policy %I on storage.objects for select to authenticated using (bucket_id = %L and public.is_admin())',
      bucket || ': admin read', bucket
    );
    execute format('drop policy if exists %I on storage.objects', bucket || ': admin insert');
    execute format(
      'create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L and public.is_admin())',
      bucket || ': admin insert', bucket
    );
    execute format('drop policy if exists %I on storage.objects', bucket || ': admin update');
    execute format(
      'create policy %I on storage.objects for update to authenticated using (bucket_id = %L and public.is_admin()) with check (bucket_id = %L and public.is_admin())',
      bucket || ': admin update', bucket, bucket
    );
    execute format('drop policy if exists %I on storage.objects', bucket || ': admin delete');
    execute format(
      'create policy %I on storage.objects for delete to authenticated using (bucket_id = %L and public.is_admin())',
      bucket || ': admin delete', bucket
    );
  end loop;
end $$;

commit;
