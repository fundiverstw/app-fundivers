import { describe, it, expect } from 'vitest'
import { wixSiteUrl } from './dive-site-links'

describe('wixSiteUrl', () => {
  it('builds the travel-destination URL from a slug', () => {
    expect(wixSiteUrl('wan-an-jian-navy-wreck'))
      .toBe('https://www.fundiverstw.com/traveldestinations/wan-an-jian-navy-wreck')
  })

  it('returns null for a missing, empty or whitespace slug', () => {
    expect(wixSiteUrl(null)).toBeNull()
    expect(wixSiteUrl(undefined)).toBeNull()
    expect(wixSiteUrl('')).toBeNull()
    expect(wixSiteUrl('   ')).toBeNull()
  })
})
