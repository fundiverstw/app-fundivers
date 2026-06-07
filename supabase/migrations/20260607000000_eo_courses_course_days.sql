-- Replace EO_courses.special_date with an explicit list of the days a
-- course runs on (max 4). The old model — start_date / end_date plus a
-- single special_date fanned into 1-2 calendar pills by five adjacency
-- branches in src/lib/events.ts — was confusing and broke the
-- per-booking span math and the staff-on-duty date picker.
--
-- New model: course_days holds the actual session dates. src/lib/events.ts
-- groups adjacent days into one continuous bar (just like a multi-day
-- dive's start_date..end_date range) and renders gaps as separate pills.
-- start_date / end_date stay as the min/max envelope so existing range
-- queries, ordering, and per-booking span lookups keep working.

begin;

alter table public."EO_courses"
  add column course_days date[];

-- Reconstruct the days each course runs on, preserving the legacy
-- calendar appearance:
--   * No special_date: the old calendar rendered [start_date..end_date]
--     as one continuous bar, so enumerate every day in that range.
--   * special_date set: the days were the discrete {start, special, end}
--     points (e.g. an OW course on 05-09, 05-10, then 05-16) — the new
--     run-grouping in src/lib/events.ts re-merges any adjacent ones.
update public."EO_courses"
set course_days = case
  when special_date is null then (
    select array(
      select d::date
      from generate_series(start_date, coalesce(end_date, start_date), interval '1 day') as d))
  else (
    select array(
      select distinct d
      from unnest(array[start_date, special_date, end_date]) as d
      where d is not null
      order by d))
  end
where start_date is not null;

-- Re-derive the envelope so end_date is always populated (single-day
-- courses previously left end_date NULL).
update public."EO_courses"
set start_date = course_days[1],
    end_date   = course_days[array_upper(course_days, 1)]
where course_days is not null and array_length(course_days, 1) > 0;

alter table public."EO_courses"
  add constraint eo_courses_course_days_len
  check (course_days is null or array_length(course_days, 1) between 1 and 4);

alter table public."EO_courses"
  drop column special_date;

notify pgrst, 'reload schema';

commit;
