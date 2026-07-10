// ─────────────────────────────────────────────────────────────────────────────
// SHOP CONFIGURATION — the one file a fork edits.
//
// FunDive is open source: the core code lives upstream, and each shop runs a
// fork that customises everything below (name, contact, domains, branding,
// business rules) without touching core. This file is intentionally PURE DATA —
// no imports, no React, no import.meta.env — so it can be read by every runtime
// that needs it: the browser bundle, vite.config.ts, the service worker, and the
// Deno edge functions.
//
// The shape is validated against `SiteConfig` (src/config/site.ts) at build time
// and by src/config/site.test.ts. See fundive.config.example.ts for a blank
// template and docs/forking.md for the update workflow.
//
// `configVersion` pairs with CONFIG_CONTRACT_VERSION in src/config/site.ts: when
// core changes the config contract in a breaking way it bumps that constant and
// the build fails here until this file is migrated (see the CHANGELOG note the
// build prints). Same "bump a version to force action" idea as the waiver and
// Terms-of-Use versions.
// ─────────────────────────────────────────────────────────────────────────────

export const siteConfig = {
  configVersion: 6,

  identity: {
    appName: 'FunDive',
    shopName: 'FunDivers TW',
    shortName: 'FunDivers',
    description: 'Dive registration and logbook for FunDivers Taiwan',
    logoAlt: 'FunDivers Taiwan',
  },

  contact: {
    email: 'fundiverstw@gmail.com',
    phone: '+886 909-083-683',
    address: 'No. 8, Heping St, Yonghe District, New Taipei City, 23446',
    mapsUrl: 'https://maps.app.goo.gl/tDgtMirMrNX9QEjAA',
    lineUrl: 'https://line.me/R/ti/p/%40lga0216c',
    whatsappUrl: 'https://wa.me/886909083683',
    paypalLink: 'https://paypal.me/fundiverstw',
  },

  // No trailing slashes.
  urls: {
    site: 'https://www.fundiverstw.com',
    app: 'https://app.fundiverstw.com',
  },

  locale: {
    timezone: 'Asia/Taipei',
    currency: 'TWD',
    currencyLabel: 'NTD',
    // The one language the whole app renders in. 'en' | 'zh-TW' | 'ja'.
    // `as const` narrows the literal to the SupportedLanguage union (this file
    // is type-checked against SiteConfig via src/config/site.ts).
    language: 'en' as const,
  },

  // Used by the PWA manifest (vite.config.ts) and the index.html theme-color.
  // The full component palette is not yet config-driven (Stage 2).
  theme: {
    themeColor: '#0ea5e9',
    backgroundColor: '#0f172a',
  },

  assets: {
    logo: '/imgs/fd_logo.png',
    favicon: '/favicon.png',
    icon192: '/icons/icon-192.png',
    icon512: '/icons/icon-512.png',
    appleTouchIcon: '/apple-touch-icon.png',
  },

  features: {
    push: true,
    broadcast: true,
  },

  business: {
    gearItems: ['BCD', 'Regulator', 'Wetsuit', 'Fins', 'Mask', 'Boots', 'Dive computer'],
    gearPrices: {
      BCD: 400, Regulator: 500, Wetsuit: 200, Fins: 100, Mask: 100, Boots: 50, 'Dive computer': 250,
    },
    paymentDeadlineFallbackDays: 7,
    cardSurchargePercent: 5,
    nitroxCourseFee: 6000,
    // Regex-alternation fragments (case-insensitive) that flag a dive as a
    // "trip" by title when it has no tagged destination — boat dives and
    // anywhere beyond the usual Taipei→Keelung shore drive.
    tripKeywords: [
      '\\bboat\\b', 'green island', 'kenting', 'penghu', 'lambai', 'xiao\\s?liuqiu',
      'orchid island', 'anilao', 'palau', 'panglao', 'bohol', 'tubbataha', 'puerto galera',
    ],
    // Pre-fills the admin boat-manifest export. Notes are reproduced verbatim on
    // the manifest, which matches the official Taiwanese vessel form.
    boatManifest: {
      boatName: '坤成8號',
      registration: 'CT2-6445',
      notes: [
        '1.石城或龜山都上午：6點30分集合，7點發船，請提前抵港。下午：12點30分集合，1點出船。(時間會依海況及實際情況再做調整)',
        '2. 裝備用網袋不要帶箱子上船',
        '3.繳交有相片的證件，以方便海巡安檢快速出港。',
        '4.有需要高氧的就要先說，每支加100元。',
        '5.船上有配重120kg供使用，但配重帶要自備。',
      ],
    },
  },

  // Home dive region for the admin "Historical perspective" weather baseline.
  weatherRegion: { latitude: 25.12, longitude: 121.92, label: 'NE coast — Longdong / Keelung' },
}
