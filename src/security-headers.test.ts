import { describe, it, expect } from 'vitest'
import { CSP_HEADER, SECURITY_HEADERS, applySecurityHeaders } from './security-headers'

// Pins the H5 CSP shape so a future drive-by change to
// security-headers.ts can't loosen a directive without a test
// reminder that this is the production policy.

describe('CSP_HEADER', () => {
  it('frames are denied via frame-ancestors none (clickjack defence)', () => {
    expect(CSP_HEADER).toContain("frame-ancestors 'none'")
  })

  it('object-src is none (no flash / pdf-embed surface)', () => {
    expect(CSP_HEADER).toContain("object-src 'none'")
  })

  it('script-src allows self + Turnstile only', () => {
    expect(CSP_HEADER).toMatch(/script-src 'self' https:\/\/challenges\.cloudflare\.com/)
  })

  it('connect-src allows self + Supabase + Turnstile + Open-Meteo', () => {
    expect(CSP_HEADER).toMatch(
      /connect-src 'self' https:\/\/\*\.supabase\.co https:\/\/challenges\.cloudflare\.com https:\/\/\*\.open-meteo\.com/,
    )
  })

  it('does NOT include unsafe-eval anywhere (no eval / new Function)', () => {
    expect(CSP_HEADER).not.toContain("'unsafe-eval'")
  })

  it('does NOT include the wildcard https: in script-src (would allow CDN exfil)', () => {
    expect(CSP_HEADER).not.toMatch(/script-src[^;]*\bhttps:\s/)
  })
})

describe('applySecurityHeaders', () => {
  it('sets every header in SECURITY_HEADERS on the response', () => {
    const out = applySecurityHeaders(new Headers({ 'content-type': 'text/html' }))
    for (const [k, v] of SECURITY_HEADERS) {
      expect(out.get(k)).toBe(v)
    }
  })

  it('preserves other headers (content-type, cache-control)', () => {
    const out = applySecurityHeaders(new Headers({
      'content-type':  'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    }))
    expect(out.get('content-type')).toBe('text/html; charset=utf-8')
    expect(out.get('cache-control')).toBe('public, max-age=300')
  })

  it('does not mutate the input Headers', () => {
    const input = new Headers({ 'content-type': 'text/html' })
    applySecurityHeaders(input)
    expect(input.get('content-security-policy')).toBeNull()
  })

  it('X-Frame-Options is DENY (legacy belt-and-braces with frame-ancestors)', () => {
    const out = applySecurityHeaders(new Headers())
    expect(out.get('X-Frame-Options')).toBe('DENY')
  })

  it('Referrer-Policy is strict-origin-when-cross-origin', () => {
    const out = applySecurityHeaders(new Headers())
    expect(out.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  })
})
