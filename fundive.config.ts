// FunDivers TW's FunDive configuration. Pure data, read by the app build, the
// service worker and (as the FUNDIVE_CONFIG secret) the edge functions. The
// shape is checked against the platform's SiteConfig at build time. Field by
// field: https://github.com/fundive/fundive/blob/main/docs/forking.md
import { defineConfig } from 'fundive/config'

export const siteConfig = defineConfig({
  configVersion: 13,

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
    currency: 'NTD',
    // The one language the whole app renders in. 'en' | 'zh-TW' | 'ja'.
    language: 'en',
    // Which side of the height / weight toggle opens first. Storage is
    // metric either way; this shop is in Taiwan, so metric.
    units: 'metric',
  },

  // PWA manifest + index.html theme-color.
  theme: {
    themeColor: '#0ea5e9',
    backgroundColor: '#0f172a',
    // The dark-ocean look FunDivers has always had.
    design: 'dark',
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
    radio: false,
    push: true,
    broadcast: true,
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
})
