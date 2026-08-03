import { describe, it, expect, beforeEach, vi } from 'vitest'

const { config } = vi.hoisted(() => ({
  config: {
    features: { eventSharing: true },
    urls: { site: 'https://shop.test', eventPage: 'https://shop.test/events/{id}' as string | null },
  },
}))
vi.mock('../config/site', () => ({ siteConfig: config }))

import { eventShareUrl } from './event-share'

describe('eventShareUrl', () => {
  beforeEach(() => {
    config.features.eventSharing = true
    config.urls.eventPage = 'https://shop.test/events/{id}'
  })

  it('interpolates the id into the configured event-page template', () => {
    expect(eventShareUrl('23e16bcd-6855-4013-8ed6-32976981a78a'))
      .toBe('https://shop.test/events/23e16bcd-6855-4013-8ed6-32976981a78a')
  })

  it('returns null when the feature is turned off, even if a template is set', () => {
    config.features.eventSharing = false
    expect(eventShareUrl('23e16bcd-6855-4013-8ed6-32976981a78a')).toBeNull()
  })

  it('returns null when the feature is on but no template is configured', () => {
    config.urls.eventPage = null
    expect(eventShareUrl('23e16bcd-6855-4013-8ed6-32976981a78a')).toBeNull()
  })

  it('url-encodes the id so odd ids cannot break the path', () => {
    expect(eventShareUrl('a/b?c')).toBe('https://shop.test/events/a%2Fb%3Fc')
  })
})
