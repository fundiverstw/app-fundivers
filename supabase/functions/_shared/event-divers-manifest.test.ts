import { describe, it, expect } from 'vitest'
import {
  formatManifestDob,
  genderToZh,
  nationalityToZh,
  roleToZh,
  manifestTitle,
  buildManifestAoa,
  MANIFEST_HEADERS,
  MANIFEST_TITLE_SUFFIX,
  type EventDiverRow,
} from './event-divers-manifest'

describe('formatManifestDob', () => {
  it('formats YYYY-MM-DD as "Mon D,YYYY" with no space after the comma', () => {
    expect(formatManifestDob('1980-03-04')).toBe('Mar 4,1980')
    expect(formatManifestDob('1985-07-06')).toBe('Jul 6,1985')
  })
  it('is UTC-anchored so a bare date never shifts a day', () => {
    expect(formatManifestDob('2000-01-01')).toBe('Jan 1,2000')
  })
  it('returns empty for null and the raw string for unparseable input', () => {
    expect(formatManifestDob(null)).toBe('')
    expect(formatManifestDob('not-a-date')).toBe('not-a-date')
  })
})

describe('genderToZh', () => {
  it('maps recognized values regardless of case', () => {
    expect(genderToZh('male')).toBe('男')
    expect(genderToZh('Female')).toBe('女')
    expect(genderToZh('M')).toBe('男')
  })
  it('passes through unknown / empty values', () => {
    expect(genderToZh('non-binary')).toBe('non-binary')
    expect(genderToZh(null)).toBe('')
  })
})

describe('nationalityToZh', () => {
  it('maps country names and demonyms to Chinese', () => {
    expect(nationalityToZh('American')).toBe('美國')
    expect(nationalityToZh('usa')).toBe('美國')
    expect(nationalityToZh('United States')).toBe('美國')
    expect(nationalityToZh('Taiwanese')).toBe('台灣')
    expect(nationalityToZh('Croatia')).toBe('克羅埃西亞')
  })
  it('passes through unrecognized / garbage values untouched', () => {
    expect(nationalityToZh('123123')).toBe('123123')
    expect(nationalityToZh(null)).toBe('')
  })
})

describe('roleToZh', () => {
  it('maps duty roles to Chinese labels', () => {
    expect(roleToZh('instructor')).toBe('教練')
    expect(roleToZh('guide')).toBe('導潛')
    expect(roleToZh('support')).toBe('支援')
    expect(roleToZh('Instructor')).toBe('教練')
  })
  it('passes through unknown / empty values', () => {
    expect(roleToZh('captain')).toBe('captain')
    expect(roleToZh(null)).toBe('')
  })
})

describe('manifestTitle', () => {
  it('combines boat name, registration, and the fixed form suffix', () => {
    expect(manifestTitle('坤成8號', 'CT2-6445')).toBe(`坤成8號 (CT2-6445) ${MANIFEST_TITLE_SUFFIX}`)
  })
  it('omits the parens with no registration and falls back to the suffix alone', () => {
    expect(manifestTitle('坤成8號', '')).toBe(`坤成8號 ${MANIFEST_TITLE_SUFFIX}`)
    expect(manifestTitle('', '')).toBe(MANIFEST_TITLE_SUFFIX)
  })
})

describe('buildManifestAoa', () => {
  const divers: EventDiverRow[] = [
    {
      name: '李邁先 Mike Lee', dob: '1985-07-06', nationality: 'Taiwanese',
      idNumber: 'A126167207', gender: 'male', certLevel: 'IDC Staff', loggedDives: 1000,
    },
    {
      name: 'Anita Gregory', dob: '1979-06-23', nationality: 'Poland',
      idNumber: 'F900171266', gender: 'female', certLevel: 'AOW+EANx', loggedDives: 204,
    },
  ]
  const config = { boatName: '坤成8號', registration: 'CT2-6445', notes: ['1.集合時間', '2. 帶證件'] }

  it('lays out title, headers, numbered diver rows, then footer notes', () => {
    const aoa = buildManifestAoa(divers, config)
    expect(aoa[0]).toEqual([`坤成8號 (CT2-6445) ${MANIFEST_TITLE_SUFFIX}`])
    expect(aoa[1]).toEqual([...MANIFEST_HEADERS])
    expect(aoa[2]).toEqual([1, '李邁先 Mike Lee', 'A126167207', 'Jul 6,1985', '男', 'IDC Staff', 1000, '台灣', ''])
    expect(aoa[3]).toEqual([2, 'Anita Gregory', 'F900171266', 'Jun 23,1979', '女', 'AOW+EANx', 204, '波蘭', ''])
    // blank spacer then one row per note
    expect(aoa[4]).toEqual([])
    expect(aoa[5]).toEqual(['1.集合時間'])
    expect(aoa[6]).toEqual(['2. 帶證件'])
  })

  it('skips the spacer + notes block when there are no notes', () => {
    const aoa = buildManifestAoa(divers, { ...config, notes: [] })
    expect(aoa).toHaveLength(4) // title + header + 2 divers
  })

  it('renders an empty logged_dives cell rather than a number when null', () => {
    const aoa = buildManifestAoa(
      [{ ...divers[0], loggedDives: null }],
      { ...config, notes: [] },
    )
    expect(aoa[2][6]).toBe('')
  })

  it('puts a staff remark in the 備註 column and leaves it blank for divers', () => {
    const aoa = buildManifestAoa(
      [
        divers[0],
        { ...divers[1], remark: '教練、導潛' },
      ],
      { ...config, notes: [] },
    )
    expect(aoa[2][8]).toBe('')          // booked diver: blank remark
    expect(aoa[3][8]).toBe('教練、導潛') // staff: role(s) in 備註
  })
})
