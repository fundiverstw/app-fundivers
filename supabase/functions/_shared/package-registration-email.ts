// Pure helpers for the register-package edge function: request parsing and the
// recommendation email sent to the partner shop + the diver. Kept apart from
// index.ts so vitest can import them (index.ts uses jsr:/npm: specifiers).
// Mirrors _shared/trusted-partners.ts.

export const PACKAGE_NOTES_MAX = 3000

export interface RegisterPackageInput {
  package_id?: unknown
  tier_id?: unknown
  preferred_start?: unknown
  preferred_end?: unknown
  addon_ids?: unknown
  room_id?: unknown
  notes?: unknown
}

export interface RegisterPackageRequest {
  packageId: string
  tierId: string
  preferredStart: string
  preferredEnd: string
  addonIds: string[]
  roomId: string | null
  notes: string
}

const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// Validate + normalise the diver-supplied body. Returns an error string (caller
// turns it into a 400) or the trimmed request.
export function parseRegisterPackageInput(
  body: RegisterPackageInput,
): { error: string } | { request: RegisterPackageRequest } {
  const packageId = typeof body.package_id === 'string' ? body.package_id.trim() : ''
  const tierId = typeof body.tier_id === 'string' ? body.tier_id.trim() : ''
  const preferredStart = isYmd(body.preferred_start) ? body.preferred_start : ''
  const preferredEnd = isYmd(body.preferred_end) ? body.preferred_end : ''
  const roomId = typeof body.room_id === 'string' && body.room_id.trim() ? body.room_id.trim() : null
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  const addonIds = Array.isArray(body.addon_ids)
    ? body.addon_ids.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : []

  if (!packageId) return { error: 'Pick a package first.' }
  if (!tierId) return { error: 'Choose a package tier.' }
  if (!preferredStart || !preferredEnd) return { error: 'Pick your preferred dates.' }
  if (preferredEnd <= preferredStart) return { error: 'The end date must be at least one night after the start date.' }
  if (notes.length > PACKAGE_NOTES_MAX) return { error: 'Notes are too long.' }

  return {
    request: { packageId, tierId, preferredStart, preferredEnd, addonIds, roomId, notes },
  }
}

export interface PackageEmailParts {
  shopName: string
  partnerName: string
  productTitle: string
  tierName: string
  addonLabels: string[]
  roomLabel: string | null
  preferredStart: string
  preferredEnd: string
  nights: number
  notes: string
  diverName: string
  diverEmail: string
  estimateTotal: number
  currencyLabel: string
}

const money = (n: number, label: string) => `${label} ${Math.round(n).toLocaleString('en-US')}`
const list = (items: string[]) => (items.length ? items.join(', ') : 'none')

/**
 * The recommendation emails. One subject; a partner-facing body (sent from the
 * shop, reply-to the diver, so the partner knows we brokered it) and a
 * diver-facing confirmation. Both carry the estimate and the "final cost is set
 * by the partner shop" disclaimer.
 */
export function buildPackageRegistrationEmail(
  parts: PackageEmailParts,
): { subject: string; partnerText: string; diverText: string } {
  const {
    shopName, partnerName, productTitle, tierName, addonLabels, roomLabel,
    preferredStart, preferredEnd, nights, notes, diverName, diverEmail,
    estimateTotal, currencyLabel,
  } = parts

  const who = diverName.trim() || diverEmail
  const addons = list(addonLabels)
  const room = roomLabel || 'none'
  const subject = `${shopName} — a diver for ${productTitle} (${tierName})`
  const estimateLine = money(estimateTotal, currencyLabel)
  const disclaimer =
    'Please note this is an estimate only — the final cost will be determined by your shop.'

  const partnerText = [
    `Hi ${partnerName},`,
    '',
    `Hello from ${shopName}. We have a diver we are recommending to your shop for ` +
      `${productTitle}, specifically ${tierName}, with ${addons} and room option: ${room}.`,
    '',
    `Preferred dates: ${preferredStart} to ${preferredEnd} (${nights} night${nights === 1 ? '' : 's'})`,
    `Add-ons: ${addons}`,
    `Room option: ${room}`,
    `Diver notes: ${notes || '—'}`,
    `Diver email: ${diverEmail} (just reply to this email to reach them directly)`,
    '',
    `Estimated cost: ${estimateLine}`,
    disclaimer,
    '',
    'Please let us know if we can be of further assistance.',
    '',
    'Thanks,',
    shopName,
  ].join('\n')

  const diverText = [
    `Hi ${who},`,
    '',
    `Thanks for registering interest through ${shopName}. We've recommended you to ` +
      `${partnerName} for ${productTitle} (${tierName}). Here's what we sent them:`,
    '',
    `Preferred dates: ${preferredStart} to ${preferredEnd} (${nights} night${nights === 1 ? '' : 's'})`,
    `Add-ons: ${addons}`,
    `Room option: ${room}`,
    '',
    `Estimated cost: ${estimateLine}`,
    'This is an estimate only — the final cost will be determined by the partner shop.',
    '',
    `${partnerName} may reach out to you directly at ${diverEmail}. Any questions, just reply here.`,
    '',
    'Thanks,',
    shopName,
  ].join('\n')

  return { subject, partnerText, diverText }
}
