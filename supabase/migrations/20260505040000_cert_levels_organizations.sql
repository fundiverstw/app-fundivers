-- Expand public.cert_levels to cover non-PADI agencies (BSAC, CMAS, SSI,
-- NAUI, SAA) plus the new PADI "IDC Candidate" rank, and capture each
-- non-PADI level's PADI-equivalent rank so prereq comparisons can resolve
-- across agencies.
--
-- Schema:
--   organization        text NOT NULL — 'PADI', 'BSAC', 'CMAS', 'SSI', 'NAUI', 'SAA'
--   padi_equivalent_id  uuid → cert_levels(id) — for PADI rows, self-id;
--                                                for agency rows, the closest PADI rank
--
-- The unique-on-rank constraint is dropped because rank is now a per-org
-- ordering signal (BSAC has 8 levels, CMAS has 5, …) — replaced with a
-- composite (organization, rank) uniqueness, with `code` staying globally
-- unique as the stable machine identifier.

begin;

-- 1. Drop the global rank uniqueness, add the new columns.
alter table public.cert_levels drop constraint if exists cert_levels_rank_key;
alter table public.cert_levels
  add column organization        text,
  add column padi_equivalent_id  uuid references public.cert_levels(id) on delete restrict;

-- 2. Backfill existing 5 PADI rows: organization + self-equivalent.
update public.cert_levels set organization = 'PADI';
update public.cert_levels set padi_equivalent_id = id;

-- 3. New PADI rank: IDC Candidate. Sits between Divemaster (rank 4) and
--    Instructor (rank 5) — shift Instructor out by one first so we can
--    take rank 5.
update public.cert_levels set rank = 6 where code = 'instructor';

insert into public.cert_levels (code, name, name_zh, rank, organization)
values ('idc_candidate', 'IDC Candidate', 'IDC 候選人', 5, 'PADI');
update public.cert_levels set padi_equivalent_id = id where code = 'idc_candidate';

-- 4. Per-org rows. padi_equivalent_id resolves via subselect on `code` so
--    we don't have to know the PADI ids ahead of time.

-- BSAC
insert into public.cert_levels (code, name, rank, organization, padi_equivalent_id) values
  ('bsac_ocean_diver',           'Ocean Diver / Club Diver',                  1, 'BSAC', (select id from public.cert_levels where code='open_water')),
  ('bsac_sport_diver',            'Sport Diver',                              2, 'BSAC', (select id from public.cert_levels where code='open_water')),
  ('bsac_sport_diver_20',         'Sport Diver (20+ logged dives)',           3, 'BSAC', (select id from public.cert_levels where code='advanced_open_water')),
  ('bsac_dive_leader',            'Dive Leader',                              4, 'BSAC', (select id from public.cert_levels where code='rescue')),
  ('bsac_advanced_diver',         'Advanced Diver',                           5, 'BSAC', (select id from public.cert_levels where code='divemaster')),
  ('bsac_club_instructor',        'Club Instructor',                          6, 'BSAC', (select id from public.cert_levels where code='idc_candidate')),
  ('bsac_open_water_instructor',  'Open Water Instructor',                    7, 'BSAC', (select id from public.cert_levels where code='idc_candidate')),
  ('bsac_advanced_instructor',    'Advanced Instructor',                      8, 'BSAC', (select id from public.cert_levels where code='idc_candidate'));

-- CMAS
insert into public.cert_levels (code, name, rank, organization, padi_equivalent_id) values
  ('cmas_1_star_diver',       '1-Star Diver',                            1, 'CMAS', (select id from public.cert_levels where code='open_water')),
  ('cmas_2_star_diver',       '2-Star Diver (Night & Navigation)',       2, 'CMAS', (select id from public.cert_levels where code='rescue')),
  ('cmas_3_star_diver',       '3-Star Diver',                            3, 'CMAS', (select id from public.cert_levels where code='divemaster')),
  ('cmas_1_star_instructor',  '1-Star Instructor',                       4, 'CMAS', (select id from public.cert_levels where code='idc_candidate')),
  ('cmas_2_star_instructor',  '2-Star Instructor',                       5, 'CMAS', (select id from public.cert_levels where code='idc_candidate'));

-- SSI
insert into public.cert_levels (code, name, rank, organization, padi_equivalent_id) values
  ('ssi_open_water',          'Open Water Diver',                        1, 'SSI', (select id from public.cert_levels where code='open_water')),
  ('ssi_advanced_open_water', 'Advanced Open Water Diver',               2, 'SSI', (select id from public.cert_levels where code='advanced_open_water')),
  ('ssi_stress_rescue',       'Stress & Rescue Techniques',              3, 'SSI', (select id from public.cert_levels where code='rescue')),
  ('ssi_master_diver',        'Master Diver',                            4, 'SSI', (select id from public.cert_levels where code='rescue')),
  ('ssi_dive_con',            'Dive Con',                                5, 'SSI', (select id from public.cert_levels where code='divemaster')),
  ('ssi_dive_con_instructor', 'Open Water / Dive Con Instructor',        6, 'SSI', (select id from public.cert_levels where code='idc_candidate'));

-- NAUI
insert into public.cert_levels (code, name, rank, organization, padi_equivalent_id) values
  ('naui_scuba_diver',          'Scuba Diver',                           1, 'NAUI', (select id from public.cert_levels where code='open_water')),
  ('naui_advanced_scuba_diver', 'Advanced Scuba Diver',                  2, 'NAUI', (select id from public.cert_levels where code='advanced_open_water')),
  ('naui_master_scuba_diver',   'Master Scuba Diver',                    3, 'NAUI', (select id from public.cert_levels where code='rescue')),
  ('naui_divemaster',           'Divemaster',                            4, 'NAUI', (select id from public.cert_levels where code='divemaster')),
  ('naui_scuba_instructor',     'Scuba Instructor',                      5, 'NAUI', (select id from public.cert_levels where code='idc_candidate'));

-- SAA
insert into public.cert_levels (code, name, rank, organization, padi_equivalent_id) values
  ('saa_club_diver',                       'Club Diver',                                       1, 'SAA', (select id from public.cert_levels where code='open_water')),
  ('saa_club_diver_20_deep_nav',           'Club Diver (20+ dives, Deep & Navigation)',        2, 'SAA', (select id from public.cert_levels where code='advanced_open_water')),
  ('saa_dive_leader_20',                   'Dive Leader (20+ dives)',                          3, 'SAA', (select id from public.cert_levels where code='advanced_open_water')),
  ('saa_dive_leader_rescue',               'Dive Leader (with Diver Rescue)',                  4, 'SAA', (select id from public.cert_levels where code='rescue')),
  ('saa_dive_supervisor_rescue',           'Dive Supervisor (with Diver Rescue)',              5, 'SAA', (select id from public.cert_levels where code='divemaster')),
  ('saa_assistant_club_instructor_rescue', 'Assistant / Club Instructor (with Diver Rescue)',  6, 'SAA', (select id from public.cert_levels where code='idc_candidate')),
  ('saa_regional_instructor',              'Regional Instructor',                              7, 'SAA', (select id from public.cert_levels where code='idc_candidate'));

-- 5. Lock down going forward.
alter table public.cert_levels alter column organization set not null;
alter table public.cert_levels add constraint cert_levels_org_rank_unique unique (organization, rank);

commit;
