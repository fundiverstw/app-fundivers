import { describe, it, expect } from 'vitest'
import { isSupabaseCacheable } from './sw-cache-policy'

// Pins the H4 cache predicate. Each test exercises one rule the
// policy is trying to enforce; together they describe what the
// service worker is allowed to keep on disk after a session ends.

function makeRequest(opts: { method?: string; headers?: Record<string, string> } = {}): Request {
  return new Request('https://x.example/_test', {
    method:  opts.method  ?? 'GET',
    headers: opts.headers ?? {},
  })
}

describe('isSupabaseCacheable', () => {
  it('caches anon-keyed GETs to /rest/v1/* (no Authorization header)', () => {
    const url = new URL('https://abc.supabase.co/rest/v1/EO_dives?select=*')
    expect(isSupabaseCacheable(url, makeRequest({ headers: { apikey: 'anon-xxx' } }))).toBe(true)
  })

  it('does NOT cache /auth/v1/token responses (auth-token leak)', () => {
    const url = new URL('https://abc.supabase.co/auth/v1/token?grant_type=password')
    expect(isSupabaseCacheable(url, makeRequest({ method: 'POST' }))).toBe(false)
  })

  it('does NOT cache /auth/v1/user responses', () => {
    const url = new URL('https://abc.supabase.co/auth/v1/user')
    expect(isSupabaseCacheable(url, makeRequest())).toBe(false)
  })

  it('does NOT cache GETs that carry an Authorization header (RLS-scoped reads)', () => {
    const url = new URL('https://abc.supabase.co/rest/v1/profiles?id=eq.x')
    expect(isSupabaseCacheable(url, makeRequest({
      headers: { authorization: 'Bearer eyJ...' },
    }))).toBe(false)
  })

  it('does NOT cache non-GETs even to safe paths (POSTs/PATCHes are mutations)', () => {
    const url = new URL('https://abc.supabase.co/rest/v1/EO_dives')
    expect(isSupabaseCacheable(url, makeRequest({ method: 'POST' }))).toBe(false)
    expect(isSupabaseCacheable(url, makeRequest({ method: 'PATCH' }))).toBe(false)
    expect(isSupabaseCacheable(url, makeRequest({ method: 'DELETE' }))).toBe(false)
  })

  it('does NOT cache cross-origin GETs (must be a *.supabase.co host)', () => {
    const url = new URL('https://random.example.com/rest/v1/EO_dives')
    expect(isSupabaseCacheable(url, makeRequest())).toBe(false)
  })

  it('caches anon-keyed GETs to /storage/v1/* (public bucket reads)', () => {
    const url = new URL('https://abc.supabase.co/storage/v1/object/public/cert-cards/dive.jpg')
    expect(isSupabaseCacheable(url, makeRequest({ headers: { apikey: 'anon' } }))).toBe(true)
  })
})
