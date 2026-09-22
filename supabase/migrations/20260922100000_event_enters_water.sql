-- Whether an event's registrants actually go in the water.
--
-- The logistics board calls everyone on a day's roster a diver, because until
-- now every registrant was one. They are not: EFR and CPR students, an O2
-- provider class, a beach BBQ and a shop social all put people on the board
-- who never get wet. The shop's insurer asks exactly this question -- how many
-- of the people you signed up that day were diving -- and the board has no
-- answer to give.
--
-- The kind cannot answer it either. `entersTheWater` in src/lib/event-kinds.ts
-- reads the vocabulary honestly: an adventure travels overland and never
-- dives, a dive dives, and a course *may* -- Open Water goes under, EFR does
-- not, and both are kind='course'. So this is the same shape as has_transport
-- (20260821000000): admin-set per event, because "not strictly a diving
-- course" is a fact the person filling in the event holds and the schema does
-- not.
--
-- Defaults true, so every event that exists keeps counting its registrants as
-- divers and nothing changes on deploy. NOT NULL is deliberate, for the reason
-- has_transport gives: create_events_with_relations builds rows with
-- jsonb_populate_record, where a key the caller omits lands as NULL rather
-- than as the column default, so a payload that forgets this fails loudly at
-- creation instead of quietly writing a NULL nothing branches on.
alter table public.events
  add column enters_water boolean not null default true;

comment on column public.events.enters_water is
  'False when nobody registered for this event goes in the water (EFR/CPR, an equipment class, a BBQ): the logistics board lists them as non-divers rather than divers. Set on the admin event form.';

-- An adventure is the one kind that already answers this, everywhere in the
-- app, via entersTheWater(). Line the column up with it so the two never
-- disagree, and so a shop reading the table directly sees the same answer the
-- app shows.
update public.events set enters_water = false where kind = 'adventure';

-- Courses are deliberately NOT backfilled from their titles. The gear_included
-- backfill (20260911100000) could guess from a title because being wrong cost
-- a wetsuit on a van. Being wrong here means telling an insurer somebody was
-- or was not diving, so the honest default is "diving, until an admin says
-- otherwise" -- which is also what the board shows today.
