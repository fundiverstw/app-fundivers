-- Converge (3/7): drop the split legacy catalog. events (kind='dive'|'course')
-- + the event_* junctions now carry everything EO_dives/EO_courses and the
-- eo_* junctions held. Dropping the tables also drops their triggers
-- (sync_eo_*_trg, trg_eo_*_normalize_title) and their FKs into the reference
-- tables, clearing the way to rename/retype those next. The sync_eo_* trigger
-- functions are superseded by set_event_relations, so drop them too.
--
-- Compatibility VIEWS named EO_dives / EO_courses / eo_* are recreated over the
-- unified tables in the final migration, so external readers keep working.

begin;

drop table if exists public.eo_dive_addons;
drop table if exists public.eo_course_addons;
drop table if exists public.eo_dive_rooms;
drop table if exists public.eo_dive_destinations;

drop table if exists public."EO_dives" cascade;
drop table if exists public."EO_courses" cascade;

drop function if exists public.sync_eo_dive_addons();
drop function if exists public.sync_eo_course_addons();
drop function if exists public.sync_eo_dive_rooms();
drop function if exists public.sync_eo_dive_destinations();

commit;

notify pgrst, 'reload schema';
