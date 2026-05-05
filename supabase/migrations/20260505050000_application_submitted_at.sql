-- profiles.application_submitted_at — distinguishes "diver has signed up
-- but not yet entered any details" from "diver has filled in the required
-- fields and is ready for admin review".
--
-- Why this exists: AdminApplicationsPage shows every status='pending'
-- profile, which previously included rows that auth.users created the
-- second the diver hit "Sign up" — before they typed a single field.
-- Admins ended up with a queue of empty rows. We now stamp this column
-- the first time the row transitions to "all required fields filled",
-- and the admin page filters to that.
--
-- The seven required fields mirror the zod schema in src/pages/ProfilePage.tsx
-- and PendingPage's `isProfileComplete` check.

begin;

alter table public.profiles
  add column application_submitted_at timestamptz;

-- Backfill: any profile that already has its required fields filled (or
-- whose status is no longer pending) has effectively been submitted —
-- stamp `now()` so admins don't see them disappear from history. Status
-- is the source of truth for "already reviewed", so active/rejected
-- always counts as submitted.
update public.profiles
set application_submitted_at = now()
where status <> 'pending'
   or (
     full_name        is not null and length(btrim(full_name))      > 0
     and display_name is not null and length(btrim(display_name))   > 0
     and date_of_birth is not null
     and cert_level    is not null and length(btrim(cert_level))    > 0
     and contact_method is not null
     and contact_id    is not null and length(btrim(contact_id))    > 0
   );

create index profiles_pending_submitted_idx
  on public.profiles (application_submitted_at desc)
  where status = 'pending' and application_submitted_at is not null;

-- Trigger: set application_submitted_at the first time the row hits the
-- "complete" state. Never unsets — once an admin has been notified, the
-- diver's later edits don't revoke that.
create or replace function public.maybe_set_application_submitted_at() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.application_submitted_at is null
     and new.full_name        is not null and length(btrim(new.full_name))      > 0
     and new.display_name     is not null and length(btrim(new.display_name))   > 0
     and new.date_of_birth    is not null
     and new.cert_level       is not null and length(btrim(new.cert_level))     > 0
     and new.contact_method   is not null
     and new.contact_id       is not null and length(btrim(new.contact_id))     > 0
  then
    new.application_submitted_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_maybe_set_submitted_at_trg on public.profiles;
create trigger profiles_maybe_set_submitted_at_trg
  before update on public.profiles
  for each row execute function public.maybe_set_application_submitted_at();

commit;
