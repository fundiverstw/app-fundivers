import { describe, it, expect } from 'vitest'
import { buildCancellationEmail } from './event-cancellation-email'
import { siteConfig } from '../../../fundive.config.ts'
import { t } from './i18n.ts'

// Asserted against the catalog, not against English literals: the email renders
// in whatever language the deployment picked, so a hardcoded expectation here
// would pass on an `en` shop and silently miss a broken zh-TW / ja build.
const e = t.emails.cancellation

describe('buildCancellationEmail', () => {
  it('names the cancelled event in the subject and body', () => {
    const { subject, text } = buildCancellationEmail('Green Island Trip')
    expect(subject).toBe(e.subject('Green Island Trip'))
    expect(text).toContain('Green Island Trip')
    expect(text).toContain(e.sorry('Green Island Trip'))
    expect(text).toContain(siteConfig.identity.shopName)
  })

  it('falls back to a generic noun when the title is blank', () => {
    const { subject, text } = buildCancellationEmail('   ')
    expect(subject).toBe(e.subject(e.fallbackTitle))
    expect(text).toContain(e.fallbackTitle)
  })
})
