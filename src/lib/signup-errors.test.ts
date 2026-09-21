import { describe, it, expect } from 'vitest'
import { readSignupFailure } from './signup-errors'
import { t } from '../i18n'

const FALLBACK = 'could not do the thing'

/** A rejection in the shape supabase-js actually produces. */
function httpError(status: number, body: unknown) {
  const error = new Error('Edge Function returned a non-2xx status code') as Error & { context?: unknown }
  error.name = 'FunctionsHttpError'
  error.context = {
    status,
    json: async () => {
      if (body === undefined) throw new Error('not json')
      return body
    },
  }
  return error
}

function transportError(name: 'FunctionsFetchError' | 'FunctionsRelayError') {
  const error = new Error('Failed to send a request to the Edge Function') as Error & { context?: unknown }
  error.name = name
  return error
}

describe('readSignupFailure', () => {
  it('flags a taken address by code, so the caller can offer a sign-in link', async () => {
    const f = await readSignupFailure(httpError(409, { error: 'email already registered', code: 'email_exists' }), FALLBACK)
    expect(f).toEqual({ message: t.auth.emailTaken, emailTaken: true, captchaFailed: false })
  })

  // create-registration predates the code and says so in prose.
  it.each([
    'User already registered',
    'A user with this email address has already been registered',
    'email already exists',
  ])('flags a taken address reported as prose: %s', async (wire) => {
    const f = await readSignupFailure(httpError(400, { error: wire }), FALLBACK)
    expect(f.emailTaken).toBe(true)
    expect(f.message).toBe(t.auth.emailTaken)
  })

  // The flag is what lets a caller holding a live widget re-challenge and try
  // again instead of showing the diver a rejection they cannot act on — the
  // token was stale or spent, not wrong.
  it('translates a captcha rejection and flags it as retryable', async () => {
    const f = await readSignupFailure(httpError(403, { error: 'captcha verification failed' }), FALLBACK)
    expect(f.message).toBe(t.auth.captchaFailed)
    expect(f.captchaFailed).toBe(true)
  })

  it('flags nothing else as a captcha failure', async () => {
    for (const wire of ['event not found', 'too many signup attempts, try again later', 'boom']) {
      expect((await readSignupFailure(httpError(400, { error: wire }), FALLBACK)).captchaFailed).toBe(false)
    }
  })

  // What a resumed guest draft used to post: the password is deliberately
  // never persisted, so the request arrived without one and the diver was told
  // only "registration failed".
  it('names the missing credentials instead of a generic failure', async () => {
    const f = await readSignupFailure(
      httpError(400, { error: 'email and password required for guest path' }), FALLBACK)
    expect(f.message).toBe(t.auth.missingCredentials)
  })

  it('translates a rate-limit rejection, by body and by status alone', async () => {
    expect((await readSignupFailure(httpError(429, { error: 'too many signup attempts, try again later' }), FALLBACK)).message)
      .toBe(t.auth.tooManyAttempts)
    expect((await readSignupFailure(httpError(429, undefined), FALLBACK)).message)
      .toBe(t.auth.tooManyAttempts)
  })

  it('translates a missing event', async () => {
    const f = await readSignupFailure(httpError(404, { error: 'event not found' }), FALLBACK)
    expect(f.message).toBe(t.auth.eventGone)
  })

  it.each(['FunctionsFetchError', 'FunctionsRelayError'] as const)(
    'names the connection for %s, rather than blaming what the diver typed',
    async (name) => {
      const f = await readSignupFailure(transportError(name), FALLBACK)
      expect(f).toEqual({ message: t.auth.offline, emailTaken: false, captchaFailed: false })
    },
  )

  // The whole point: a handler string written for a log never reaches a diver.
  it('falls back to the caller copy for anything unrecognized', async () => {
    for (const wire of ['rate-limit check failed', 'invalid json', 'boom']) {
      const f = await readSignupFailure(httpError(500, { error: wire }), FALLBACK)
      expect(f.message).toBe(FALLBACK)
    }
  })

  it('never leaks the raw supabase-js message', async () => {
    const f = await readSignupFailure(httpError(500, { error: 'relation "x" does not exist' }), FALLBACK)
    expect(f.message).not.toMatch(/non-2xx/i)
    expect(f.message).not.toMatch(/relation/i)
  })

  it('copes with an error carrying no context at all', async () => {
    const f = await readSignupFailure(new Error('bare') as Error & { context?: unknown }, FALLBACK)
    expect(f).toEqual({ message: FALLBACK, emailTaken: false, captchaFailed: false })
  })
})
