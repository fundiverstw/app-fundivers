// Pure builder for the event-cancellation email. Kept apart from index.ts
// so it's vitest-importable (index.ts uses jsr:/npm: specifiers). See
// create-registration/handler.ts for the same split.

import { siteConfig } from "../../../fundive.config.ts"
import { t } from "./i18n.ts"

export function buildCancellationEmail(eventTitle: string): { subject: string; text: string } {
  const e = t.emails.cancellation
  const title = eventTitle.trim() || e.fallbackTitle
  return {
    subject: e.subject(title),
    text: [
      e.greeting,
      '',
      e.sorry(title),
      '',
      e.refundNote,
      '',
      e.signoff(siteConfig.identity.shopName),
    ].join('\n'),
  }
}
