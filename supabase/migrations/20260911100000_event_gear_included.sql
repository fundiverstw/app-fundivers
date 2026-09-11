-- Whether an event offers gear is an admin's decision, not a guess about its title.
--
-- The question "does this event put a gear question on the registration form?"
-- was answered two different inferred ways, neither of them visible to the
-- person running the shop.
--
-- On a dive it was the presence of the free-text gear_rental blurb: type
-- anything into that box and the form grew a rental checklist, leave it empty
-- and the question vanished. A description doubling as a switch means an admin
-- cannot describe the rental terms of an event whose gear is bundled, and
-- cannot offer gear without writing prose about it.
--
-- On a course it was a substring match on the customer-facing title --
-- isGearIncludedCourse() looked for 'open water', 'dsd', 'try dive', 'efr' --
-- so a shop that renamed its Discover Scuba course started billing students
-- for gear their fee already covers, and 'Advanced Open Water' escaped that
-- only because the matcher excluded the word 'advanced' by hand. Every shop
-- forking this app inherits FunDivers' course names as load-bearing strings.
--
-- This column is the sentence an admin actually wants to write: this event
-- includes gear (or needs none), so do not offer it and do not bill for it.
-- The title rule survives only as a SUGGESTION that pre-ticks the box on the
-- event form and can be overruled -- see suggestsGearIncluded() in
-- src/lib/gear.ts. Nothing at registration, pricing or PDF time reads a title.
ALTER TABLE "public"."events"
  ADD COLUMN IF NOT EXISTS "gear_included" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."events"."gear_included" IS
  'True: the registration form puts no gear question and no gear reaches the price, because the fee covers a set or the event needs none. False: gear is rented a-la-carte.';

-- Backfill the courses the old title rule already treated as gear-included, so
-- no live course changes behavior on deploy.
UPDATE "public"."events" e
   SET "gear_included" = true
 WHERE e."kind" = 'course'
   AND (
        (lower(coalesce(e."display_title", e."admin_title", '')) LIKE '%open water%'
          AND lower(coalesce(e."display_title", e."admin_title", '')) NOT LIKE '%advanced%')
     OR lower(coalesce(e."display_title", e."admin_title", '')) LIKE '%discover scuba%'
     OR lower(coalesce(e."display_title", e."admin_title", '')) LIKE '%try dive%'
     OR lower(coalesce(e."display_title", e."admin_title", '')) LIKE '%emergency first response%'
     OR lower(coalesce(e."display_title", e."admin_title", '')) ~ '\mdsd\M'
     OR lower(coalesce(e."display_title", e."admin_title", '')) ~ '\mefr\M'
   );

-- Every other kind is left at false on purpose, which is NOT what the old code
-- did: a dive with an empty gear_rental blurb used to put no gear question.
--
-- Carrying that forward would have written the wrong sentence into the data.
-- "The admin never typed rental terms" is not evidence that the fee covers a
-- set, and an event flagged gear-included says exactly that to the diver
-- ("Gear is included -- no need to rent") and to the logistics board, which
-- then packs a full set per registrant. Backfilling it would have put a
-- wetsuit on the van for every diver on every blurb-less dive.
--
-- So those dives now offer the gear question, which is the honest default for
-- a shop that rents gear, and an admin ticks the box on the ones that should
-- not. The flag means what it says from here on.
