import { siteConfig as raw } from '../../fundive.config'
import type { SupportedLanguage } from './languages'

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
  /** Short marketing line printed on the registration PDF. Blank = omit the
   *  line. Must be WinAnsi-encodable (no CJK) — the PDF renders with jsPDF's
   *  built-in helvetica, which has no CJK glyphs. */
  tagline: string
  /** This shop's full name, e.g. "FunDivers TW". */
  shopName: string
  /** Short brand name for tight UI (push titles, badges). */
  shortName: string
  /** Meta description / PWA description. */
  description: string
  /** Alt text for the logo image. */
  logoAlt: string
}

export interface SiteUrls {
  /** Public marketing site, no trailing slash. */
  site: string
  /** The deployed app origin, no trailing slash. */
  app: string
  /**
   * Public event-page URL template used by the share-link button; `{id}` is
   * replaced with the event id. null → the shop has no shareable event page,
   * so the share affordance hides itself.
   */
  eventPage: string | null
}

/**
 * Languages the app ships translations for. Core-owned: a fork picks one via
 * `locale.language`, it does not add its own. Extend this union (and the zod
 * enum in site.schema.ts, plus a catalog under src/i18n/messages) to add a
 * language. See docs/i18n.md.
 */
// The list lives in languages.ts, dependency-free, because the zod schema and
// vite.config.ts need it as a value from outside the Vite graph. Re-exported
// here so app code has one place to import config things from.
export { SUPPORTED_LANGUAGES } from './languages'
export type { SupportedLanguage } from './languages'

export interface SiteLocale {
  /** IANA timezone, e.g. "Asia/Taipei". */
  timezone: string
  /** What the shop writes on a price, e.g. "NTD". One field, not a code plus a
   *  label: nothing here ever machine-reads a currency — no Intl currency
   *  formatting, no payment processor — so a second field bought only the
   *  chance for two screens to name the same money differently, which is
   *  exactly what happened. Per-row `currency` columns override it. */
  currency: string
  /** The single language the whole app renders in for this deployment. */
  language: SupportedLanguage
  /** Which units the height / weight fields open in. Storage is always metric
   *  (profiles.height_cm, profiles.weight_kg) — this only picks the side of the
   *  toggle a diver sees first, and they can flip it per browser. Deliberately
   *  separate from `language`: this shop renders in English from Taiwan, where
   *  everyone is metric, so the language is no guide to the unit. */
  units: 'metric' | 'imperial'
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
}

export interface SiteFeatures {
  /** Web-push notifications (also gated by VAPID env). */
  push: boolean
  /** Admin broadcast relay (also gated by BROADCAST_WEBHOOK_URL). */
  broadcast: boolean
  /**
   * Public "share this event" button. Optional, off by default. Turning it on
   * only produces working links if the shop independently builds event pages on
   * their own website, keyed by the app's event id, and points urls.eventPage
   * at them ({id} is substituted). That web-dev wiring is the shop's own work —
   * the app just emits the URL. Also gated by a non-null urls.eventPage.
   */
  eventSharing: boolean
}

/** Pre-fill for the admin boat-manifest export. The chartered vessel varies per
 *  trip, so these are only defaults — the admin's last-used values are
 *  remembered in localStorage. Leave blank if the shop never charters a boat. */
export interface SiteBoatManifest {
  boatName: string
  registration: string
  /** Standard pre-trip instructions, one per line, in the shop's own language.
   *  Reproduced verbatim on the manifest; never translated. */
  notes: string[]
}

export interface SiteBusiness {
  /** Every gear item the catalog knows: the profile's "gear I own" checklist. */
  gearItems: string[]
  /** Per-item daily à-la-carte rental price, in the shop currency. Keys are the
   *  subset of `gearItems` the shop actually rents; an item with no price here
   *  can be owned but never rented. */
  gearPrices: Record<string, number>
  /** Fallback full-payment deadline when an event sets none: N days before start. */
  paymentDeadlineFallbackDays: number
  /** Flat fee to add a Nitrox course to a dive registration, in shop currency. */
  nitroxCourseFee: number
  /** How long a single-day event runs, in hours, for the "Add to Google
   *  Calendar" link. Events store a start time but no end time, and Google
   *  needs a span. Omit to accept the code-side default (8). */
  eventDurationHours?: number
  /** Case-insensitive regex-alternation fragments that mark a dive as a "trip"
   *  (vs a local shore dive) by title — destination names, "\\bboat\\b", etc.
   *  Empty = never match by title. Used for calendar coloring. */
  tripKeywords: string[]
  /** Defaults pre-filled into the admin boat-manifest export modal. */
  boatManifest: SiteBoatManifest
}

/** The single reference location for the admin weather / BI baseline. */
export interface SiteWeatherRegion {
  latitude: number
  longitude: number
  label: string
}

export interface SiteConfig {
  /** Pairs with CONFIG_CONTRACT_VERSION; bump when this contract changes. */
  configVersion: number
  identity: SiteIdentity
  // No `contact` block: how a diver reaches the shop is shop-authored now
  // (`shop_contact` + `contact_channels`, 20260905120000), because an email
  // address that needs a developer and a redeploy to change is not a setting.
  urls: SiteUrls
  locale: SiteLocale
  theme: SiteTheme
  assets: SiteAssets
  features: SiteFeatures
  business: SiteBusiness
  weatherRegion: SiteWeatherRegion
}

// Bump when the SiteConfig contract changes in a way that requires forks to
// migrate their fundive.config.ts. The build compares this against
// siteConfig.configVersion and fails loudly on a mismatch.
export const CONFIG_CONTRACT_VERSION = 12

export const siteConfig: SiteConfig = raw
