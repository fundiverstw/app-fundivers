-- Mirror the login email onto profiles so the admin Users page can show
-- it without a service-role round-trip. The email of record still lives in
-- auth.users; profiles.email is a read-only copy kept in sync by triggers,
-- so it can't drift or be spoofed via a profile edit.
--
-- Three moving parts:
--   1. handle_new_user (signup trigger) copies new.email on account
--      creation, alongside the terms-consent columns it already sets.
--   2. profiles_email_mirror_auth coerces profiles.email back to the
--      authoritative auth.users value on every UPDATE — the self-update
--      and admin-update RLS policies otherwise let a caller PATCH any
--      column, and email must not be hand-editable.
--   3. sync_profile_email propagates a future auth.users email change
--      down to the cached copy (the app has no email-change flow today;
--      this covers Studio / dashboard edits).
--
-- profiles.email inherits the existing profiles SELECT policies (self,
-- staff/admin, parent-of-child) — exactly the audiences already trusted
-- with the rest of a diver's PII.

begin;

alter table public.profiles add column email text;

update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  consented  bool := new.raw_user_meta_data ? 'agreed_to_terms_at';
  client_ver int  := nullif(new.raw_user_meta_data ->> 'agreed_to_terms_version', '')::int;
begin
  insert into public.profiles (id, email, agreed_to_terms_at, agreed_to_terms_version)
  values (
    new.id,
    new.email,
    case when consented then now() else null end,
    case when consented then coalesce(client_ver, 1) else null end
  );
  return new;
end;
$$;

create or replace function public.profiles_email_mirror_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.email := (select email from auth.users where id = new.id);
  return new;
end;
$$;

drop trigger if exists profiles_email_mirror_auth_trg on public.profiles;
create trigger profiles_email_mirror_auth_trg
  before update on public.profiles
  for each row execute function public.profiles_email_mirror_auth();

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function public.sync_profile_email();

commit;
