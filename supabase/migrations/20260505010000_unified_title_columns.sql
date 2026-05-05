-- Unify title-style columns across the catalog/event tables. Three
-- semantic slots, same names everywhere:
--
--   admin_title    — internal label admins see when managing
--   display_title  — public/diver-facing label
--   calendar_title — what the calendar widget renders (events only)
--
-- Pure renames -- no live trigger / policy / view references any of the
-- old column names directly (verified at the time of writing), so PG
-- cascades through indexes / FKs / dependent columns automatically.
--
-- After this migration the SPA reads with the priority
-- `display_title -> admin_title -> default` on public surfaces, which
-- preserves current behaviour: legacy EO_dives data ends up in
-- admin_title (and falls through), legacy EO_courses public title ends
-- up in display_title (primary).

begin;

alter table public."EO_dives"   rename column "dive_title"   to "admin_title";
alter table public."EO_dives"   rename column "title"        to "display_title";

alter table public."EO_courses" rename column "title"        to "calendar_title";
alter table public."EO_courses" rename column "course_title" to "display_title";

alter table public."Other_Addons" rename column "title"        to "admin_title";
alter table public."Other_Addons" rename column "display_name" to "display_title";

alter table public."EO_rooms" rename column "title"        to "admin_title";
alter table public."EO_rooms" rename column "display_name" to "display_title";

alter table public."DiveTravel"         rename column "title" to "admin_title";
alter table public."EO_prices"          rename column "title" to "admin_title";
alter table public."TravelDestinations" rename column "title" to "admin_title";

commit;
