import { describe, it, expect } from 'vitest'
import { CAPTCHA_REUSE_MAX_AGE_MS, isTurnstileConfigError } from './turnstile'

describe('isTurnstileConfigError', () => {
  it('flags the site-key and hostname errors that no retry can fix', () => {
    for (const code of ['110100', '110110', '110200', '400020', '400021', '400070']) {
      expect(isTurnstileConfigError(code)).toBe(true)
    }
  })

  it('leaves network, timeout and failed-challenge errors retryable', () => {
    for (const code of ['110600', '110620', '200500', '300030', '600010', '']) {
      expect(isTurnstileConfigError(code)).toBe(false)
    }
  })
})

describe('CAPTCHA_REUSE_MAX_AGE_MS', () => {
  it('stays inside the 300 seconds Cloudflare accepts a token for, with room for the request', () => {
    expect(CAPTCHA_REUSE_MAX_AGE_MS).toBeLessThanOrEqual(270_000)
    expect(CAPTCHA_REUSE_MAX_AGE_MS).toBeGreaterThan(120_000)
  })
})
