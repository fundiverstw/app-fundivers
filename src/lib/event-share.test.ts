import { describe, it, expect, beforeEach, vi } from 'vitest'

const { urls } = vi.hoisted(() => ({
  urls: { site: 'https://shop.test', eventPage: 'https://shop.test/events/{id}' as string | null },
}))
vi.mock('../config/site', () => ({ siteConfig: { urls } }))

import { eventShareUrl } from './event-share'

describe('eventShareUrl', () => {
  beforeEach(() => { urls.eventPage = 'https://shop.test/events/{id}' })

  it('interpolates the id into the configured event-page template', () => {
    expect(eventShareUrl('23e16bcd-6855-4013-8ed6-32976981a78a'))
      .toBe('https://shop.test/events/23e16bcd-6855-4013-8ed6-32976981a78a')
  })

  it('returns null when the shop configures no event page', () => {
    urls.eventPage = null
    expect(eventShareUrl('23e16bcd-6855-4013-8ed6-32976981a78a')).toBeNull()
  })

  it('url-encodes the id so odd ids cannot break the path', () => {
    expect(eventShareUrl('a/b?c')).toBe('https://shop.test/events/a%2Fb%3Fc')
  })
})
