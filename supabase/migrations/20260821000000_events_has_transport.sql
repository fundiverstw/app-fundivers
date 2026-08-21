-- Whether the shop drives anybody to this event at all.
--
-- Every event is asked the ride question today, and for good reason:
-- event_vehicles accepts any event and the ride tally matches a course's days
-- as readily as a dive's date envelope, so the shop really does drive Open
-- Water students out to their shore days. But a dry course moves nobody. EFR,
-- an Equipment specialty and an O2 provider course all happen at the shop, and
-- "do you need a ride to the site?" put to a diver registering for one is a
-- question with no right answer.
--
-- Admin-set per event rather than inferred from the kind or the title. "Not
-- strictly a diving course" is not a fact the schema holds; the person filling
-- in the event is the one who knows, and the last helper that guessed this
-- from the kind was wrong in both directions.
--
-- Defaults true, so every event that exists keeps asking. NOT NULL is
-- deliberate: create_events_with_relations builds rows with
-- jsonb_populate_record, where a key the caller omits lands as NULL rather
-- than as the column default, so a payload that forgets this fails loudly at
-- creation instead of quietly writing a NULL nothing branches on.
alter table public.events
  add column has_transport boolean not null default true;

comment on column public.events.has_transport is
  'False when the shop provides no transport for this event (a dry course held at the shop): the registration form puts no ride question and the event takes no cars. Set in the vehicle section of the admin event form.';
