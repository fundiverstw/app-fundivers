// Pure helpers for the register-scheduled-trip edge function: request parsing
// and the confirmation email sent to the shop + the diver. Kept apart from
// index.ts so vitest can import them (index.ts uses jsr:/npm: specifiers).
// Mirrors _shared/package-registration-email.ts (minus the partner/kickback).

import { t } from "./i18n.ts"

export const SCHEDULED_TRIP_NOTES_MAX = 3000

export interface RegisterScheduledTripInput {
  scheduled_trip_id?: unknown
  addon_ids?: unknown
  room_id?: unknown
  notes?: unknown
}

export interface RegisterScheduledTripRequest {
  scheduledTripId: string
  addonIds: string[]
  roomId: string | null
  notes: string
}

// Validate + normalise the diver-supplied body. Returns an error string (caller
// turns it into a 400) or the trimmed request.
export function parseRegisterScheduledTripInput(
  body: RegisterScheduledTripInput,
): { error: string } | { request: RegisterScheduledTripRequest } {
  const scheduledTripId = typeof body.scheduled_trip_id === 'string' ? body.scheduled_trip_id.trim() : ''
  const roomId = typeof body.room_id === 'string' && body.room_id.trim() ? body.room_id.trim() : null
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  const addonIds = Array.isArray(body.addon_ids)
    ? body.addon_ids.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : []

  if (!scheduledTripId) return { error: t.emails.errors.pickTrip }
  if (notes.length > SCHEDULED_TRIP_NOTES_MAX) return { error: t.emails.errors.notesTooLong }

  return { request: { scheduledTripId, addonIds, roomId, notes } }
}

export interface ScheduledTripEmailParts {
  shopName: string
  tripTitle: string
  tripDates: string | null
  addonLabels: string[]
  roomLabel: string | null
  notes: string
  diverName: string
  diverEmail: string
  estimateTotal: number
  currencyLabel: string
}

const money = (n: number, label: string) => `${label} ${Math.round(n).toLocaleString('en-US')}`
const list = (items: string[]) => (items.length ? items.join(', ') : t.emails.common.none)

/**
 * The confirmation emails. One subject; a shop-facing body (a new registration
 * for one of the shop's own trips) and a diver-facing confirmation. Both carry
 * the estimate and a "the shop will confirm the final cost" note.
 */
export function buildScheduledTripRegistrationEmail(
  parts: ScheduledTripEmailParts,
): { subject: string; shopText: string; diverText: string } {
  const {
    shopName, tripTitle, tripDates, addonLabels, roomLabel, notes,
    diverName, diverEmail, estimateTotal, currencyLabel,
  } = parts

  const e = t.emails.scheduledTripReg
  const who = diverName.trim() || diverEmail
  const addons = list(addonLabels)
  const room = roomLabel || t.emails.common.none
  const datesLine = tripDates ? e.datesKnown(tripDates) : e.datesUnknown
  const estimateLine = money(estimateTotal, currencyLabel)
  const subject = e.subject(shopName, tripTitle)

  const shopText = [
    e.shopRegistered(who, tripTitle),
    '',
    datesLine,
    e.addons(addons),
    e.room(room),
    e.shopDiverNotes(notes || t.emails.common.dash),
    e.shopDiverEmail(diverEmail),
    '',
    e.estimate(estimateLine),
    e.shopEstimateNote,
    '',
    t.emails.cancellation.signoff(shopName),
  ].join('\n')

  const diverText = [
    e.diverGreeting(who),
    '',
    e.diverIntro(tripTitle, shopName),
    '',
    datesLine,
    e.addons(addons),
    e.room(room),
    '',
    e.estimate(estimateLine),
    e.diverEstimateNote,
    '',
    e.diverQuestions,
    '',
    t.emails.common.thanks,
    shopName,
  ].join('\n')

  return { subject, shopText, diverText }
}
