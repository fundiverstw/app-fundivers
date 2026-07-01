import { describe, it, expect } from 'vitest'
import { wixEventUrl } from './event-share'
import { siteConfig } from '../config/site'

describe('wixEventUrl', () => {
  it('uses plural /dives/ for dive events', () => {
    expect(wixEventUrl({ id: '23e16bcd-6855-4013-8ed6-32976981a78a', type: 'dive' }))
      .toBe(`${siteConfig.urls.site}/dives/23e16bcd-6855-4013-8ed6-32976981a78a`)
  })

  it('uses singular /course/ for course events (Wix inconsistency, not a typo)', () => {
    expect(wixEventUrl({ id: '49383375-610a-408a-894a-a0767d55f99e', type: 'course' }))
      .toBe(`${siteConfig.urls.site}/course/49383375-610a-408a-894a-a0767d55f99e`)
  })
})
