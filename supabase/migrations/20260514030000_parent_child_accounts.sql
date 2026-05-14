-- Parent-child diver accounts.
--
-- Some divers (parents, guardians, group organizers) manage one or more
-- additional diver accounts on behalf of family members or guests. We model
-- this as a self-referential FK on profiles: parent_account → profiles.id.
-- null = a regular standalone account.
--
-- Hierarchy is one-level deep: a parent cannot itself be a child, and a
-- child cannot have children. Enforced via a BEFORE INSERT/UPDATE trigger
-- (a check constraint can't reference other rows).
--
-- bookings.group_id ties together multiple bookings the parent submits in
-- one "group registration" so the payments / admin views can roll them up.
-- Phase A (this migration) just adds the column + indexes + RLS; the form
-- changes that actually populate group_id arrive in a later migration.
--
-- RLS additions let a parent SELECT/INSERT/UPDATE their children's
-- profiles, bookings, and payments. Children can still log in directly and
-- manage themselves — parent access is additive.

begin;

-- ============================================================
-- 1. Schema
-- ============================================================

alter table public.profiles
  add column if not exists parent_account uuid
    references public.profiles(id) on delete set null;

alter table public.profiles
  add constraint profiles_no_self_parent
    check (parent_account is null or parent_account <> id) not valid;

create index if not exists profiles_parent_account_idx
  on public.profiles (parent_account)
  where parent_account is not null;

alter table public.bookings
  add column if not exists group_id uuid;

create index if not exists bookings_group_id_idx
  on public.bookings (group_id)
  where group_id is not null;

-- ============================================================
-- 2. Enforce one-level family trees
-- ============================================================
-- Two rules, both enforced here because a CHECK can't peek at other rows:
--   (a) The would-be parent must itself have parent_account = null
--       (no grandchildren).
--   (b) A diver with their own children cannot acquire a parent
--       (can't demote a parent into a child).

create or replace function public.profiles_enforce_one_level_family()
returns trigger language plpgsql as $$
declare
  v_grandparent uuid;
begin
  if new.parent_account is not null then
    select parent_account into v_grandparent
    from public.profiles where id = new.parent_account;
    if v_grandparent is not null then
      raise exception 'parent_account must itself be a top-level diver (one-level family trees only)'
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.profiles where parent_account = new.id) then
      raise exception 'cannot set parent_account on a diver who already has their own children'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_one_level_family on public.profiles;
create trigger trg_profiles_one_level_family
  before insert or update of parent_account on public.profiles
  for each row execute function public.profiles_enforce_one_level_family();

-- ============================================================
-- 3. RLS additions
-- ============================================================
-- Parents can see + edit their children. Children can still see + edit
-- themselves (existing self policies are unchanged). Staff/admin keep
-- their existing wide read/write access.

-- profiles: parent select + update children
drop policy if exists "profiles: parent select children" on public.profiles;
create policy "profiles: parent select children"
  on public.profiles for select to authenticated
  using (parent_account = auth.uid());

drop policy if exists "profiles: parent update children" on public.profiles;
create policy "profiles: parent update children"
  on public.profiles for update to authenticated
  using     (parent_account = auth.uid())
  with check (parent_account = auth.uid());

-- bookings: parent select / insert / update children's bookings
drop policy if exists "bookings: parent select children" on public.bookings;
create policy "bookings: parent select children"
  on public.bookings for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = bookings.user_id and p.parent_account = auth.uid()
    )
  );

drop policy if exists "bookings: parent insert for children" on public.bookings;
create policy "bookings: parent insert for children"
  on public.bookings for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = bookings.user_id and p.parent_account = auth.uid()
    )
  );

drop policy if exists "bookings: parent update children" on public.bookings;
create policy "bookings: parent update children"
  on public.bookings for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = bookings.user_id and p.parent_account = auth.uid()
    )
  );

-- payments: parent select children's payments
drop policy if exists "payments: parent select children" on public.payments;
create policy "payments: parent select children"
  on public.payments for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = payments.user_id and p.parent_account = auth.uid()
    )
  );

commit;
