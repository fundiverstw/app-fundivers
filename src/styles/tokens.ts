// Palette tokens — single source of truth for the FunDivers surface styles.
// Components compose these instead of hard-coding class strings, so re-skinning
// means editing one file rather than chasing every component.
//
// Colour language (riced dark ocean — matches site-fundivers):
//   • Deep ocean-night — the fixed body gradient behind everything (index.css).
//     Pages are transparent so the water + corner glows show through.
//   • Frosted glass (`.glass`) — translucent blurred panels floating on the
//     water; the "Hyprland window" look. Text on them is light.
//   • Reef teal (reef-300/400/500) — the signature accent: glass hover borders,
//     neon glows, active nav modules, primary action.
//   • Red (accent) — the 1px hairline the brand uses on emphasised elements;
//     also urgent / pending status text and the Beta badge.

// ── Page surfaces ──────────────────────────────────────────────────
// Pages are transparent — the fixed deep-ocean body gradient (index.css) is the
// page background, so every tab sits on the same water. Loose text on the page
// itself (headings, section labels, empty states) uses the light hierarchy.
export const PAGE         = 'text-brand-50'

// Light hierarchy for loose text directly on the ocean page.
export const PAGE_HEADING = 'text-white'
export const PAGE_BODY    = 'text-brand-100/80'

// ── Cards & panels ─────────────────────────────────────────────────
// Frosted glass panels floating above the water — blurred translucent fill +
// hairline highlight. CARD_ELEVATED adds the reef neon glow (the "active
// window").
export const CARD          = 'glass glass-hover rounded-2xl'
export const CARD_ELEVATED = 'glass glow-teal rounded-2xl'

// ── Modals ─────────────────────────────────────────────────────────
export const MODAL_BACKDROP = 'fixed inset-0 bg-brand-950/70 backdrop-blur-sm z-50'
export const MODAL_PANEL    = 'glass glow-mauve rounded-2xl shadow-2xl'

// ── Text hierarchy on the glass (translucent dark) surface ─────────
// Glass panels are dark and translucent over the ocean, so text is light.
// Headings near-white; body a touch dimmer; muted/subtle tiers don't drop
// below /60 or legibility falls off on the transparent panels.
export const TEXT_HEADING = 'text-white font-bold'
export const TEXT_BODY    = 'text-brand-50/90 font-medium'
export const TEXT_MUTED   = 'text-brand-100/70'
export const TEXT_SUBTLE  = 'text-brand-100/55'
export const TEXT_LINK    = 'text-reef-300 font-semibold hover:text-reef-200 hover:underline'
export const TEXT_ERROR   = 'text-red-300 font-semibold'

// ── Text hierarchy on the deep navy chrome ─────────────────────────
export const ON_DEEP_BODY    = 'text-white/80'
export const ON_DEEP_MUTED   = 'text-white/70'
export const ON_DEEP_SUBTLE  = 'text-white/60'
export const ON_DEEP_LINK    = 'text-reef-300 font-semibold hover:text-reef-200 hover:underline'

// ── Buttons ────────────────────────────────────────────────────────
// px-4 belongs here, not at the call sites. Most callers stretch these with
// flex-1 or w-full, which hid the omission — but a button sized to its own
// label (an inline Approve / Reject) sat flush against its text. Harmless for
// the stretched cases: the padding is inside a width they already have.
const BUTTON_BASE = 'font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50'
// Primary = reef teal on dark ink — the signature CTA (reads on the glow).
export const BTN_PRIMARY = `${BUTTON_BASE} bg-reef-500 hover:bg-reef-400 text-slate-950`
export const BTN_GHOST   = `${BUTTON_BASE} border border-white/20 text-brand-50 hover:bg-white/10`
export const BTN_DANGER  = `${BUTTON_BASE} bg-red-500/15 hover:bg-red-500/25 text-red-200 border border-red-400/40`
export const BTN_LIGHT   = `${BUTTON_BASE} bg-white/10 hover:bg-white/20 text-brand-50 border border-white/15`

// Outline "cancel / dismiss" button used in modal + form footers. Hairline
// outline on a transparent fill so it reads as the secondary action next to a
// solid BTN_PRIMARY. Layout width (e.g. flex-1) stays at the call site.
export const BTN_SECONDARY = 'py-2 rounded-lg text-sm font-medium text-brand-50 border border-white/20 hover:bg-white/10 disabled:opacity-50'

// Compact inline-action buttons — the same three variants above at row size
// (text-xs · px-3 py-1) for dense action rows like the admin user-card controls,
// where a full-height BTN_* would dominate. inline-flex so a <Link> and a
// <button> line up identically.
// Geometry for the app's small buttons. Exported so surfaces that need their
// own colours — a button sitting on a light status-palette banner, where the
// BTN_XS_* dark-surface colours would be invisible — still get the same size,
// padding and radius as every other small button.
export const BTN_XS_BASE = 'inline-flex items-center justify-center text-xs font-semibold px-3 py-1 rounded-lg transition-colors disabled:opacity-50'
export const BTN_XS_PRIMARY = `${BTN_XS_BASE} bg-reef-500 hover:bg-reef-400 text-slate-950`
export const BTN_XS_GHOST   = `${BTN_XS_BASE} border border-white/20 text-brand-50 hover:bg-white/10`
export const BTN_XS_DANGER  = `${BTN_XS_BASE} bg-red-500/15 hover:bg-red-500/25 text-red-200 border border-red-400/40`

// ── Inputs ─────────────────────────────────────────────────────────
export const INPUT       = 'w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-brand-50 placeholder:text-brand-100/40 focus:outline-none focus:border-reef-400'
export const INPUT_LABEL = 'block text-sm text-brand-100 mb-1'

// ── Inline error notes ─────────────────────────────────────────────
// Small validation / load-failure <p> banners. Both variants sit on the dark
// glass now — light-red text on a translucent red wash with a red hairline.
export const ERROR_NOTE       = 'text-xs text-red-200 bg-red-900/40 border border-accent rounded-md p-2'
export const ERROR_NOTE_LIGHT = 'text-xs text-red-200 bg-red-900/30 border border-red-400/40 rounded px-2 py-1'

// ── Navigation chrome ──────────────────────────────────────────────
// Waybar glass — the blurred translucent bars floating above the water, set off
// from the page by a hairline highlight.
export const NAV_BAR    = 'waybar border-b border-white/10 px-4 py-3 flex items-center justify-between'
export const NAV_BOTTOM = 'fixed bottom-0 left-0 right-0 waybar border-t border-white/10 flex justify-around py-2 z-40'
