import { kindInvolvesScuba } from './event-kinds'
import { personName } from './names'
import type { AppEvent, Booking, Profile } from '../types/database'

/**
 * Does anyone scuba dive at this event?
 *
 * "Diver" here means scuba, nothing wider. A snorkeler or a swimmer may well
 * get wet and is still a non-diver; the shop's insurer counts scuba divers.
 *
 * Two answers, and the stricter one wins. The kind answers first: an adventure
 * travels overland, so nothing it says in `involves_scuba` can make it a scuba
 * event (see kindInvolvesScuba in event-kinds.ts). Only where the kind says
 * "maybe" — a dive, a course — does the admin's per-event answer decide,
 * because EFR, CPR and an equipment class are all kind='course' and nobody
 * scuba dives on them.
 *
 * Compared against false rather than read as truthy: an offline snapshot taken
 * before the column existed (20260922100000) carries no key at all, and
 * treating undefined as "no scuba" would empty the day's diver list rather than
 * degrading to the behavior the board had before.
 */
export function eventInvolvesScuba(event: Pick<AppEvent, 'type' | 'involves_scuba'>): boolean {
  return kindInvolvesScuba(event.type) && event.involves_scuba !== false
}

/**
 * The non-diver option a booking was made under ("Snorkeler"), or null for a
 * diver. Someone on an option comes on a scuba event without scuba diving, so
 * the board counts and shows them as a non-diver whatever the event says.
 */
export function nondiverLabel(booking: Pick<Booking, 'details'>): string | null {
  return booking.details?.nondiver_option?.label ?? null
}

/** Does this person scuba dive on this event? Event and booking both have to say yes. */
export function bookingIsDiver(
  event: Pick<AppEvent, 'type' | 'involves_scuba'>,
  booking: Pick<Booking, 'details'>,
): boolean {
  return eventInvolvesScuba(event) && nondiverLabel(booking) === null
}

/** A booking with the person behind it — what the logistics board holds. */
export interface RosterRow {
  booking: Booking
  profile: Profile | null
}

/** One of the day's events, already answered for scuba, and who is on it.
 *  A row on a non-diver option is a non-diver even on a scuba event. */
export interface RosterGroup {
  involvesScuba: boolean
  rows: RosterRow[]
}

/** One person on a day's roster, however many of its events they are on. */
export interface DayPerson {
  key: string
  name: string
  profileId: string | null
  /** True when they scuba dive on at least one of their bookings that day. */
  isDiver: boolean
}

/**
 * Everyone booked across a day's events, one entry per person, each flagged by
 * whether they scuba dive that day.
 *
 * The flag is a question about the person, not about the booking: somebody who
 * takes the morning EFR class and dives in the afternoon is a diver that day,
 * so any scuba booking wins over every non-scuba one. The shop's insurer asks
 * who was scuba diving, and a name that appears in both lists answers nobody.
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
      const isDiver = group.involvesScuba && nondiverLabel(r.booking) === null
      const existing = byKey.get(key)
      if (existing) {
        existing.isDiver ||= isDiver
        continue
      }
      byKey.set(key, {
        key,
        name: personName(r.profile?.name) || noProfileLabel,
        profileId: r.profile?.id ?? null,
        isDiver,
      })
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}
