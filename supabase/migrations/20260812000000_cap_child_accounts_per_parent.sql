-- Cap how many child accounts one diver may create.
--
-- create-child-account lets any active diver mint an auth user for an arbitrary
-- email address, with no ceiling. Two consequences:
--
--   * Amplification — each call sends shop-branded mail to an address the
--     caller chose. Unbounded, that is a spam cannon pointed through the shop's
--     SMTP reputation, and it burns the daily send quota that waitlist offers
--     and booking confirmations depend on.
--   * Squatting — the created account owns that email address. The person who
--     actually owns it can no longer sign up, and the account is permanently
--     parented to whoever created it, which grants that stranger RLS read on
--     the profile and its bookings.
--
-- A ceiling does not eliminate squatting (see the note below), but it bounds
-- the blast radius of one account from "the whole address book" to a handful,
-- and it makes an abusive pattern visible in the audit log rather than silent.
--
-- Enforced here rather than only in the edge function because the function is
-- today's only path, not a guarantee. Same belt-and-braces reasoning as
-- trg_profiles_one_level_family, which this mirrors: the trigger is the source
-- of truth, the function pre-check exists to produce a friendlier message.
--
-- Deliberately NOT capped for admins: the shop legitimately mints many walk-in
-- accounts through admin-create-diver, which is a different, role-gated path.

-- Ten covers a family, a dive club leader signing up their group, and then
-- some. It is a sanity bound, not a business rule -- raise it if a real shop
-- hits it.
create or replace function public.enforce_child_account_cap()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  v_cap   constant integer := 10;
  v_count integer;
begin
  -- Only when a parent link is being established or moved. Updates that leave
  -- parent_account untouched must not pay for this count.
  if new.parent_account is null
     or (tg_op = 'UPDATE' and old.parent_account is not distinct from new.parent_account) then
    return new;
  end if;

  -- The parent's own role decides the ceiling, not the caller's: an admin
  -- assigning a child to a diver is still adding to that diver's tree.
  if exists (select 1 from public.profiles
              where id = new.parent_account and role in ('admin', 'staff')) then
    return new;
  end if;

  select count(*) into v_count
    from public.profiles
   where parent_account = new.parent_account
     and id <> new.id;

  if v_count >= v_cap then
    raise exception 'this account already manages % child accounts, which is the maximum', v_cap
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

alter function public.enforce_child_account_cap() owner to postgres;

comment on function public.enforce_child_account_cap() is
  'Bounds how many child accounts one diver may manage. Paired with a friendlier pre-check in the create-child-account edge function.';

drop trigger if exists trg_profiles_child_account_cap on public.profiles;
create trigger trg_profiles_child_account_cap
  before insert or update of parent_account on public.profiles
  for each row execute function public.enforce_child_account_cap();

-- Residual risk, recorded so it is a decision rather than an oversight: a diver
-- can still claim up to `v_cap` email addresses that are not theirs. Removing
-- that entirely means not creating the auth user under the child's real
-- address at all -- minting the login under a synthetic one and keeping the
-- real address purely as a contact -- which needs a profiles column split and
-- touches every surface that shows a diver's email. Out of scope here.
