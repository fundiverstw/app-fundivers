// Pure helpers for the register-package edge function: request parsing and the
// recommendation email sent to the partner shop + the diver. Kept apart from
// index.ts so vitest can import them (index.ts uses jsr:/npm: specifiers).
// Mirrors _shared/trusted-partners.ts.

import { t } from "./i18n.ts"

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

  if (!packageId) return { error: t.emails.errors.pickPackage }
  if (!tierId) return { error: t.emails.errors.chooseTier }
  if (!preferredStart || !preferredEnd) return { error: t.emails.errors.pickDates }
  if (preferredEnd <= preferredStart) return { error: t.emails.errors.endAfterStart }
  if (notes.length > PACKAGE_NOTES_MAX) return { error: t.emails.errors.notesTooLong }

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
const list = (items: string[], noneLabel: string) => (items.length ? items.join(', ') : noneLabel)

/**
 * The recommendation emails. Two subjects and two bodies.
 *
 * The PARTNER copy stays in English on purpose: it goes to a third-party dive
 * shop abroad, for whom the deployment's shop-facing language is meaningless.
 * The DIVER copy is translated — that reader is the shop's own customer.
 */
export function buildPackageRegistrationEmail(
  parts: PackageEmailParts,
): { partnerSubject: string; diverSubject: string; partnerText: string; diverText: string } {
  const {
    shopName, partnerName, productTitle, tierName, addonLabels, roomLabel,
    preferredStart, preferredEnd, nights, notes, diverName, diverEmail,
    estimateTotal, currencyLabel,
  } = parts

  const d = t.emails.packageReg
  const who = diverName.trim() || diverEmail
  const estimateLine = money(estimateTotal, currencyLabel)

  // Partner-facing values: English, always.
  const enAddons = list(addonLabels, 'none')
  const enRoom = roomLabel || 'none'
  const partnerSubject = `${shopName} — a diver for ${productTitle} (${tierName})`
  const disclaimer =
    'Please note this is an estimate only — the final cost will be determined by your shop.'

  // Diver-facing values: the deployment's shop language.
  const addons = list(addonLabels, t.emails.common.none)
  const room = roomLabel || t.emails.common.none
  const diverSubject = d.diverSubject(shopName, productTitle, tierName)

  const partnerText = [
    `Hi ${partnerName},`,
    '',
    `Hello from ${shopName}. We have a diver we are recommending to your shop for ` +
      `${productTitle}, specifically ${tierName}, with ${enAddons} and room option: ${enRoom}.`,
    '',
    `Preferred dates: ${preferredStart} to ${preferredEnd} (${nights} night${nights === 1 ? '' : 's'})`,
    `Add-ons: ${enAddons}`,
    `Room option: ${enRoom}`,
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
    d.greeting(who),
    '',
    d.intro(shopName, partnerName, productTitle, tierName),
    '',
    d.dates(preferredStart, preferredEnd, nights),
    d.addons(addons),
    d.room(room),
    '',
    d.estimate(estimateLine),
    d.disclaimer,
    '',
    d.reachOut(partnerName, diverEmail),
    '',
    t.emails.common.thanks,
    shopName,
  ].join('\n')

  return { partnerSubject, diverSubject, partnerText, diverText }
}
