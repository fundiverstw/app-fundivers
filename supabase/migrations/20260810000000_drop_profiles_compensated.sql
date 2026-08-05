-- Drop profiles.compensated: who gets paid is inferred, not recorded.
--
-- Added a day earlier so revenue attribution could leave volunteers out of the
-- split denominator. The shop's answer is simpler: everyone rostered in an
-- earning role -- instructor on a course, instructor or guide on anything else
-- -- shares that event, and the shop applies its own knowledge of who it
-- actually pays when reading the report. A flag nobody maintains is worse than
-- no flag: it starts false for every existing profile, and a report that
-- silently attributes nothing is indistinguishable from a report with nothing
-- to attribute.
--
-- No data is lost. The column shipped defaulting to false and nothing ever set
-- it, so every row still holds the default.
alter table public.profiles
  drop column if exists compensated;

-- Restore the guard to the set of columns that still exist. Dropping the
-- column already makes the `new.compensated` reference unresolvable, and a
-- plpgsql function only fails when it runs -- which would be on the next
-- profile update by a non-admin, i.e. any diver editing their own profile.
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
     or new.parent_account is distinct from old.parent_account then
    raise exception
      'role, status, and parent_account are admin-managed'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
