import { describe, it, expect } from 'vitest'
import { wixSiteUrl } from './dive-site-links'
import { siteConfig } from '../config/site'

describe('wixSiteUrl', () => {
  it('builds the travel-destination URL from a slug', () => {
    expect(wixSiteUrl('wan-an-jian-navy-wreck'))
      .toBe(`${siteConfig.urls.travelDestinationsBase}wan-an-jian-navy-wreck`)
  })

  it('returns null for a missing, empty or whitespace slug', () => {
    expect(wixSiteUrl(null)).toBeNull()
    expect(wixSiteUrl(undefined)).toBeNull()
    expect(wixSiteUrl('')).toBeNull()
    expect(wixSiteUrl('   ')).toBeNull()
  })
})
