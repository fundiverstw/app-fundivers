import { describe, it, expect } from 'vitest'
import { siteConfig, CONFIG_CONTRACT_VERSION } from './site'
import { siteConfigSchema, assertValidSiteConfig } from './site.schema'

// Guards the fork's fundive.config.ts against the SiteConfig contract. If a shop
// mistypes or omits a field, or ships a stale configVersion, this fails in CI
// before the broken config reaches a build. Mirrors src/config/waivers.test.ts.

describe('siteConfig', () => {
  it('satisfies the schema', () => {
    expect(() => assertValidSiteConfig(siteConfig)).not.toThrow()
    expect(siteConfigSchema.safeParse(siteConfig).success).toBe(true)
  })

  it('declares a configVersion at or above the core contract', () => {
    expect(siteConfig.configVersion).toBeGreaterThanOrEqual(CONFIG_CONTRACT_VERSION)
  })

  it('uses absolute http(s) URLs', () => {
    const urls = [
      siteConfig.urls.site, siteConfig.urls.app, siteConfig.urls.radio,
      siteConfig.contact.mapsUrl, siteConfig.contact.lineUrl,
      siteConfig.contact.whatsappUrl, siteConfig.contact.paypalLink,
    ]
    for (const u of urls) expect(u).toMatch(/^https?:\/\//)
  })

  it('uses #rrggbb theme colors', () => {
    expect(siteConfig.theme.themeColor).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(siteConfig.theme.backgroundColor).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('has a non-empty gear list with a price for every item', () => {
    expect(siteConfig.business.gearItems.length).toBeGreaterThan(0)
    for (const item of siteConfig.business.gearItems) {
      expect(siteConfig.business.gearPrices[item]).toBeTypeOf('number')
    }
  })

  it('rejects a config with an out-of-range configVersion', () => {
    expect(() => assertValidSiteConfig({ ...siteConfig, configVersion: CONFIG_CONTRACT_VERSION - 1 }))
      .toThrow(/configVersion/)
  })
})
