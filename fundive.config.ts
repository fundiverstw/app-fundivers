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
  configVersion: 11,

  identity: {
    appName: 'FunDive',
    tagline: 'Breathe the Adventure! Explore with Confidence!',
    shopName: 'FunDivers TW',
    shortName: 'FunDivers',
    description: 'Dive registration and logbook for FunDivers Taiwan',
    logoAlt: 'FunDivers Taiwan',
  },


  // No trailing slashes.
  urls: {
    site: 'https://www.fundiverstw.com',
    app: 'https://app.fundiverstw.com',
    eventPage: 'https://www.fundiverstw.com/events/{id}',
  },

  locale: {
    timezone: 'Asia/Taipei',
    currency: 'TWD',
    currencyLabel: 'NTD',
    // The one language the whole app renders in. 'en' | 'zh-TW' | 'ja'.
    // `as const` narrows the literal to the SupportedLanguage union (this file
    // is type-checked against SiteConfig via src/config/site.ts).
    language: 'en' as const,
    // Which side of the height / weight toggle opens first. Storage is
    // metric either way; this shop is in Taiwan, so metric.
    units: 'metric' as const,
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
    eventSharing: true,
  },

  business: {
    // Every item a diver can say they own. An item offered in more than one
    // style is listed once per style, with the style in trailing parentheses —
    // the app reads that as one slot on the diver, so a booking rents one boot
    // style or the other, never both.
    gearItems: [
      'BCD', 'Regulator', 'Wetsuit', 'Fins', 'Mask',
      'Boots (rubber sole)', 'Boots (felt sole)', 'Dive computer',
    ],
    // The items the shop rents, and the daily price of each. An item left out
    // is owned-only: divers can list it on their profile, but it never appears
    // in the rental checklist. Rubber soles are here for divers who own a pair;
    // the rental rack is felt only, for the algae-covered rock we shore-enter on.
    gearPrices: {
      BCD: 400, Regulator: 500, Wetsuit: 200, Fins: 100, Mask: 100,
      'Boots (felt sole)': 50, 'Dive computer': 250,
    },
    paymentDeadlineFallbackDays: 7,
    nitroxCourseFee: 6000,
    // Length of a single-day event in the "Add to Google Calendar" link.
    eventDurationHours: 8,
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
