import { describe, it, expect } from 'vitest'
import { buildCertLevelResolver, canonicalCertLevel, type CertLadderRow } from './cert-level'

// The shop's real `cert_levels` table, with each row's id written as its code so
// the equivalences are readable. Regenerate from the database if the ladder
// changes; what matters is the shape — every agency's rungs, each pointing at
// the PADI rung it corresponds to.
const LADDER: CertLadderRow[] = [
  // BSAC
  { id: 'bsac_ocean_diver', code: 'bsac_ocean_diver', name: 'Ocean Diver / Club Diver', padi_equivalent_id: 'open_water' },
  { id: 'bsac_sport_diver', code: 'bsac_sport_diver', name: 'Sport Diver', padi_equivalent_id: 'open_water' },
  { id: 'bsac_sport_diver_20', code: 'bsac_sport_diver_20', name: 'Sport Diver (20+ logged dives)', padi_equivalent_id: 'advanced_open_water' },
  { id: 'bsac_dive_leader', code: 'bsac_dive_leader', name: 'Dive Leader', padi_equivalent_id: 'rescue' },
  { id: 'bsac_advanced_diver', code: 'bsac_advanced_diver', name: 'Advanced Diver', padi_equivalent_id: 'divemaster' },
  { id: 'bsac_club_instructor', code: 'bsac_club_instructor', name: 'Club Instructor', padi_equivalent_id: 'instructor' },
  { id: 'bsac_open_water_instructor', code: 'bsac_open_water_instructor', name: 'Open Water Instructor', padi_equivalent_id: 'instructor' },
  { id: 'bsac_advanced_instructor', code: 'bsac_advanced_instructor', name: 'Advanced Instructor', padi_equivalent_id: 'instructor' },
  // CMAS
  { id: 'cmas_1_star_diver', code: 'cmas_1_star_diver', name: '1-Star Diver', padi_equivalent_id: 'open_water' },
  { id: 'cmas_2_star_diver', code: 'cmas_2_star_diver', name: '2-Star Diver (Night & Navigation)', padi_equivalent_id: 'rescue' },
  { id: 'cmas_3_star_diver', code: 'cmas_3_star_diver', name: '3-Star Diver', padi_equivalent_id: 'divemaster' },
  { id: 'cmas_1_star_instructor', code: 'cmas_1_star_instructor', name: '1-Star Instructor', padi_equivalent_id: 'instructor' },
  { id: 'cmas_2_star_instructor', code: 'cmas_2_star_instructor', name: '2-Star Instructor', padi_equivalent_id: 'instructor' },
  // NAUI
  { id: 'naui_scuba_diver', code: 'naui_scuba_diver', name: 'Scuba Diver', padi_equivalent_id: 'open_water' },
  { id: 'naui_advanced_scuba_diver', code: 'naui_advanced_scuba_diver', name: 'Advanced Scuba Diver', padi_equivalent_id: 'advanced_open_water' },
  { id: 'naui_master_scuba_diver', code: 'naui_master_scuba_diver', name: 'Master Scuba Diver', padi_equivalent_id: 'rescue' },
  { id: 'naui_divemaster', code: 'naui_divemaster', name: 'Divemaster', padi_equivalent_id: 'divemaster' },
  { id: 'naui_scuba_instructor', code: 'naui_scuba_instructor', name: 'Scuba Instructor', padi_equivalent_id: 'instructor' },
  // PADI
  { id: 'open_water', code: 'open_water', name: 'OW', padi_equivalent_id: 'open_water' },
  { id: 'advanced_open_water', code: 'advanced_open_water', name: 'AOW', padi_equivalent_id: 'advanced_open_water' },
  { id: 'rescue', code: 'rescue', name: 'Rescue', padi_equivalent_id: 'rescue' },
  { id: 'divemaster', code: 'divemaster', name: 'DM', padi_equivalent_id: 'divemaster' },
  { id: 'instructor', code: 'instructor', name: 'Instructor', padi_equivalent_id: 'instructor' },
  { id: 'msdt', code: 'msdt', name: 'MSDT', padi_equivalent_id: 'msdt' },
  { id: 'idc_staff', code: 'idc_staff', name: 'IDC Staff', padi_equivalent_id: 'idc_staff' },
  { id: 'course_director', code: 'course_director', name: 'Course Director', padi_equivalent_id: 'course_director' },
  // SAA
  { id: 'saa_club_diver', code: 'saa_club_diver', name: 'Club Diver', padi_equivalent_id: 'open_water' },
  { id: 'saa_club_diver_20_deep_nav', code: 'saa_club_diver_20_deep_nav', name: 'Club Diver (20+ dives, Deep & Navigation)', padi_equivalent_id: 'advanced_open_water' },
  { id: 'saa_dive_leader_20', code: 'saa_dive_leader_20', name: 'Dive Leader (20+ dives)', padi_equivalent_id: 'advanced_open_water' },
  { id: 'saa_dive_leader_rescue', code: 'saa_dive_leader_rescue', name: 'Dive Leader (with Diver Rescue)', padi_equivalent_id: 'rescue' },
  { id: 'saa_dive_supervisor_rescue', code: 'saa_dive_supervisor_rescue', name: 'Dive Supervisor (with Diver Rescue)', padi_equivalent_id: 'divemaster' },
  { id: 'saa_assistant_club_instructor_rescue', code: 'saa_assistant_club_instructor_rescue', name: 'Assistant / Club Instructor (with Diver Rescue)', padi_equivalent_id: 'instructor' },
  { id: 'saa_regional_instructor', code: 'saa_regional_instructor', name: 'Regional Instructor', padi_equivalent_id: 'instructor' },
  // SDI
  { id: 'sdi_open_water', code: 'sdi_open_water', name: 'Open Water Scuba Diver', padi_equivalent_id: 'open_water' },
  { id: 'sdi_advanced_adventure', code: 'sdi_advanced_adventure', name: 'Advanced Adventure Diver', padi_equivalent_id: 'advanced_open_water' },
  { id: 'sdi_rescue', code: 'sdi_rescue', name: 'Rescue Diver', padi_equivalent_id: 'rescue' },
  { id: 'sdi_master_scuba_diver', code: 'sdi_master_scuba_diver', name: 'Master Scuba Diver', padi_equivalent_id: 'rescue' },
  { id: 'sdi_divemaster', code: 'sdi_divemaster', name: 'Divemaster', padi_equivalent_id: 'divemaster' },
  { id: 'sdi_assistant_instructor', code: 'sdi_assistant_instructor', name: 'Assistant Instructor', padi_equivalent_id: 'divemaster' },
  { id: 'sdi_instructor', code: 'sdi_instructor', name: 'Open Water Scuba Diver Instructor', padi_equivalent_id: 'instructor' },
  // SSI
  { id: 'ssi_open_water', code: 'ssi_open_water', name: 'Open Water Diver', padi_equivalent_id: 'open_water' },
  { id: 'ssi_advanced_open_water', code: 'ssi_advanced_open_water', name: 'Advanced Open Water Diver', padi_equivalent_id: 'advanced_open_water' },
  { id: 'ssi_stress_rescue', code: 'ssi_stress_rescue', name: 'Stress & Rescue Techniques', padi_equivalent_id: 'rescue' },
  { id: 'ssi_master_diver', code: 'ssi_master_diver', name: 'Master Diver', padi_equivalent_id: 'rescue' },
  { id: 'ssi_dive_con', code: 'ssi_dive_con', name: 'Dive Con', padi_equivalent_id: 'divemaster' },
  { id: 'ssi_dive_con_instructor', code: 'ssi_dive_con_instructor', name: 'Open Water / Dive Con Instructor', padi_equivalent_id: 'instructor' },
  // TDI
  { id: 'tdi_nitrox', code: 'tdi_nitrox', name: 'Nitrox Diver', padi_equivalent_id: 'open_water' },
  { id: 'tdi_intro_to_tech', code: 'tdi_intro_to_tech', name: 'Intro to Tech', padi_equivalent_id: 'advanced_open_water' },
  { id: 'tdi_advanced_nitrox', code: 'tdi_advanced_nitrox', name: 'Advanced Nitrox Diver', padi_equivalent_id: 'advanced_open_water' },
  { id: 'tdi_decompression', code: 'tdi_decompression', name: 'Decompression Procedures Diver', padi_equivalent_id: 'rescue' },
  { id: 'tdi_helitrox', code: 'tdi_helitrox', name: 'Helitrox Diver', padi_equivalent_id: 'rescue' },
  { id: 'tdi_extended_range', code: 'tdi_extended_range', name: 'Extended Range Diver', padi_equivalent_id: 'rescue' },
  { id: 'tdi_trimix', code: 'tdi_trimix', name: 'Trimix Diver', padi_equivalent_id: 'divemaster' },
  { id: 'tdi_advanced_trimix', code: 'tdi_advanced_trimix', name: 'Advanced Trimix Diver', padi_equivalent_id: 'divemaster' },
]

