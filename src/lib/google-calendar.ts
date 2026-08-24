import { siteConfig } from '../config/site'
import { addIsoDays } from './dates'
import { heldAtShop } from './event-kinds'
import { eventShareUrl } from './event-share'
import type { AppEvent } from '../types/database'

// "Add to Google Calendar" links. Google's event-template endpoint takes the
// whole event in the query string, so this is a plain link — no OAuth, no
// account connection, no subscription feed. The diver lands on a pre-filled
// Google Calendar compose screen and saves (or doesn't) themselves. Nothing is
// written back: an event rescheduled later in the app does not follow.
const TEMPLATE_URL = 'https://calendar.google.com/calendar/render'

// How long a timed event runs when the shop hasn't configured its own length.
// Events carry a start time but no end time, and Google needs a span.
const FALLBACK_DURATION_HOURS = 8

export type CalendarLinkEvent = Pick<
  AppEvent, 'id' | 'type' | 'title' | 'start_time' | 'end_time' | 'start_time_hhmm' | 'details'
>

/** The shop's calendar day for an instant, as 'YYYY-MM-DD'. The stored
 *  timestamp is a UTC instant, so a naive slice would hand Google the viewer's
 *  (or UTC's) day rather than the day the shop actually runs the event. */
function shopDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: siteConfig.locale.timezone })
}

/** '2026-08-09' → '20260809' */
function compactDay(day: string): string {
  return day.replace(/-/g, '')
}

/** A UTC instant in Google's basic format: '20260809T230000Z'. */
function compactInstant(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * The `dates` parameter — Google's span, `start/end`.
 *
 * All-day form ('YYYYMMDD/YYYYMMDD', end exclusive) whenever a clock time would
 * be a lie: an event with no start time set, and every multi-day event, where
 * the last day's activity would otherwise be cut off at the first day's start
 * time. Single-day events with a time get a real timed span so the diver's
 * calendar shows the meeting time.
 */
function spanParam(event: CalendarLinkEvent): string {
  const startDay = shopDay(event.start_time)
  const endDay = event.end_time ? shopDay(event.end_time) : startDay
  if (!event.start_time_hhmm || endDay > startDay) {
    return `${compactDay(startDay)}/${compactDay(addIsoDays(endDay, 1))}`
  }
  const start = new Date(event.start_time)
  const hours = siteConfig.business.eventDurationHours ?? FALLBACK_DURATION_HOURS
  const end = new Date(start.getTime() + hours * 3_600_000)
  return `${compactInstant(start)}/${compactInstant(end)}`
}

/** Free-text body: the event's own overview, then a link back to it. */
function descriptionParam(event: CalendarLinkEvent): string {
  const overview = event.details?.description?.trim()
  const link = eventShareUrl(event.id) ?? siteConfig.urls.app
  return [overview, link].filter(Boolean).join('\n\n')
}

/**
 * A Google Calendar template URL that pre-fills this event. Kinds held away
 * from the shop (dives, adventures) carry no location — the meeting point
 * isn't modeled and the dive site isn't the shop; kinds that run on the
 * premises get the shop address.
 */
export function googleCalendarUrl(event: CalendarLinkEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: spanParam(event),
    details: descriptionParam(event),
  })
  if (heldAtShop(event.type)) params.set('location', siteConfig.contact.address)
  // URLSearchParams serializes a space as '+', which only decodes back to a
  // space under form-encoding rules. '%20' reads the same either way, so the
  // title can't land in Google's compose box with plus signs in it.
  return `${TEMPLATE_URL}?${params.toString().replace(/\+/g, '%20')}`
}
