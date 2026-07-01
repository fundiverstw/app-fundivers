import { siteConfig as raw } from '../../fundive.config'

// Shop configuration contract. `fundive.config.ts` at the repo root holds the
// values (pure data, no imports, so every runtime can read it); this file is the
// typed handle the app imports — `import { siteConfig } from '@/config/site'` (or
// a relative path). The `: SiteConfig` annotation below is what type-checks the
// fork's config: a missing or mistyped field fails the build here. The zod schema
// (src/config/site.schema.ts) does the same check at runtime for the test suite
// and the vite build guard.

export interface SiteIdentity {
  /** The open-source app name (shared by all shops). */
  appName: string
  /** This shop's full name, e.g. "FunDivers TW". */
  shopName: string
  /** Short brand name for tight UI (push titles, badges). */
  shortName: string
  /** Meta description / PWA description. */
  description: string
  /** Alt text for the logo image. */
  logoAlt: string
}

export interface SiteContact {
  email: string
  phone: string
  address: string
  mapsUrl: string
  lineUrl: string
  whatsappUrl: string
  paypalLink: string
}

export interface SiteUrls {
  /** Public marketing site, no trailing slash. */
  site: string
  /** The deployed app origin, no trailing slash. */
  app: string
  /** External radio stream, no trailing slash. */
  radio: string
  /** Path prefix that a dive-site slug is appended to. */
  travelDestinationsBase: string
}

export interface SiteLocale {
  /** IANA timezone, e.g. "Asia/Taipei". */
  timezone: string
  /** ISO 4217 currency code used as the code-side default, e.g. "TWD". */
  currency: string
  /** Human-facing currency label, e.g. "NTD". */
  currencyLabel: string
}

export interface SiteTheme {
  /** PWA manifest + index.html theme-color. */
  themeColor: string
  /** PWA manifest background color (splash). */
  backgroundColor: string
}

export interface SiteAssets {
  logo: string
  favicon: string
  icon192: string
  icon512: string
  appleTouchIcon: string
  broadcast: string
}

export interface SiteFeatures {
  /** Dive-site Map tab (Taiwan-specific geometry today — off for other shops). */
  map: boolean
  /** External radio links in the app shells. */
  radio: boolean
  /** Web-push notifications (also gated by VAPID env). */
  push: boolean
  /** Admin broadcast relay (also gated by BROADCAST_WEBHOOK_URL). */
  broadcast: boolean
}

export interface SiteBusiness {
  /** Rental-gear checklist, shared by the profile and register forms. */
  gearItems: string[]
  /** Per-item daily à-la-carte rental price, in the shop currency. */
  gearPrices: Record<string, number>
  /** Fallback full-payment deadline when an event sets none: N days before start. */
  paymentDeadlineFallbackDays: number
  /** Surcharge shown for card / PayPal payment methods, as a whole percent. */
  cardSurchargePercent: number
}

export interface SiteConfig {
  /** Pairs with CONFIG_CONTRACT_VERSION; bump when this contract changes. */
  configVersion: number
  identity: SiteIdentity
  contact: SiteContact
  urls: SiteUrls
  locale: SiteLocale
  theme: SiteTheme
  assets: SiteAssets
  features: SiteFeatures
  business: SiteBusiness
}

// Bump when the SiteConfig contract changes in a way that requires forks to
// migrate their fundive.config.ts. The build compares this against
// siteConfig.configVersion and fails loudly on a mismatch.
export const CONFIG_CONTRACT_VERSION = 1

export const siteConfig: SiteConfig = raw
