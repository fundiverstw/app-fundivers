-- New divers don't hold a certification, but the profile previously forced a
-- cert_level (and a cert-card photo) on everyone, leaving the uncertified with
-- no way to complete their profile. The profile form now makes the diver pick
-- explicitly: "I have a certification" (cert_level + card required) or "I am
-- uncertified". We persist that choice so it survives reloads AND so the
-- pending-review completeness check can treat an uncertified diver as done
-- (cert_level is legitimately null for them, which is otherwise
-- indistinguishable from "not filled in yet").
--
-- Default false: every existing profile carries a cert_level, i.e. is
-- certified, so the backfill is implicit and correct.

begin;

alter table public.profiles
  add column uncertified boolean not null default false;

commit;
