import { describe, it, expect } from 'vitest'
import {
  buildWalkInAccountEmail, buildTermsRequestEmail, termsConsentUrl,
  TERMS_CONSENT_TOKEN_DAYS,
} from './terms-consent-email.ts'

const TOKEN = '11111111-2222-3333-4444-555555555555'

describe('termsConsentUrl', () => {
  it('points at the public accept page with the token in the query', () => {
    const url = termsConsentUrl(TOKEN)
    expect(url).toContain('/accept-terms?token=')
    expect(url).toContain(TOKEN)
  })
})

describe('buildWalkInAccountEmail', () => {
  const base = { name: 'Jane Diver', email: 'jane@example.com', eventTitle: null, acceptUrl: null }

  it('carries the consent link and its expiry when one was minted', () => {
    const { text } = buildWalkInAccountEmail({ ...base, acceptUrl: termsConsentUrl(TOKEN) })
    expect(text).toContain(TOKEN)
    expect(text).toContain(String(TERMS_CONSENT_TOKEN_DAYS))
  })

  // Minting the token is best-effort inside the edge function: an account with
  // no consent link beats no account at all.
  it('still reads as a complete email when no link was minted', () => {
    const { subject, text } = buildWalkInAccountEmail(base)
    expect(subject).toBeTruthy()
    expect(text).toContain('Jane Diver')
    expect(text).toContain('jane@example.com')
    expect(text).not.toContain('/accept-terms')
    // No dangling "open this link" lead-in with nothing after it.
    expect(text).not.toMatch(/tap "I agree"/)
  })

  it('mentions the event only when there is a registration to reference', () => {
    const withEvent = buildWalkInAccountEmail({ ...base, eventTitle: 'Green Island Fun Dive' })
    expect(withEvent.text).toContain('Green Island Fun Dive')
    expect(buildWalkInAccountEmail(base).text).not.toMatch(/no further action/i)
  })

  it('never leaves a blank line at the very end', () => {
    const { text } = buildWalkInAccountEmail({ ...base, acceptUrl: termsConsentUrl(TOKEN) })
    expect(text.endsWith('\n')).toBe(false)
    expect(text.trimEnd()).toBe(text)
  })
})

describe('buildTermsRequestEmail', () => {
  it('is a self-contained ask with the link and the expiry', () => {
    const { subject, text } = buildTermsRequestEmail({
      name: 'Jane Diver', acceptUrl: termsConsentUrl(TOKEN),
    })
    expect(subject).toBeTruthy()
    expect(text).toContain('Jane Diver')
    expect(text).toContain(TOKEN)
    expect(text).toContain(String(TERMS_CONSENT_TOKEN_DAYS))
    // It must not talk about taking over an account — that is the walk-in email.
    expect(text).not.toMatch(/forgot-password/)
  })
})
