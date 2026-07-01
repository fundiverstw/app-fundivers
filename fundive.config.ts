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
  configVersion: 1,

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
    radio: 'https://radio.fundiverstw.com',
  },

  locale: {
    timezone: 'Asia/Taipei',
    currency: 'TWD',
    currencyLabel: 'NTD',
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
    broadcast: '/imgs/broadcast.png',
  },

  features: {
    radio: true,
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
  },
}
