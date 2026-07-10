// The shop's message catalog, for the Deno edge-function runtime.
//
// This mirrors src/i18n/index.ts but cannot reuse it: that module imports
// src/config/site.ts, which resolves `../../fundive.config` extensionless (and,
// in the fundive repo, the `virtual:fundive-config` Vite specifier) — neither
// of which Deno can load. The catalogs themselves are pure data with no config
// or React imports, precisely so they stay importable from here.
//
// Emails render in the deployment's single shop-facing language, the same one
// the app renders in. Shop-authored content (waiver bodies, boat-manifest
// notes) is never translated and never lives in a catalog.

import { siteConfig } from "../../../fundive.config.ts"
import { en, type Messages } from "../../../src/i18n/messages/en.ts"
import { zhTW } from "../../../src/i18n/messages/zh-TW.ts"
import { ja } from "../../../src/i18n/messages/ja.ts"

export type { Messages }

const catalogs: Record<string, Messages> = {
  en,
  "zh-TW": zhTW,
  ja,
}

export const t: Messages = catalogs[siteConfig.locale.language]
