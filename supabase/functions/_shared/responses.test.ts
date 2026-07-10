import { describe, it, expect, vi } from 'vitest'
import { corsHeaders, jsonResponse, safeError, bearerToken } from './responses'
import { t } from './i18n.ts'
import { siteConfig } from '../../../fundive.config.ts'

// happy-dom strips the `Origin` header on Request construction (it's
// a forbidden request-header in browser contexts), so we hand the
// helper a tiny stub that responds to the only API it touches:
// req.headers.get("Origin").
function reqFrom(origin: string | null): Request {
  return {
    headers: {
      get: (name: string) => name.toLowerCase() === 'origin' ? origin : null,
    },
  } as unknown as Request
}

describe('corsHeaders (audit M4)', () => {
  it('echoes the production origin when it matches the allowlist', () => {
    const h = corsHeaders(reqFrom(siteConfig.urls.app))
    expect(h['Access-Control-Allow-Origin']).toBe(siteConfig.urls.app)
  })

  it('echoes localhost dev origins', () => {
    expect(corsHeaders(reqFrom('http://localhost:5173'))['Access-Control-Allow-Origin'])
      .toBe('http://localhost:5173')
    expect(corsHeaders(reqFrom('http://127.0.0.1:5173'))['Access-Control-Allow-Origin'])
      .toBe('http://127.0.0.1:5173')
  })

  it('omits the Allow-Origin header for non-allowlisted origins (CORS denied)', () => {
    const h = corsHeaders(reqFrom('https://evil.example'))
    expect(h['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('omits Allow-Origin for an empty / missing Origin', () => {
    const h = corsHeaders(reqFrom(null))
    expect(h['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('always sets Vary: Origin so caches do not reuse one origin\'s response for another', () => {
    expect(corsHeaders(reqFrom(siteConfig.urls.app)).Vary).toBe('Origin')
    expect(corsHeaders(reqFrom('https://evil.example')).Vary).toBe('Origin')
  })

  it('declares the standard Allow-Headers and Allow-Methods', () => {
    const h = corsHeaders(reqFrom(siteConfig.urls.app))
    expect(h['Access-Control-Allow-Headers']).toMatch(/authorization/)
    expect(h['Access-Control-Allow-Headers']).toMatch(/apikey/)
    expect(h['Access-Control-Allow-Methods']).toBe('POST, OPTIONS')
  })
})

describe('jsonResponse (audit M4)', () => {
  it('sets content-type + CORS headers + status', async () => {
    const r = jsonResponse(reqFrom(siteConfig.urls.app), { ok: true }, 201)
    expect(r.status).toBe(201)
    expect(r.headers.get('content-type')).toBe('application/json')
    expect(r.headers.get('access-control-allow-origin')).toBe(siteConfig.urls.app)
    expect(await r.json()).toEqual({ ok: true })
  })
})

describe('safeError (audit M4)', () => {
  it('maps SQLSTATE 23505 (unique violation) to a safe public message', () => {
    const msg = safeError({ code: '23505', message: 'duplicate key value violates unique constraint "profiles_pkey"' }, 'fallback')
    // Same catalog string the SPA shows for this SQLSTATE (src/lib/errors.ts).
    expect(msg).toBe(t.errors.alreadyInUse)
    // Audit M4: the raw Postgres text must not leak the constraint / table name.
    expect(msg).not.toMatch(/profiles_pkey|duplicate key|constraint/i)
  })

  it('maps SQLSTATE 42501 (RLS / insufficient privilege) to a safe message', () => {
    const msg = safeError({ code: '42501', message: 'new row violates row-level security policy "credits: admin insert"' }, 'fallback')
    expect(msg).toBe(t.errors.permissionDenied)
    expect(msg).not.toMatch(/row-level security|credits: admin insert/i)
  })

  it('falls back to the caller fallback for unknown SQLSTATEs', () => {
    expect(safeError({ code: '22P02', message: 'invalid input syntax for type uuid: "x"' }, 'bad input'))
      .toBe('bad input')
  })

  it('passes through messages from non-Postgres errors (plain throw)', () => {
    expect(safeError(new Error('captcha verification failed'), 'fallback'))
      .toBe('captcha verification failed')
  })

  it('returns fallback for null / undefined / empty error', () => {
    expect(safeError(null, 'fallback')).toBe('fallback')
    expect(safeError(undefined, 'fallback')).toBe('fallback')
    expect(safeError({}, 'fallback')).toBe('fallback')
  })

  it('logs the suppressed message to console.error for debugging', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    safeError({ code: '23505', message: 'unique constraint xyz' }, 'fb')
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('safeError suppressed [23505]:'),
      expect.stringContaining('unique constraint xyz'),
    )
    spy.mockRestore()
  })
})

function reqWithAuth(auth: string | null): Request {
  return {
    headers: {
      get: (name: string) => name.toLowerCase() === 'authorization' ? auth : null,
    },
  } as unknown as Request
}

describe('bearerToken', () => {
  it('returns the token from a Bearer header', () => {
    expect(bearerToken(reqWithAuth('Bearer abc.def.ghi'))).toBe('abc.def.ghi')
  })

  it('returns null when the Authorization header is absent', () => {
    expect(bearerToken(reqWithAuth(null))).toBeNull()
  })

  it('returns null for a non-Bearer scheme', () => {
    expect(bearerToken(reqWithAuth('Basic abc'))).toBeNull()
  })

  it('returns an empty string for a bare "Bearer " prefix', () => {
    expect(bearerToken(reqWithAuth('Bearer '))).toBe('')
  })
})
