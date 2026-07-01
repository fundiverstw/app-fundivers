import { describe, it, expect } from 'vitest'
import { buildCancellationEmail } from './event-cancellation-email'
import { siteConfig } from '../../../fundive.config.ts'

describe('buildCancellationEmail', () => {
  it('names the cancelled event in the subject and body', () => {
    const { subject, text } = buildCancellationEmail('Green Island Trip')
    expect(subject).toBe('Cancelled: Green Island Trip')
    expect(text).toContain('Green Island Trip')
    expect(text).toMatch(/cancelled/i)
    expect(text).toContain(siteConfig.identity.shopName)
  })

  it('falls back to a generic noun when the title is blank', () => {
    const { subject, text } = buildCancellationEmail('   ')
    expect(subject).toBe('Cancelled: your dive')
    expect(text).toContain('your dive')
  })
})
