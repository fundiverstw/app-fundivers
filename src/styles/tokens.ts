// Palette tokens — single source of truth for the FunDivers brand
// surface styles. Components should compose these instead of hard-
// coding Tailwind class strings, so re-skinning means editing one
// file rather than chasing every component.
//
// Colour language (matches the Wix site):
//   • Light blue (sky-50/100/200) — page surfaces and subtle accents
//   • Navy / dark blue (blue-900/950) — nav chrome, primary action,
//     headings, and the "deep water" splash on /dashboard
//   • Red (red-500/600/700) — the 1px accent border the brand uses on
//     emphasised elements; also urgent / pending status text
//   • White, often translucent, for floated cards / modals (the
//     "underwater glass" feel)

// ── Page surfaces ──────────────────────────────────────────────────
// Page bg is deep navy (the "water") so every tab feels like the home
// dashboard. Cards stack on top in translucent white so their contents
// still read as navy-on-white; loose text on the page itself (page
// headings, section labels, empty states) must use the light hierarchy.
export const PAGE         = 'bg-blue-900 text-white'

// Light hierarchy for loose text directly on the navy page — use this
// instead of text-blue-900 for headings/body that aren't inside a card.
export const PAGE_HEADING = 'text-white'
export const PAGE_BODY    = 'text-white/80'

// ── Cards & panels ─────────────────────────────────────────────────
// All card surfaces are translucent so the navy water shows through —
// keeps the "glass panel floating above the water" feel consistent
// across the app rather than flat white squares on a coloured bg.
export const CARD          = 'bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl'
export const CARD_ELEVATED = 'bg-white/65 backdrop-blur-md border border-red-500 rounded-2xl shadow-lg'

// ── Modals ─────────────────────────────────────────────────────────
export const MODAL_BACKDROP = 'fixed inset-0 bg-blue-900/60 backdrop-blur-sm z-50'
export const MODAL_PANEL    = 'bg-white/75 backdrop-blur-md border border-red-500 rounded-2xl shadow-2xl'

// ── Text hierarchy on the light (translucent white) surface ────────
// Cards are semi-transparent over navy water, so text needs to be
// darker + heavier than the baseline Tailwind slate to stay legible
// against the blue showing through. blue-950 for headings, font-medium
// on body text by default; muted/subtle tiers don't drop below /70
// or legibility falls off the cliff on transparent panels.
export const TEXT_HEADING = 'text-blue-950 font-bold'
export const TEXT_BODY    = 'text-blue-950 font-medium'
export const TEXT_MUTED   = 'text-blue-900 font-medium'
export const TEXT_SUBTLE  = 'text-blue-900/80 font-medium'
export const TEXT_LINK    = 'text-blue-800 font-semibold hover:underline'
export const TEXT_ERROR   = 'text-red-700 font-semibold'

// ── Text hierarchy on the deep navy chrome ─────────────────────────
export const ON_DEEP_BODY    = 'text-white/80'
export const ON_DEEP_MUTED   = 'text-white/70'
export const ON_DEEP_SUBTLE  = 'text-white/60'
export const ON_DEEP_LINK    = 'text-amber-300 font-semibold hover:text-amber-200 hover:underline'

// ── Buttons ────────────────────────────────────────────────────────
const BUTTON_BASE = 'font-semibold py-2 rounded-lg transition-colors disabled:opacity-50'
export const BTN_PRIMARY = `${BUTTON_BASE} bg-blue-900 hover:bg-blue-950 text-white`
export const BTN_GHOST   = `${BUTTON_BASE} border border-blue-900 text-blue-900 hover:bg-sky-100`
export const BTN_DANGER  = `${BUTTON_BASE} bg-sky-100 hover:bg-red-100 text-red-700 border border-red-500`
export const BTN_LIGHT   = `${BUTTON_BASE} bg-white text-blue-900 hover:bg-sky-100`

// Outline "cancel / dismiss" button used in modal + form footers. Sky
// outline on a transparent fill so it reads as the secondary action next
// to a solid BTN_PRIMARY. Layout width (e.g. flex-1) stays at the call
// site — this token is just the button identity.
export const BTN_SECONDARY = 'py-2 rounded-lg text-sm font-medium text-blue-900 border border-sky-300 hover:bg-sky-50 disabled:opacity-50'

// ── Inputs ─────────────────────────────────────────────────────────
export const INPUT       = 'w-full bg-white border border-sky-300 rounded-lg px-3 py-2 text-blue-900 focus:outline-none focus:border-blue-900'
export const INPUT_LABEL = 'block text-sm text-blue-900 mb-1'

// ── Inline error notes ─────────────────────────────────────────────
// Small validation / load-failure <p> banners. Two variants: the dark
// one sits on navy chrome (light-red text on a translucent red wash);
// the light one sits inside a white card (dark-red text on a pale red
// fill). Both use the brand red-500 hairline border.
export const ERROR_NOTE       = 'text-xs text-red-200 bg-red-900/50 border border-red-500 rounded-md p-2'
export const ERROR_NOTE_LIGHT = 'text-xs text-red-700 bg-red-50 border border-red-500 rounded px-2 py-1'

// ── Navigation chrome ──────────────────────────────────────────────
// Darker than PAGE so the top/bottom bars sit visibly above the water
// even on pages that already have a navy background.
export const NAV_BAR    = 'bg-blue-950 border-b border-red-500 px-4 py-3 flex items-center justify-between'
export const NAV_BOTTOM = 'fixed bottom-0 left-0 right-0 bg-blue-950 border-t border-red-500 flex justify-around py-2'
