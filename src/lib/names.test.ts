import { describe, it, expect } from 'vitest'
import { personName } from './names'

describe('personName', () => {
  it('renders "Name (nickname)" when both are present', () => {
    expect(personName('Chen Zi-Ni', 'Jenny')).toBe('Chen Zi-Ni (Jenny)')
  })

  it('shows the name alone when there is no nickname', () => {
    expect(personName('Chen Zi-Ni', null)).toBe('Chen Zi-Ni')
    expect(personName('Chen Zi-Ni', '')).toBe('Chen Zi-Ni')
    expect(personName('Chen Zi-Ni', '   ')).toBe('Chen Zi-Ni')
  })

  it('does not duplicate when nickname equals the name', () => {
    expect(personName('Ada', 'Ada')).toBe('Ada')
  })

  it('falls back to the nickname alone when there is no legal name yet', () => {
    expect(personName(null, 'Jenny')).toBe('Jenny')
    expect(personName('', 'Jenny')).toBe('Jenny')
  })

  it('returns an empty string when neither is set (caller supplies its own placeholder)', () => {
    expect(personName(null, null)).toBe('')
    expect(personName(undefined, undefined)).toBe('')
  })

  it('trims surrounding whitespace', () => {
    expect(personName('  Chen Zi-Ni  ', '  Jenny  ')).toBe('Chen Zi-Ni (Jenny)')
  })
})
