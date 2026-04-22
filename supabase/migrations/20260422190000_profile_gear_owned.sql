-- Persist the list of gear items a diver already owns on their profile so the
-- register-form's a-la-carte checklist can prefill with only the items they
-- still need to rent. Matches the `gearOwned` concept from the Wix form.

alter table public.profiles
  add column gear_owned text[] not null default '{}';
