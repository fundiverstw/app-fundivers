import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CalendarLinkEvent } from './google-calendar'

// The shop timezone drives which calendar day an instant falls on, so pin it
// rather than inheriting whatever the fork's config happens to say.
const { config } = vi.hoisted(() => ({
  config: {
    locale: { timezone: 'Asia/Taipei', currency: 'TWD', currencyLabel: 'NTD', language: 'en' },
    contact: { address: 'No. 8, Heping St' },
    urls: { app: 'https://app.test', eventPage: null as string | null },
    business: { eventDurationHours: 8 as number | undefined },
    features: { eventSharing: false },
  },
}))
vi.mock('../config/site', () => ({ siteConfig: config }))

beforeEach(() => {
  config.business.eventDurationHours = 8
  config.urls.eventPage = null
  config.features.eventSharing = false
})

function event(overrides: Partial<CalendarLinkEvent> = {}): CalendarLinkEvent {
  return {
    id: 'evt-1',
    type: 'dive',
    title: 'Longdong shore dive',
    // 2026-08-09 07:00 Taipei
    start_time: '2026-08-08T23:00:00.000Z',
    end_time: null,
    start_time_hhmm: '07:00',
    details: null,
    ...overrides,
  }
}

/** The decoded value of a query parameter on the built URL. */
function param(url: string, key: string): string | null {
  return new URL(url).searchParams.get(key)
}

describe('googleCalendarUrl', () => {
  it('builds a template link with the event title and a timed span', async () => {
    const { googleCalendarUrl } = await import('./google-calendar')
    const url = googleCalendarUrl(event())

    expect(url.startsWith('https://calendar.google.com/calendar/render?')).toBe(true)
    expect(param(url, 'action')).toBe('TEMPLATE')
    expect(param(url, 'text')).toBe('Longdong shore dive')
    expect(param(url, 'dates')).toBe('20260808T230000Z/20260809T070000Z')
  })

  it('percent-encodes spaces rather than leaving form-style plus signs', async () => {
    const { googleCalendarUrl } = await import('./google-calendar')
    const url = googleCalendarUrl(event({ title: 'Longdong shore dive' }))

    expect(url).toContain('text=Longdong%20shore%20dive')
    expect(url).not.toContain('+')
    expect(param(url, 'text')).toBe('Longdong shore dive')
  })

  it('honours the shop-configured event length', async () => {
    config.business.eventDurationHours = 3
    const { googleCalendarUrl } = await import('./google-calendar')

    expect(param(googleCalendarUrl(event()), 'dates')).toBe('20260808T230000Z/20260809T020000Z')
  })

  it('falls back to eight hours when the shop configures no length', async () => {
    config.business.eventDurationHours = undefined
    const { googleCalendarUrl } = await import('./google-calendar')

    expect(param(googleCalendarUrl(event()), 'dates')).toBe('20260808T230000Z/20260809T070000Z')
  })

  it('makes an event with no start time an all-day event on the shop day', async () => {
    const { googleCalendarUrl } = await import('./google-calendar')
    // Midnight Taipei on the 9th — a UTC-day slice would say the 8th.
    const url = googleCalendarUrl(event({ start_time: '2026-08-08T16:00:00.000Z', start_time_hhmm: null }))

    expect(param(url, 'dates')).toBe('20260809/20260810')
  })

  it('spans a multi-day event as all-day through its last day inclusive', async () => {
    const { googleCalendarUrl } = await import('./google-calendar')
    const url = googleCalendarUrl(event({ end_time: '2026-08-10T23:00:00.000Z' }))

    expect(param(url, 'dates')).toBe('20260809/20260812')
  })

  it('gives on-premises kinds the shop address and travelling kinds none', async () => {
    const { googleCalendarUrl } = await import('./google-calendar')

    expect(param(googleCalendarUrl(event({ type: 'course' })), 'location')).toBe('No. 8, Heping St')
    expect(param(googleCalendarUrl(event({ type: 'dive' })), 'location')).toBeNull()
    expect(param(googleCalendarUrl(event({ type: 'adventure' })), 'location')).toBeNull()
  })

  it('describes the event with its overview and a link back to the app', async () => {
    const { googleCalendarUrl } = await import('./google-calendar')
    const url = googleCalendarUrl(event({
      details: {
        description: 'Meet at the shop, gear loaded by 06:45.',
        included: null, not_included: null, schedule: null,
        transportation: null, prerequisites: null, required_cert: null, required_dives: null,
      },
    }))

    expect(param(url, 'details')).toBe('Meet at the shop, gear loaded by 06:45.\n\nhttps://app.test')
  })

  it('links to the shop event page instead when event sharing is configured', async () => {
    config.features.eventSharing = true
    config.urls.eventPage = 'https://shop.test/events/{id}'
    const { googleCalendarUrl } = await import('./google-calendar')

    expect(param(googleCalendarUrl(event()), 'details')).toBe('https://shop.test/events/evt-1')
  })
})
