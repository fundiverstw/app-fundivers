// Pure helpers for the partner-connect edge function. Kept apart from
// index.ts so they're vitest-importable (index.ts uses jsr:/npm:
// specifiers that vitest can't resolve). See create-registration/handler.ts
// for the same split.

import { t } from "./i18n.ts"

export const PARTNER_CONNECT_MAX = { destination: 200, note: 2000 } as const

export interface PartnerConnectInput {
  destination?: unknown
  note?: unknown
}

export interface PartnerConnectRequest {
  destination: string
  note: string
}

// Validate + normalise the diver-supplied body. Returns an error string
// (caller turns it into a 400) or the trimmed request.
export function parsePartnerConnectInput(
  body: PartnerConnectInput,
): { error: string } | { request: PartnerConnectRequest } {
  const destination = typeof body.destination === 'string' ? body.destination.trim() : ''
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (!destination) return { error: t.emails.errors.tellUsDestination }
  if (destination.length > PARTNER_CONNECT_MAX.destination) return { error: t.emails.errors.destinationTooLong }
  if (note.length > PARTNER_CONNECT_MAX.note) return { error: t.emails.errors.noteTooLong }
  return { request: { destination, note } }
}

export interface PartnerConnectEmailParts {
  diverName: string
  diverEmail: string
  destination: string
  note: string
}

// Builds the email the shop receives. Plain text only — it lands in the
// shop's Gmail inbox, not a diver-facing template.
export function buildPartnerConnectEmail(parts: PartnerConnectEmailParts): { subject: string; text: string } {
  const { diverName, diverEmail, destination, note } = parts
  const who = diverName.trim() || diverEmail
  const subject = `Partner Connect — ${who} wants a rec for ${destination}`
  const lines = [
    `${who} is looking for a vetted dive-shop recommendation.`,
    '',
    `Diver: ${who}`,
    `Email: ${diverEmail}`,
    `Destination: ${destination}`,
    `Note: ${note || '(none)'}`,
  ]
  return { subject, text: lines.join('\n') }
}
