-- Two cert-catalogue changes:
--   1. Drop the PADI "IDC Candidate" rank — it's not a certification divers
--      hold, so it shouldn't be a selectable option. The instructor-tier
--      rows of other agencies used it as their padi_equivalent_id; re-point
--      those to PADI "Instructor" before removing it (the FK is ON DELETE
--      RESTRICT). With IDC Candidate gone, move Instructor back to rank 5 so
--      the PADI ranks are contiguous again (it was bumped to 6 in
--      20260505040000 only to make room for IDC Candidate).
--   2. Add SDI (recreational) and TDI (technical) as agencies, each level
--      carrying its closest PADI-equivalent rank for cross-agency prereq
--      resolution — same pattern as the BSAC/CMAS/SSI/NAUI/SAA rows.
--      Source: https://www.tdisdi.com/sdi/get-certified/

begin;

-- 1. Drop IDC Candidate.
update public.cert_levels
   set padi_equivalent_id = (select id from public.cert_levels where code = 'instructor')
 where padi_equivalent_id = (select id from public.cert_levels where code = 'idc_candidate');

delete from public.cert_levels where code = 'idc_candidate';

update public.cert_levels set rank = 5 where code = 'instructor';

-- 2. SDI — recreational ladder.
insert into public.cert_levels (code, name, rank, organization, padi_equivalent_id) values
  ('sdi_open_water',           'Open Water Scuba Diver',            1, 'SDI', (select id from public.cert_levels where code='open_water')),
  ('sdi_advanced_adventure',   'Advanced Adventure Diver',          2, 'SDI', (select id from public.cert_levels where code='advanced_open_water')),
  ('sdi_rescue',               'Rescue Diver',                      3, 'SDI', (select id from public.cert_levels where code='rescue')),
  ('sdi_master_scuba_diver',   'Master Scuba Diver',                4, 'SDI', (select id from public.cert_levels where code='rescue')),
  ('sdi_divemaster',           'Divemaster',                        5, 'SDI', (select id from public.cert_levels where code='divemaster')),
  ('sdi_assistant_instructor', 'Assistant Instructor',              6, 'SDI', (select id from public.cert_levels where code='divemaster')),
  ('sdi_instructor',           'Open Water Scuba Diver Instructor', 7, 'SDI', (select id from public.cert_levels where code='instructor'));

-- 3. TDI — technical progression (open circuit), mapped to the recreational
--    experience floor each tier assumes.
insert into public.cert_levels (code, name, rank, organization, padi_equivalent_id) values
  ('tdi_nitrox',           'Nitrox Diver',                   1, 'TDI', (select id from public.cert_levels where code='open_water')),
  ('tdi_intro_to_tech',    'Intro to Tech',                  2, 'TDI', (select id from public.cert_levels where code='advanced_open_water')),
  ('tdi_advanced_nitrox',  'Advanced Nitrox Diver',          3, 'TDI', (select id from public.cert_levels where code='advanced_open_water')),
  ('tdi_decompression',    'Decompression Procedures Diver', 4, 'TDI', (select id from public.cert_levels where code='rescue')),
  ('tdi_helitrox',         'Helitrox Diver',                 5, 'TDI', (select id from public.cert_levels where code='rescue')),
  ('tdi_extended_range',   'Extended Range Diver',           6, 'TDI', (select id from public.cert_levels where code='rescue')),
  ('tdi_trimix',           'Trimix Diver',                   7, 'TDI', (select id from public.cert_levels where code='divemaster')),
  ('tdi_advanced_trimix',  'Advanced Trimix Diver',          8, 'TDI', (select id from public.cert_levels where code='divemaster'));

commit;
