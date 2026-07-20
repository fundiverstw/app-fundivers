-- Add 'adventure' to the event vocabulary.
--
-- A general-purpose event for single or multi-day trips that aren't diving —
-- camping being the first use. It shares the dive's temporal shape: a
-- start_date/end_date envelope, not the course's course_days list.
--
-- Three separate vocabularies enumerate event kinds, and all three have to
-- learn the new value or the feature half-works:
--
--   1. events.kind                     — the canonical set.
--   2. push_notifications_sent.event_type
--        No FK to events (event_id there is text, not uuid) and it is part of
--        the composite PK, so a reminder for an adventure would be rejected at
--        insert and the push worker would retry it forever.
--   3. waivers.applies_to
--        Scopes a waiver to a kind. Without 'adventures', an adventure matches
--        only waivers scoped to 'all', so the shop cannot require a waiver of
--        adventures specifically.
--
-- events_course_has_days and events_dive_has_start are both written as
-- `kind <> 'x' OR …`, so they already pass for a new kind and are left alone.
-- The new shape rule below is their analogue for adventures.

alter table public.events
  drop constraint if exists events_kind_check;

alter table public.events
  add constraint events_kind_check
  check (kind = any (array['dive'::text, 'course'::text, 'adventure'::text]));

-- Adventures carry an envelope, same as dives: a start is mandatory, an end is
-- optional (a single-day adventure just has no end_date).
alter table public.events
  drop constraint if exists events_adventure_has_start;

alter table public.events
  add constraint events_adventure_has_start
  check ((kind <> 'adventure') or (start_date is not null));

alter table public.push_notifications_sent
  drop constraint if exists push_notifications_sent_event_type_check;

alter table public.push_notifications_sent
  add constraint push_notifications_sent_event_type_check
  check (event_type = any (array['dive'::text, 'course'::text, 'adventure'::text]));

alter table public.waivers
  drop constraint if exists waivers_applies_to_check;

alter table public.waivers
  add constraint waivers_applies_to_check
  check (applies_to = any (array['dives'::text, 'courses'::text, 'adventures'::text, 'all'::text, 'none'::text]));
