import { describe, it, expect } from 'vitest'
import { siteConfig, CONFIG_CONTRACT_VERSION } from './site'
import { siteConfigSchema, assertValidSiteConfig } from './site.schema'
import { siteConfig as exampleConfig } from '../../fundive.config.example'

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
    const urls = [siteConfig.urls.site, siteConfig.urls.app]
    for (const u of urls) expect(u).toMatch(/^https?:\/\//)
  })

  it('uses #rrggbb theme colors', () => {
    expect(siteConfig.theme.themeColor).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(siteConfig.theme.backgroundColor).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('rejects a price for an item the catalog does not list', () => {
    const typo = {
      ...siteConfig,
      business: {
        ...siteConfig.business,
        gearPrices: { ...siteConfig.business.gearPrices, 'Boots (rubbr sole)': 50 },
      },
    }
    const result = siteConfigSchema.safeParse(typo)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('not in gearItems')
  })

  // The other direction is legitimate: a catalog item with no price is gear a
  // diver may own but the shop doesn't rent.
  it('has a non-empty gear list, and prices nothing it does not list', () => {
    expect(siteConfig.business.gearItems.length).toBeGreaterThan(0)
    for (const priced of Object.keys(siteConfig.business.gearPrices)) {
      expect(siteConfig.business.gearItems, `${priced} is priced but not listed`).toContain(priced)
    }
  })

  // The tagline is printed on the registration PDF by jsPDF's built-in helvetica,
  // whose encoding is WinAnsi (cp1252). A CJK tagline does not fail there — it
  // silently renders as mangled bytes — so reject it at config time instead.
  it('has a PDF-safe tagline (blank, or WinAnsi-encodable)', () => {
    const CP1252_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹Œ'
      + 'Ž‘’“”•–—˜™š›œžŸ'
    const unencodable = [...siteConfig.identity.tagline]
      .filter(ch => ch.codePointAt(0)! > 0xFF && !CP1252_EXTRAS.includes(ch))
    expect(unencodable).toEqual([])
  })

  // The manifest pre-fill is optional shop content — a shop that never charters
  // a boat leaves it blank. Note lines print verbatim on the vessel form, so a
  // stray empty line is a config error rather than a harmless blank.
  it('allows a blank boat manifest but rejects empty note lines', () => {
    const withManifest = (boatManifest: typeof siteConfig.business.boatManifest) =>
      ({ ...siteConfig, business: { ...siteConfig.business, boatManifest } })

    expect(() => assertValidSiteConfig(withManifest({ boatName: '', registration: '', notes: [] })))
      .not.toThrow()
    expect(() => assertValidSiteConfig(withManifest({ ...siteConfig.business.boatManifest, notes: [''] })))
      .toThrow()
  })

  // urls.app is concatenated into share links and emailed deep links, and is
  // matched verbatim as a CORS origin. Both break on a trailing slash, and
  // neither breaks loudly, so the config guard is where it has to be caught.
  it('rejects an origin with a trailing slash', () => {
    const withApp = (app: string) => ({ ...siteConfig, urls: { ...siteConfig.urls, app } })
    expect(() => assertValidSiteConfig(withApp('https://app.example.com/'))).toThrow(/slash/)
    expect(() => assertValidSiteConfig(withApp('https://app.example.com'))).not.toThrow()
  })

  it('rejects a config with an out-of-range configVersion', () => {
    expect(() => assertValidSiteConfig({ ...siteConfig, configVersion: CONFIG_CONTRACT_VERSION - 1 }))
      .toThrow(/configVersion/)
  })

  // The example is the fork onboarding path (`cp fundive.config.example.ts
  // fundive.config.ts`), so it must stay valid at the current contract — a
  // stale example would fail a fresh fork's very first build.
  it('ships an example config valid at the current contract version', () => {
    expect(() => assertValidSiteConfig(exampleConfig)).not.toThrow()
    expect(exampleConfig.configVersion).toBe(CONFIG_CONTRACT_VERSION)
  })
})
