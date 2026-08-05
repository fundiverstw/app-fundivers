-- Which staff are paid for the events they work.
--
-- Revenue attribution splits an event's takings evenly among the crew who
-- worked it in an earning capacity -- an instructor on a course, an instructor
-- or guide on anything else. Support never earns. That rule needs one fact the
-- database has never held: whether a given person is compensated at all.
--
-- Without it the denominator is wrong in the one direction that matters.
-- A shop's owner and its volunteer divemasters guide dives alongside paid
-- staff; counting them as equal earners silently dilutes every paid guide's
-- share of every dive they were on, and nothing about the result looks wrong.
--
-- Defaults to false, including for existing admins and staff. A shop that has
-- not said who it pays gets an empty revenue table and a prompt to mark
-- people, which is honest; inferring "admin and staff are paid, divers are
-- not" would invent a compensation policy on the shop's behalf and quietly
-- credit the owner for their own volunteering.
alter table public.profiles
  add column if not exists compensated boolean not null default false;

comment on column public.profiles.compensated is
  'True when this person is paid for duty work. Drives the split denominator '
  'in staff revenue attribution: uncompensated crew keep their duty credit and '
  'still appear on the roster, but take no share of an event''s revenue.';

-- Same guard the other admin-managed columns get. profiles carries a
-- "self update" RLS policy so a diver can maintain their own profile, which
-- means without this a staff member could flag themselves compensated and
-- redirect a share of every event they worked. Low stakes as attacks go, but
-- it is a number the shop pays against.
create or replace function public.block_self_privileged_profile_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.role            is distinct from old.role
     or new.status         is distinct from old.status
     or new.parent_account is distinct from old.parent_account
     or new.compensated    is distinct from old.compensated then
    raise exception
      'role, status, parent_account, and compensated are admin-managed'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
