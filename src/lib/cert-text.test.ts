import { describe, it, expect } from 'vitest'
import { printedCertLevel } from './cert-text'

const mark = (typed: string) => `${typed} (?)`

describe('printedCertLevel', () => {
  it('prints a picked level as stored, and marks legacy text so it never reads as one', () => {
    expect(printedCertLevel({ cert_level_code: 'open_water', cert_level: 'Open Water Diver' }, mark)).toBe('Open Water Diver')
    expect(printedCertLevel({ cert_level_code: null, cert_level: 'Advanced Open Water Diver' }, mark)).toBe('Advanced Open Water Diver (?)')
  })

  it('prints nothing for no claim, or for text left on a "not certified" profile', () => {
    expect(printedCertLevel({ cert_level_code: null, cert_level: null }, mark)).toBeNull()
    expect(printedCertLevel({ cert_level_code: null, cert_level: 'OW', uncertified: true }, mark)).toBeNull()
  })
})
