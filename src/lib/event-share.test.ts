import { describe, it, expect } from 'vitest'
import { wixEventUrl } from './event-share'
import { siteConfig } from '../config/site'

describe('wixEventUrl', () => {
  it('points at the unified /events/<id> page regardless of event kind', () => {
    expect(wixEventUrl('23e16bcd-6855-4013-8ed6-32976981a78a'))
      .toBe(`${siteConfig.urls.site}/events/23e16bcd-6855-4013-8ed6-32976981a78a`)
  })
})
