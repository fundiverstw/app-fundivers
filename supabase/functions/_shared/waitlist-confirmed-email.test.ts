import { describe, it, expect } from 'vitest'
import { buildWaitlistConfirmedEmail } from './waitlist-confirmed-email'
import { siteConfig } from '../../../fundive.config.ts'
import { t } from './i18n.ts'

// Asserted against the catalog, not against English literals: the email renders
// in whatever language the deployment picked, so a hardcoded expectation here
// would pass on an `en` shop and silently miss a broken zh-TW / ja build.
const e = t.emails.waitlistConfirmed

describe('buildWaitlistConfirmedEmail', () => {
  it('names the event in the subject and says the booking is confirmed', () => {
    const { subject, text } = buildWaitlistConfirmedEmail('Green Island Trip', '2026-08-15')
    expect(subject).toBe(e.subject('Green Island Trip'))
    expect(text).toContain(e.goodNews('Green Island Trip'))
    expect(text).toContain(e.when('2026-08-15'))
    expect(text).toContain(siteConfig.identity.shopName)
  })

  it('points the diver at the app rather than asking them to accept anything', () => {
    // The automatic offer email asks for a reply before a deadline; this one is
    // the opposite case — the shop already gave them the seat.
    const { text } = buildWaitlistConfirmedEmail('Kenting fun dive', null)
    expect(text).toContain(e.nextSteps(siteConfig.urls.app))
  })

  it('drops the date line entirely when the event has no date yet', () => {
    // A course with no scheduled days would otherwise print the label and
    // nothing after it. `e.when('')` is exactly that empty-labelled line.
    const { text } = buildWaitlistConfirmedEmail('Open Water course', null)
    expect(text).not.toContain(e.when(''))
    expect(text).toContain(e.goodNews('Open Water course'))
  })

  it('treats a whitespace-only date the same as a missing one', () => {
    const { text } = buildWaitlistConfirmedEmail('Open Water course', '   ')
    expect(text).not.toContain(e.when(''))
    expect(text).not.toContain(e.when('   '))
  })

  it('falls back to a generic noun when the title is blank', () => {
    const { subject, text } = buildWaitlistConfirmedEmail('   ', '2026-08-15')
    expect(subject).toBe(e.subject(e.fallbackTitle))
    expect(text).toContain(e.goodNews(e.fallbackTitle))
  })
})
