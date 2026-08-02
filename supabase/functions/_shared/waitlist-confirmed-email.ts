// Pure builder for the "you're off the waitlist" email. Kept apart from
// index.ts so it's vitest-importable (index.ts uses jsr:/npm: specifiers).
// See event-cancellation-email.ts for the same split.

import { siteConfig } from "../../../fundive.config.ts"
import { t } from "./i18n.ts"

/**
 * The email a diver gets when the shop promotes their waitlisted booking to
 * confirmed. `startDate` is optional because it isn't always knowable: a
 * course derives its date from `course_days`, which can be empty while the
 * shop is still scheduling. A missing date drops the line rather than
 * printing an empty one — the seat is the news, the date is the detail.
 */
export function buildWaitlistConfirmedEmail(
  eventTitle: string,
  startDate: string | null,
): { subject: string; text: string } {
  const e = t.emails.waitlistConfirmed
  const title = eventTitle.trim() || e.fallbackTitle
  const date = (startDate ?? '').trim()
  return {
    subject: e.subject(title),
    text: [
      e.greeting,
      '',
      e.goodNews(title),
      ...(date ? [e.when(date)] : []),
      '',
      e.nextSteps(siteConfig.urls.app),
      '',
      e.signoff(siteConfig.identity.shopName),
    ].join('\n'),
  }
}
