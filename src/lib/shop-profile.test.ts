import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_STANDARDS_ORG, NO_SHOP_PROFILE, configDrift, standardsOrgOf,
  type ShopProfile,
} from './shop-profile'
import { siteConfig } from '../config/site'

const profile = (over: Partial<ShopProfile> = {}): ShopProfile => ({ ...NO_SHOP_PROFILE, ...over })

describe('standardsOrgOf', () => {
  it('uses the shop’s choice', () => {
    expect(standardsOrgOf(profile({ standardsOrg: 'SSI' }))).toBe('SSI')
  })

  // PADI is the hub every other agency's rungs point at, so it is the one
  // vocabulary guaranteed to name every rung.
  it('falls back to the hub agency when the shop has not chosen', () => {
    expect(standardsOrgOf(NO_SHOP_PROFILE)).toBe(DEFAULT_STANDARDS_ORG)
    expect(DEFAULT_STANDARDS_ORG).toBe('PADI')
  })
})

describe('configDrift', () => {
  // The page's whole honesty rests on this: currency and language are compiled
  // in, so a saved choice that differs from the build has NOT taken effect and
  // the admin has to be told, with the line to change.
  it('is empty when the shop has expressed no preference', () => {
    expect(configDrift(NO_SHOP_PROFILE)).toEqual([])
  })

  it('is empty when the choice already matches the build', () => {
    expect(configDrift(profile({
      currency: siteConfig.locale.currency,
      language: siteConfig.locale.language,
    }))).toEqual([])
  })

  it('reports a currency the build is not running, with the config line', () => {
    const drift = configDrift(profile({ currency: 'JPY' }))
    expect(drift).toHaveLength(1)
    expect(drift[0]).toEqual({
      field: 'currency',
      chosen: 'JPY',
      running: siteConfig.locale.currency,
    })
  })

  it('reports a language the build is not running', () => {
    const other = siteConfig.locale.language === 'ja' ? 'en' : 'ja'
    const drift = configDrift(profile({ language: other }))
    expect(drift).toEqual([
      { field: 'language', chosen: other, running: siteConfig.locale.language },
    ])
  })

  it('reports both when both differ', () => {
    const other = siteConfig.locale.language === 'ja' ? 'en' : 'ja'
    expect(configDrift(profile({ currency: 'XXX', language: other })).map(d => d.field))
      .toEqual(['currency', 'language'])
  })
})

describe('logoUrlOf', () => {
  it('falls back to the bundled asset when nothing is uploaded', async () => {
    const { logoUrlOf } = await import('./shop-profile')
    expect(logoUrlOf(NO_SHOP_PROFILE)).toBe(siteConfig.assets.logo)
  })

  it('asks storage for a public URL when the shop has uploaded one', async () => {
    vi.resetModules()
    const getPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.test/logo-1.png' } })
    vi.doMock('./supabase', () => ({
      supabase: { storage: { from: () => ({ getPublicUrl }) } },
    }))
    const { logoUrlOf } = await import('./shop-profile')
    expect(logoUrlOf(profile({ logoPath: 'logo-1.png' }))).toBe('https://cdn.test/logo-1.png')
    expect(getPublicUrl).toHaveBeenCalledWith('logo-1.png')
    vi.doUnmock('./supabase')
  })
})
