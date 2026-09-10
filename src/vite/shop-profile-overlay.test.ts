import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  SKIP_ENV, applyShopProfile, fetchShopProfileOverlay,
  type ShopProfileOverlay,
} from './shop-profile-overlay'
import { SUPPORTED_LANGUAGES, type SiteConfig } from '../config/site'
import { siteConfig } from '../config/site'

const overlay = (over: Partial<ShopProfileOverlay> = {}): ShopProfileOverlay =>
  ({ currency: null, language: null, ...over })

const base = siteConfig as SiteConfig

// Derived from the config rather than written down, so these hold in a fork
// whose own currency or language happens to be the one a test picked.
const otherCurrency = base.locale.currency === 'JPY' ? 'USD' : 'JPY'
const otherLanguage = base.locale.language === 'ja' ? 'zh-TW' : 'ja'

describe('applyShopProfile', () => {
  // A shop that has never opened the page must build exactly as it does today.
  it('changes nothing when there is no row', () => {
    const out = applyShopProfile(base, null, SUPPORTED_LANGUAGES)
    expect(out.config).toBe(base)
    expect(out.changes).toEqual([])
  })

  it('changes nothing when every field is empty', () => {
    const out = applyShopProfile(base, overlay(), SUPPORTED_LANGUAGES)
    expect(out.config).toBe(base)
    expect(out.changes).toEqual([])
  })

  it('changes nothing when the choice already matches the config', () => {
    const out = applyShopProfile(base, overlay({
      currency: base.locale.currency,
      language: base.locale.language,
    }), SUPPORTED_LANGUAGES)
    expect(out.config).toBe(base)
  })

  it('applies a currency the shop chose, and reports it', () => {
    const out = applyShopProfile(base, overlay({ currency: otherCurrency }), SUPPORTED_LANGUAGES)
    expect(out.config.locale.currency).toBe(otherCurrency)
    expect(out.changes).toEqual([
      { field: 'locale.currency', from: base.locale.currency, to: otherCurrency },
    ])
    // The original is untouched — the config object is shared with the plugin.
    expect(base.locale.currency).not.toBe(otherCurrency)
  })

  it('applies a language the build ships a catalog for', () => {
    const out = applyShopProfile(base, overlay({ language: otherLanguage }), SUPPORTED_LANGUAGES)
    expect(out.config.locale.language).toBe(otherLanguage)
  })

  // Honouring a language with no catalog would build an app with no strings in
  // it — worse than ignoring the choice and leaving the drift visible.
  it('ignores a language this build has no catalog for', () => {
    const out = applyShopProfile(base, overlay({ language: 'kl' }), SUPPORTED_LANGUAGES)
    expect(out.config).toBe(base)
    expect(out.changes).toEqual([])
  })

  it('treats whitespace as no preference rather than as a blank value', () => {
    const out = applyShopProfile(base, overlay({ currency: '   ' }), SUPPORTED_LANGUAGES)
    expect(out.config).toBe(base)
  })

  it('leaves a value the shop did not choose alone while changing one it did', () => {
    const out = applyShopProfile(base, overlay({ currency: otherCurrency }), SUPPORTED_LANGUAGES)
    expect(out.config.locale.language).toBe(base.locale.language)
    expect(out.config.locale.timezone).toBe(base.locale.timezone)
  })

  it('applies currency and language together', () => {
    const out = applyShopProfile(
      base,
      overlay({ currency: otherCurrency, language: otherLanguage }),
      SUPPORTED_LANGUAGES,
    )
    expect(out.changes.map(c => c.field)).toEqual(['locale.currency', 'locale.language'])
  })
})

describe('fetchShopProfileOverlay', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('asks nothing when there are no Supabase credentials', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await fetchShopProfileOverlay({})).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('asks nothing when the skip flag is set', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await fetchShopProfileOverlay({
      [SKIP_ENV]: '1',
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'k',
    })).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reads the row with the anon key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ currency: 'JPY', language: 'ja' }],
    }))
    const out = await fetchShopProfileOverlay({
      VITE_SUPABASE_URL: 'https://x.supabase.co/',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })
    expect(out).toEqual({ currency: 'JPY', language: 'ja' })

    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://x.supabase.co/rest/v1/shop_profile?select=currency,language&limit=1')
    expect((init as RequestInit).headers).toMatchObject({ apikey: 'anon-key' })
  })

  it('builds from the config when the table has no row yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    expect(await fetchShopProfileOverlay({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'k',
    })).toBeNull()
  })

  // The whole point is that the deploy applies what the shop chose. A build
  // that could not find out must not quietly ship the previous value.
  it('fails the build when it cannot reach the database', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    await expect(fetchShopProfileOverlay({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'k',
    })).rejects.toThrow(/ECONNREFUSED[\s\S]*FUNDIVE_SKIP_PROFILE_SYNC/)
  })

  // Failing here would mean the deploy that introduces this feature could not
  // be built until its own migration had been pushed.
  it('builds from the config when the database has no shop_profile table yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    vi.stubGlobal('console', { ...console, warn: vi.fn() })
    expect(await fetchShopProfileOverlay({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'k',
    })).toBeNull()
  })

  it('fails the build on an error response, naming the status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    await expect(fetchShopProfileOverlay({
      VITE_SUPABASE_URL: 'https://x.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'k',
    })).rejects.toThrow(/HTTP 403/)
  })
})
