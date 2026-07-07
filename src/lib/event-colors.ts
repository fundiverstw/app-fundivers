import type { AppEvent } from '../types/database'
import { siteConfig } from '../config/site'

// Calendar color buckets for events. Kept here (not in the calendar
// component) so the title/destination matching is unit-testable on its own
// and so events.ts can reuse the structured dive classification.
//
// Courses bucket by title:
//   ow        → blue    Open Water
//   aow       → orange  Advanced Open Water
//   dsd       → pink    Discover Scuba (DSD / Try Dive) + Refresher — the
//                       no-/lapsed-cert "get in the water" tier
//   rescue    → red     Rescue, EFR, O2 / Oxygen Provider (life-support tier)
//   specialty → purple  everything else (Deep, Nitrox, Equipment, ...)
//
// Dives bucket by where they happen:
//   trip → yellow  boat dives, or anything beyond the usual Taipei→Keelung
//                  drive (Green Island, Kenting, Penghu, international, ...)
//   local → green  routine Northeast-coast shore dives
export type CourseColor = 'ow' | 'aow' | 'dsd' | 'rescue' | 'specialty'
export type DiveOuting = 'local' | 'trip'

// Course titles arrive with a capacity hint appended by the
// display_title_capacity_suffix trigger (e.g. "Open Water Course (2 spots
// open)"). Strip the trailing parenthetical so we match the canonical title.
export function stripTitleSuffix(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

export function courseColor(title: string): CourseColor {
  const base = stripTitleSuffix(title).toLowerCase()
  if (base.startsWith('advanced open water')) return 'aow'
  if (base.startsWith('open water')) return 'ow'
  if (/discover scuba|\bdsd\b|try dive|try scuba|refresher|scuba review|reactivate|skill update/.test(base)) return 'dsd'
  if (/rescue|efr|emergency first response|o2 provider|oxygen provider/.test(base)) return 'rescue'
  return 'specialty'
}

// Structured dive classification from a dive's linked travel_destinations.
// 'local' (→ green) only when EVERY linked destination is a shore-diving site
// (divetype 'Shore Diving'); 'trip' (→ yellow) as soon as any destination is
// anything else — a boat dive, or an unclassified/abroad site (Green Island,
// Kenting, …); null when the dive has no destination tagged, so the caller
// falls back to title matching.
export function diveOutingFromDestinations(
  dests: Array<{ divetype: string | null }>,
): DiveOuting | null {
  if (!dests.length) return null
  const trip = dests.some(d => d.divetype !== 'Shore Diving')
  return trip ? 'trip' : 'local'
}

// Built from fundive.config.ts `business.tripKeywords` (regex-alternation
// fragments). An empty list yields a regex that never matches, so title-based
// trip detection is simply off.
const TRIP_TITLE_RE = siteConfig.business.tripKeywords.length
  ? new RegExp(siteConfig.business.tripKeywords.join('|'), 'i')
  : /(?!)/

// Final yellow/green decision for a dive bar: trust the tagged destination
// when present, otherwise sniff the title for boat / known-trip keywords.
export function diveIsTripOrBoat(ev: Pick<AppEvent, 'title' | 'dive_outing'>): boolean {
  if (ev.dive_outing === 'trip') return true
  if (ev.dive_outing === 'local') return false
  return TRIP_TITLE_RE.test(ev.title)
}
