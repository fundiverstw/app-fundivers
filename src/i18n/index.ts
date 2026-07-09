// The app's shop-facing text, resolved once for the language the deployment
// picked in `fundive.config.ts` (`locale.language`). Because the language is a
// build-time constant, selection needs no React context or provider: `t` is a
// plain module-level object.
//
//   import { t } from '../i18n'
//   <h1>{t.dashboard.title}</h1>
//   <span>{t.shell.pending(count)}</span>
//
// Add a language by extending SupportedLanguage (src/config/site.ts), the zod
// enum (src/config/site.schema.ts), and adding a catalog here. See docs/i18n.md.
import { siteConfig, type SupportedLanguage } from '../config/site'
import { en, type Messages } from './messages/en'
import { zhTW } from './messages/zh-TW'
import { ja } from './messages/ja'

export type { Messages }

const catalogs: Record<SupportedLanguage, Messages> = {
  en,
  'zh-TW': zhTW,
  ja,
}

export const t: Messages = catalogs[siteConfig.locale.language]
