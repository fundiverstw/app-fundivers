// Pure helpers for the contact-trusted-partner edge function. Kept apart from
// index.ts so they're vitest-importable (index.ts uses jsr:/npm: specifiers
// vitest can't resolve). Mirrors _shared/partner-connect.ts.

export const TRUSTED_PARTNER_MSG_MAX = 3000

export interface ContactPartnerInput {
  partner_id?: unknown
  message?: unknown
}

export interface ContactPartnerRequest {
  partnerId: string
  message: string
}

// Validate + normalise the diver-supplied body. Returns an error string
// (caller turns it into a 400) or the trimmed request.
export function parseContactPartnerInput(
  body: ContactPartnerInput,
): { error: string } | { request: ContactPartnerRequest } {
  const partnerId = typeof body.partner_id === 'string' ? body.partner_id.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!partnerId) return { error: 'Pick a partner to contact.' }
  if (!message) return { error: 'Write a short message first.' }
  if (message.length > TRUSTED_PARTNER_MSG_MAX) return { error: 'Message is too long.' }
  return { request: { partnerId, message } }
}

export interface PartnerEmailParts {
  shopName: string
  partnerName: string
  diverName: string
  diverEmail: string
  message: string
}

// The email the partner receives — plain text, sent from the shop address with
// the diver's message wrapped so the partner knows the shop brokered it and can
// reply straight to the diver (reply-to is set to the diver on the transport).
export function buildTrustedPartnerEmail(parts: PartnerEmailParts): { subject: string; text: string } {
  const { shopName, partnerName, diverName, diverEmail, message } = parts
  const who = diverName.trim() || diverEmail
  const subject = `${shopName} — introducing a diver headed your way`
  const lines = [
    `Hi ${partnerName},`,
    '',
    `${who}, a diver with ${shopName}, is planning a trip your way and would like to get in touch. ` +
      `Their message is below — just reply to this email to reach them directly at ${diverEmail}. ` +
      `We're cc'd so we can help if needed.`,
    '',
    '———',
    message,
    '———',
    '',
    'Thanks,',
    shopName,
  ]
  return { subject, text: lines.join('\n') }
}
