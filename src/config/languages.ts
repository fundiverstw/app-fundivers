// Languages the app ships translations for. Core-owned: a fork picks one via
// `locale.language`, it does not add its own.
//
// Its own module, and dependency-free, for the same reason contract.ts is: the
// zod schema and vite.config.ts both need this list as a *value*, and both are
// loaded by Node outside the Vite graph. Taking it from site.ts would drag
// `virtual:fundive-config` along, which only resolves inside that graph.
//
// Adding a language means this list plus a catalog under src/i18n/messages.
// See docs/i18n.md.

export const SUPPORTED_LANGUAGES = ['en', 'zh-TW', 'ja'] as const

export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]
