-- Drop events.starting_at: superseded by the prices FK, and dead in code.
--
-- It is a Wix-era "from NT$X" figure held directly on the event. Pricing now
-- goes through events.price -> prices, and prices has its OWN starting_at, which
-- is the one every reference in the codebase means: the ten-odd hits for
-- `starting_at` across the app and the edge functions are all the prices column
-- (EventForm's price sub-form, AdminPricesPage, create-registration's charge
-- calculation). Nothing reads or writes events.starting_at -- it is absent from
-- FormState, from eventPayloadFromForm, and from formStateFromEvent, so an admin
-- editing an event today silently leaves whatever value is there untouched and
-- invisible.
--
-- Nothing in the schema depends on it either: no index, view, trigger,
-- constraint or foreign key names it.

alter table public.events drop column if exists starting_at;
