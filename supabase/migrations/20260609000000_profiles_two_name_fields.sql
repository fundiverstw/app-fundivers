-- Collapse the profile name model to two fields:
--   name     — the diver's legal name, exactly as it appears on their
--              passport / ID (form names must match IDs exactly).
--   nickname — informal: an English name, an alias, whatever they go by.
--
-- Replaces the old three-field split (full_name / display_name / name_alt).
-- The legal name is now the single authoritative field; since it holds the
-- name in whatever script the ID uses, the separate "name in another script"
-- field (name_alt) is redundant and is dropped.

begin;

alter table public.profiles rename column full_name to name;
alter table public.profiles rename column display_name to nickname;
alter table public.profiles drop column name_alt;

-- The "application complete" trigger gated on full_name AND display_name.
-- Nickname is now optional, so completeness requires only the legal name.
-- Recreated because a column rename does not rewrite a function body.
create or replace function public.maybe_set_application_submitted_at() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.application_submitted_at is null
     and new.name           is not null and length(btrim(new.name))         > 0
     and new.date_of_birth   is not null
     and new.cert_level      is not null and length(btrim(new.cert_level))   > 0
     and new.contact_method  is not null
     and new.contact_id      is not null and length(btrim(new.contact_id))   > 0
  then
    new.application_submitted_at := now();
  end if;
  return new;
end;
$$;

commit;
