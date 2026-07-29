-- Dive logs: one "who you dived with" column, not two.
--
-- The form asked for a buddy and an instructor separately, but a dive has one
-- or the other and almost never both, so divers were staring at an empty box
-- on every entry. buddy_name is the survivor — it is the standard logbook
-- term and the column every other surface (CSV export, list card) already
-- reads.
--
-- Any name that only exists on instructor_name moves across first, so nothing
-- is dropped. Where a row somehow carries both, the buddy wins and the
-- instructor is discarded — there is no second column left to put it in.

update public.dive_logs
   set buddy_name = instructor_name
 where buddy_name is null
   and instructor_name is not null;

alter table public.dive_logs
  drop column if exists instructor_name;
