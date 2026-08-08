import { describe, it, expect } from 'vitest'
import { profileGaps, profileGapLabels, isProfileComplete } from './profile-completeness'
import type { Profile } from '../types/database'

const complete = {
  name: 'Ada Chen',
  date_of_birth: '1990-01-01',
  nationality: 'TW',
  gender: 'female',
  contact_method: 'line',
  contact_id: 'ada-line',
  cert_level: 'AOW',
  uncertified: false,
} as unknown as Partial<Profile>

describe('profileGaps', () => {
  it('reports nothing for a filled-in profile', () => {
    expect(profileGaps(complete)).toEqual([])
    expect(isProfileComplete(complete)).toBe(true)
  })

  it('reports every blank required field', () => {
    expect(profileGaps({})).toEqual([
      'name', 'date_of_birth', 'nationality', 'gender',
      'contact_method', 'contact_id', 'certification',
    ])
  })

  it('treats whitespace as blank', () => {
    expect(profileGaps({ ...complete, name: '   ' })).toEqual(['name'])
  })

  // "I'm not certified yet" is an answer, not an omission — the DB trigger
  // can't tell the difference, which is why the UI asks this module instead.
  it('accepts an uncertified diver with no cert level', () => {
    expect(profileGaps({ ...complete, cert_level: null, uncertified: true })).toEqual([])
  })

  it('flags a certified diver with no cert level', () => {
    expect(profileGaps({ ...complete, cert_level: null, uncertified: false })).toEqual(['certification'])
  })

  // Optional fields are silent: flagging them would drown the real gaps.
  it('ignores optional fields', () => {
    const bare = { ...complete, nickname: null, id_number: null, emergency_contact_name: null, medical_notes: null }
    expect(profileGaps(bare as Partial<Profile>)).toEqual([])
  })

  it('labels the gaps for display', () => {
    const labels = profileGapLabels({ ...complete, gender: null, date_of_birth: null })
    expect(labels).toHaveLength(2)
    expect(labels.join(', ')).toMatch(/gender/i)
    expect(labels.every(l => l.length > 0)).toBe(true)
  })
})
