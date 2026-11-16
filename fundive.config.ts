// This shop's FunDive configuration. Data only: the app build, the service
// worker and (as the FUNDIVE_CONFIG secret) the edge functions read it, and the
// build checks it against the platform's config contract, naming any field
// that is wrong. Every field: https://fundive.github.io/fundive/configuration
//
// Not here: credentials (.env.local, listed in .env.example) and worker names
// and domain (wrangler.toml, workers/push/wrangler.toml).

import { defineConfig } from 'fundive/config'

export const siteConfig = defineConfig({
  // The platform's config contract version. An upgrade that changes the
  // config's shape raises it, and the build names the field to update.
  configVersion: 13,

  identity: {
    // Printed in italics on the registration PDF. Leave blank to omit it.
    // No CJK: the PDF font (jsPDF helvetica) has no CJK glyphs.
    tagline: 'Breathe the Adventure! Explore with Confidence!',
    appName: 'FunDive',
    shopName: 'FunDivers TW',
    shortName: 'FunDivers',
    description: 'Dive registration and logbook for FunDivers Taiwan',
    logoAlt: 'FunDivers Taiwan',
  },


  // No trailing slashes.
  urls: {
    site: 'https://www.fundiverstw.com',
    app: 'https://app.fundiverstw.com',
    // Optional: your website's page for one event, `{id}` = the event id. Omit
    // to share the app's own registration page.
    eventPage: 'https://www.fundiverstw.com/events/{id}',
  },

  locale: {
    timezone: 'Asia/Taipei',
    currency: 'NTD',
    // The one language the whole app renders in. 'en' | 'zh-TW' | 'ja'.
    language: 'en',
    // Which side of the height / weight toggle a diver sees first. Storage
    // is always metric (cm / kg) — this only picks the default view, and each
    // diver can flip it. 'metric' | 'imperial'.
    units: 'metric',
  },

  theme: {
    themeColor: '#0ea5e9',
    backgroundColor: '#0f172a',
    // Visual design: 'light' (default) or 'dark' (dark ocean glass).
    // Omit for 'light'.
    design: 'dark',
  },

  // Drop your images into public/ at these paths (or change the paths here).
  assets: {
    logo: '/imgs/fd_logo.png',
    favicon: '/favicon.png',
    icon192: '/icons/icon-192.png',
    icon512: '/icons/icon-512.png',
    appleTouchIcon: '/apple-touch-icon.png',
    broadcast: '/imgs/broadcast.png',
  },

  // Turn off what you don't run.
  features: {
    radio: false,
    push: true,
    broadcast: true,
  },

  business: {
    // An item offered in more than one style is listed once per style, with the
    // style in trailing parentheses — the app reads that as one slot on the
    // diver, so a booking rents one boot style or the other, never both.
    gearItems: [
      'BCD', 'Regulator', 'Wetsuit', 'Fins', 'Mask',
      'Boots (rubber sole)', 'Boots (felt sole)', 'Dive computer',
    ],
    // The items the shop rents, and the daily price of each. Leave an item out
    // to make it owned-only: divers can still list it on their profile, but it
    // never appears in the rental checklist. A shop that only rents felt soles
    // drops the rubber-soled line here and keeps it in gearItems above.
    gearPrices: {
      BCD: 400, Regulator: 500, Wetsuit: 200, Fins: 100, Mask: 100,
      'Boots (felt sole)': 50, 'Dive computer': 250,
    },
    paymentDeadlineFallbackDays: 7,
    nitroxCourseFee: 6000,
    // Length of a single-day event in the "Add to Google Calendar" link.
    eventDurationHours: 8,
    // Case-insensitive regex fragments that mark a dive as a "trip" by title
    // (destination names, "\\bboat\\b", …). Empty = never classify by title.
    tripKeywords: [
      '\\bboat\\b', 'green island', 'kenting', 'penghu', 'lambai', 'xiao\\s?liuqiu',
      'orchid island', 'anilao', 'palau', 'panglao', 'bohol', 'tubbataha', 'puerto galera',
    ],
    // Pre-fills the admin boat-manifest export. Leave blank if the shop never
    // charters a boat; notes are printed verbatim, in the shop's own language.
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

  // Home dive region for the admin weather baseline (decimal degrees).
  weatherRegion: { latitude: 25.12, longitude: 121.92, label: 'NE coast — Longdong / Keelung' },
})
