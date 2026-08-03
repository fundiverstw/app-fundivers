import { describe, it, expect, vi } from 'vitest'

const { config } = vi.hoisted(() => ({
  config: { urls: { site: 'https://shop.test', app: 'https://app.shop.test' } },
}))
vi.mock('../config/site', () => ({ siteConfig: config }))

import { eventShareUrl } from './event-share'

describe('eventShareUrl', () => {
  it("points at the app's own registration page for the event", () => {
    expect(eventShareUrl('23e16bcd-6855-4013-8ed6-32976981a78a'))
      .toBe('https://app.shop.test/register/23e16bcd-6855-4013-8ed6-32976981a78a')
  })

  it('uses the app origin, not the marketing site', () => {
    expect(eventShareUrl('abc').startsWith(`${config.urls.app}/`)).toBe(true)
    expect(eventShareUrl('abc').startsWith(config.urls.site)).toBe(false)
  })

  it('url-encodes the id so odd ids cannot break the path', () => {
    expect(eventShareUrl('a/b?c')).toBe('https://app.shop.test/register/a%2Fb%3Fc')
  })
})