const resolve = buildCertLevelResolver(LADDER)

describe('buildCertLevelResolver', () => {
  // Verbatim from "Active divers by certification", which showed all twenty of
  // these as separate bars. Everything here that is one certification under two
  // names must now land on one label.
  it.each([
    ['Advanced Open Water',    'AOW'],
    ['Open Water',             'OW'],
    ['Rescue',                 'Rescue'],
    ['Divemaster',             'DM'],
    ['RD',                     'Rescue'],
    ['Instructor',             'Instructor'],
    ['Scuba Diver',            'OW'],
    ['Advanced Scuba Diver',   'AOW'],
    ['OW instructor',          'Instructor'],
    ['AOW & nitrox',           'AOW'],
    ['OWD',                    'OW'],
    ['Master Scuba Diver',     'Rescue'],
    ['OWSI',                   'Instructor'],
    ['Master Diver',           'Rescue'],
    ['3-Star Diver',           'DM'],
    ['Staff Instructor',       'IDC Staff'],
    ['OW/Scuba Diver',         'OW'],
    ['Advance Adventure Diver','AOW'],
  ])('resolves %s to %s', (raw, expected) => {
    expect(resolve(raw)).toBe(expected)
  })

  it('collapses the twenty reported labels to eight rungs', () => {
    const reported = [
      'Advanced Open Water', 'Open Water', 'Rescue', 'Divemaster', 'RD', 'Instructor',
      'Scuba Diver', 'Advanced Scuba Diver', 'OW instructor', 'AOW & nitrox', 'OWD',
      'Master Scuba Diver', 'OWSI', 'Master Diver', '3-Star Diver', 'Staff Instructor',
      'OW/Scuba Diver', 'Advance Adventure Diver',
    ]
    expect(new Set(reported.map(resolve)).size).toBeLessThan(reported.length)
    expect([...new Set(reported.map(resolve))].sort())
      .toEqual(['AOW', 'DM', 'IDC Staff', 'Instructor', 'OW', 'Rescue'])
  })

  // Reporting a diver at a rung they never earned is worse than reporting an
  // untidy label, so anything the ladder cannot place is left alone.
  it('passes an unplaceable certification through untouched', () => {
    expect(resolve('PE40')).toBe('PE40')
    expect(resolve('  Deep Sea Wizard ')).toBe('Deep Sea Wizard')
  })

  it('is empty for an empty value, so the caller can label it', () => {
    expect(resolve('')).toBe('')
    expect(resolve('   ')).toBe('')
    expect(resolve(null)).toBe('')
    expect(resolve(undefined)).toBe('')
  })

  it('ignores case, spacing and punctuation', () => {
    expect(resolve('advanced open water')).toBe('AOW')
    expect(resolve('  A.O.W.  ')).toBe('AOW')
    expect(resolve('open-water-diver')).toBe('OW')
  })

  it('reads every agency, not just PADI', () => {
    expect(resolve('Ocean Diver / Club Diver')).toBe('OW')   // BSAC
    expect(resolve('2-Star Diver (Night & Navigation)')).toBe('Rescue') // CMAS
    expect(resolve('Dive Con')).toBe('DM')                   // SSI
    expect(resolve('Advanced Adventure Diver')).toBe('AOW')  // SDI
    expect(resolve('Trimix Diver')).toBe('DM')               // TDI
  })

  // A rung named with a slash is a real ladder entry, so the whole string has
  // to be tried before falling back to its leading segment.
  it('prefers the whole string over its leading segment', () => {
    expect(resolve('Open Water / Dive Con Instructor')).toBe('Instructor')
  })

  it('leaves every PADI rung as itself', () => {
    for (const name of ['OW', 'AOW', 'Rescue', 'DM', 'Instructor', 'MSDT', 'IDC Staff', 'Course Director']) {
      expect(resolve(name)).toBe(name)
    }
  })

  // Without the table there is nothing to resolve against; shorthand has no
  // rung to name. Passing everything through beats inventing a second ladder.
  it('passes everything through when the ladder is empty', () => {
    const bare = buildCertLevelResolver([])
    expect(bare('AOW')).toBe('AOW')
    expect(bare('Advanced Scuba Diver')).toBe('Advanced Scuba Diver')
  })

  // Two agencies naming a rung the same way must agree on what it means, or
  // the answer would depend on the order the rows came back from the database.
  it('has no spelling that two agencies read as different rungs', () => {
    const seen = new Map<string, string>()
    const conflicts: string[] = []
    for (const row of LADDER) {
      for (const spelling of [row.name, row.code]) {
        const answer = resolve(spelling)
        const previous = seen.get(spelling.toLowerCase())
        if (previous && previous !== answer) conflicts.push(`${spelling}: ${previous} vs ${answer}`)
        seen.set(spelling.toLowerCase(), answer)
      }
    }
    expect(conflicts).toEqual([])
  })
})

describe('canonicalCertLevel', () => {
  it('is the resolver, for a one-off lookup', () => {
    expect(canonicalCertLevel('Advanced Scuba Diver', LADDER)).toBe('AOW')
  })
})
