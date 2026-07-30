// Pure builders for the two emails that carry an Accept-the-Terms link. Kept
// apart from index.ts so they're vitest-importable (index.ts uses jsr:/npm:
// specifiers). Same split as event-cancellation-email.ts.

import { siteConfig } from "../../../fundive.config.ts"
import { t } from "./i18n.ts"

/** How long an emailed consent link stays redeemable. */
export const TERMS_CONSENT_TOKEN_DAYS = 90

export function termsConsentUrl(token: string): string {
  return `${siteConfig.urls.app}/accept-terms?token=${token}`
}

/**
 * The courtesy email for an account the shop minted on a diver's behalf.
 *
 * `acceptUrl` is optional: the account is still created and the email still
 * sent if minting a consent token failed, because a missing paragraph is a far
 * better outcome than a diver with no account. The admin can send the request
 * on its own afterwards.
 */
export function buildWalkInAccountEmail(args: {
  name: string
  email: string
  eventTitle: string | null
  acceptUrl: string | null
}): { subject: string; text: string } {
  const w = t.emails.walkInAccount
  const c = t.emails.termsConsent
  const shop = siteConfig.identity.shopName
  const lines = [
    w.greeting(args.name),
    '',
    w.intro(shop),
    '',
  ]
  if (args.acceptUrl) {
    lines.push(c.inlineIntro, '', c.linkLead, c.link(args.acceptUrl), '', c.expiryNote(TERMS_CONSENT_TOKEN_DAYS), '')
  }
  lines.push(
    w.takeOverIntro,
    '',
    w.step1(siteConfig.urls.app),
    w.step2(args.email),
    w.step3,
    '',
    w.takeOverOutro,
    '',
  )
  // Only worth saying when there IS a registration to reference; the standalone
  // Create-diver page mints accounts with no event.
  if (args.eventTitle) lines.push(w.noFurtherAction(args.eventTitle), '')
  lines.push(w.signoff(shop))
  return { subject: w.subject(shop), text: lines.join('\n') }
}

/** The consent request on its own, for an account that already exists. */
export function buildTermsRequestEmail(args: {
  name: string
  acceptUrl: string
}): { subject: string; text: string } {
  const c = t.emails.termsConsent
  const shop = siteConfig.identity.shopName
  return {
    subject: c.subject(shop),
    text: [
      c.greeting(args.name),
      '',
      c.standaloneIntro(shop),
      '',
      c.linkLead,
      c.link(args.acceptUrl),
      '',
      c.expiryNote(TERMS_CONSENT_TOKEN_DAYS),
      '',
      c.signoff(shop),
    ].join('\n'),
  }
}
