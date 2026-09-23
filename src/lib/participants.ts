import { entersTheWater } from './event-kinds'
import { personName } from './names'
import type { AppEvent, Booking, Profile } from '../types/database'

/**
 * Do this event's registrants go in the water?
 *
 * Two answers, and the stricter one wins. The kind answers first: an adventure
 * travels overland, so nothing it says in `enters_water` can put anybody under
 * (see entersTheWater in event-kinds.ts). Only where the kind says "maybe" — a
 * dive, a course — does the admin's per-event answer decide, because EFR, CPR
 * and an equipment class are all kind='course' and none of them gets wet.
 *
 * Compared against false rather than read as truthy: an offline snapshot taken
 * before the column existed (20260922100000) carries no key at all, and
 * treating undefined as "dry" would empty the day's diver list rather than
 * degrading to the behavior the board had before.
 */
export function eventEntersWater(event: Pick<AppEvent, 'type' | 'enters_water'>): boolean {
  return entersTheWater(event.type) && event.enters_water !== false
}

/** A booking with the person behind it — what the logistics board holds. */
export interface RosterRow {
  booking: Booking
  profile: Profile | null
}

/** One of the day's events, already answered for water, and who is on it. */
export interface RosterGroup {
  entersWater: boolean
  rows: RosterRow[]
}

/** One person on a day's roster, however many of its events they are on. */
export interface DayPerson {
  key: string
  name: string
  profileId: string | null
  /** True when at least one of their bookings that day goes in the water. */
  inWater: boolean
}

/**
 * Everyone booked across a day's events, one entry per person, each flagged by
 * whether they actually dive that day.
 *
 * The flag is a question about the person, not about the booking: somebody who
 * takes the morning EFR class and dives in the afternoon is a diver that day,
 * so any in-water booking wins over every dry one. The shop's insurer asks who
 * was in the water, and a name that appears in both lists answers nobody.
 *
 * Keyed by profile so a person on two of the day's events is one entry, and by
 * booking when a row has no profile (a booking whose account was removed),
 * since those cannot be merged. Sorted by name so the list reads the same on
 * every reload.
 */
export function dayRoster(groups: RosterGroup[], noProfileLabel: string): DayPerson[] {
  const byKey = new Map<string, DayPerson>()
  for (const group of groups) {
    for (const r of group.rows) {
      const key = r.profile?.id ?? r.booking.id
      const existing = byKey.get(key)
      if (existing) {
        existing.inWater ||= group.entersWater
        continue
      }
      byKey.set(key, {
        key,
        name: personName(r.profile?.name) || noProfileLabel,
        profileId: r.profile?.id ?? null,
        inWater: group.entersWater,
      })
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}
