-- events.enters_water → events.involves_scuba.
--
-- "Non-diver" in this app means "not scuba diving", nothing wider: a
-- snorkeler or a swimmer may well go in the water and is still a non-diver,
-- and the split the shop's insurer asks for is scuba divers vs everyone else.
-- The old name said "nobody gets wet", which is not what false ever meant.
--
-- A rename only: same type, same NOT NULL, same default, same values. No SQL
-- function reads the column by name — create_events_with_relations takes it
-- through jsonb_populate_record(null::public.events, ...), which follows the
-- table's own columns — so nothing else needs recreating.
alter table public.events rename column enters_water to involves_scuba;

comment on column public.events.involves_scuba is
  'False when nobody registered for this event scuba dives (EFR/CPR, an equipment class, a BBQ, a snorkel trip): the logistics board lists them as non-divers rather than divers. False means "no scuba", not "nobody gets wet". Set on the admin event form.';
