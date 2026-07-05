// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE for a new shop's fundive.config.ts.
//
// Copy this file to `fundive.config.ts` and replace every value with your own.
// Keep it PURE DATA — no imports, no React, no import.meta.env — so the browser,
// vite.config.ts, the service worker, and the Deno edge functions can all read
// it. The shape is checked against SiteConfig (src/config/site.ts) at build time.
//
// Infrastructure that does NOT live here (it's per-account, not app data): your
// Supabase + Cloudflare secrets go in .env / GitHub Actions secrets / wrangler
// secrets, and the Worker names live in wrangler.toml + workers/push/wrangler.toml.
// See docs/forking.md and docs/deployment.md.
// ─────────────────────────────────────────────────────────────────────────────

export const siteConfig = {
  // Must equal core's current CONFIG_CONTRACT_VERSION (src/config/site.ts) or
  // the build fails. Bump it whenever core's CHANGELOG.md tells you to migrate.
  configVersion: 4,

  identity: {
    appName: 'FunDive',
    shopName: 'Your Dive Shop',
    shortName: 'YourShop',
    description: 'Dive registration and logbook for Your Dive Shop',
    logoAlt: 'Your Dive Shop',
  },

  contact: {
    email: 'hello@example.com',
    phone: '+1 555-000-0000',
    address: '123 Harbour Rd, Your City',
    mapsUrl: 'https://maps.google.com/?q=your+shop',
    lineUrl: 'https://line.me/R/ti/p/%40yourshop',
    whatsappUrl: 'https://wa.me/15550000000',
    paypalLink: 'https://paypal.me/yourshop',
  },

  // No trailing slashes.
  urls: {
    site: 'https://www.example.com',
    app: 'https://app.example.com',
  },

  locale: {
    timezone: 'Asia/Taipei',
    currency: 'USD',
    currencyLabel: 'USD',
  },

  theme: {
    themeColor: '#0ea5e9',
    backgroundColor: '#0f172a',
  },

  // Drop your images into public/ at these paths (or change the paths here).
  assets: {
    logo: '/imgs/fd_logo.png',
    favicon: '/favicon.png',
    icon192: '/icons/icon-192.png',
    icon512: '/icons/icon-512.png',
    appleTouchIcon: '/apple-touch-icon.png',
  },

  // Turn off what you don't run.
  features: {
    push: true,
    broadcast: false,
  },

  business: {
    gearItems: ['BCD', 'Regulator', 'Wetsuit', 'Fins', 'Mask', 'Boots', 'Dive computer'],
    gearPrices: {
      BCD: 15, Regulator: 15, Wetsuit: 10, Fins: 5, Mask: 5, Boots: 3, 'Dive computer': 10,
    },
    paymentDeadlineFallbackDays: 7,
    cardSurchargePercent: 5,
    nitroxCourseFee: 300,
    // Case-insensitive regex fragments that mark a dive as a "trip" by title
    // (destination names, "\\bboat\\b", …). Empty = never classify by title.
    tripKeywords: ['\\bboat\\b'],
  },

  // Home dive region for the admin weather baseline (decimal degrees).
  weatherRegion: { latitude: 0, longitude: 0, label: 'Your home dive region' },
}
