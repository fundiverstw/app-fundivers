// Pure helpers for the register-scheduled-trip edge function: request parsing
// and the confirmation email sent to the shop + the diver. Kept apart from
// index.ts so vitest can import them (index.ts uses jsr:/npm: specifiers).
// Mirrors _shared/package-registration-email.ts (minus the partner/kickback).

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

  if (!scheduledTripId) return { error: 'Pick a trip first.' }
  if (notes.length > SCHEDULED_TRIP_NOTES_MAX) return { error: 'Notes are too long.' }

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
const list = (items: string[]) => (items.length ? items.join(', ') : 'none')

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

  const who = diverName.trim() || diverEmail
  const addons = list(addonLabels)
  const room = roomLabel || 'none'
  const datesLine = tripDates ? `Dates: ${tripDates}` : 'Dates: (see listing)'
  const estimateLine = money(estimateTotal, currencyLabel)
  const subject = `${shopName} — new trip registration: ${tripTitle}`

  const shopText = [
    `${who} registered for ${tripTitle}.`,
    '',
    datesLine,
    `Add-ons: ${addons}`,
    `Room option: ${room}`,
    `Diver notes: ${notes || '—'}`,
    `Diver email: ${diverEmail} (reply to this email to reach them directly)`,
    '',
    `Estimated cost: ${estimateLine}`,
    'This is the diver-facing estimate — confirm the final cost with them directly.',
    '',
    '— ' + shopName,
  ].join('\n')

  const diverText = [
    `Hi ${who},`,
    '',
    `Thanks for registering for ${tripTitle} with ${shopName}. Here's what we've got:`,
    '',
    datesLine,
    `Add-ons: ${addons}`,
    `Room option: ${room}`,
    '',
    `Estimated cost: ${estimateLine}`,
    'This is an estimate — we\'ll confirm the final cost and payment details with you.',
    '',
    'Any questions, just reply here.',
    '',
    'Thanks,',
    shopName,
  ].join('\n')

  return { subject, shopText, diverText }
}
