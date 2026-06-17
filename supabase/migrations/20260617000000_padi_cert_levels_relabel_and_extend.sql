-- PADI cert levels: show the labels the shop actually uses on cards, and
-- cover the full professional ladder.
--
-- Display is driven entirely by cert_levels.name (ProfilePage / EventForm
-- list PADI rows by name, ordered by rank), so this is purely a catalogue
-- edit: relabel the three full-word ranks to their abbreviations and add
-- the three pro tiers above Instructor.
--
-- Target PADI list, in rank order:
--   OW, AOW, Rescue, DM, Instructor, MSDT, IDC Staff, Course Director
--
-- `code` is the stable machine id and stays put; only `name` changes on the
-- existing rows. New rows are self-equivalent (padi_equivalent_id = id) like
-- every other PADI row, so cross-agency prereq resolution keeps working.

begin;

update public.cert_levels set name = 'OW'  where code = 'open_water';
update public.cert_levels set name = 'AOW' where code = 'advanced_open_water';
update public.cert_levels set name = 'DM'  where code = 'divemaster';

insert into public.cert_levels (code, name, rank, organization) values
  ('msdt',            'MSDT',            6, 'PADI'),
  ('idc_staff',       'IDC Staff',       7, 'PADI'),
  ('course_director', 'Course Director', 8, 'PADI');

update public.cert_levels
   set padi_equivalent_id = id
 where code in ('msdt', 'idc_staff', 'course_director');

commit;
