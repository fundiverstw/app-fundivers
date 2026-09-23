import { describe, it, expect } from 'vitest'
import { personName } from './names'

describe('personName', () => {
  it('renders the legal name', () => {
    expect(personName('Chen Zi-Ni')).toBe('Chen Zi-Ni')
  })

  it('returns an empty string when there is no name (caller supplies its own placeholder)', () => {
    expect(personName(null)).toBe('')
    expect(personName(undefined)).toBe('')
    expect(personName('   ')).toBe('')
  })

  it('trims surrounding whitespace', () => {
    expect(personName('  Chen Zi-Ni  ')).toBe('Chen Zi-Ni')
  })
})
