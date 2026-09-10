import type { SiteConfig } from '../config/site'

// The shop's compiled-in settings, read from the database at build time.
//
// `locale.currency` and `locale.language` cannot be applied at runtime: the
// language decides which message catalog is bundled at all, and the currency is
// baked into the service worker and index.html as well as the app. So an admin
// who changes them in Manage → Shop Profile is expressing a wish that only a
// build can grant — and this is where it is granted. The Shop Profile page
// still shows the drift, because between the save and the next deploy the two
// genuinely do disagree.
//
// The trade is deliberate and worth naming: the build now talks to the network.
// It is not hermetic. What it buys is that "applies on next deploy" is true
// rather than a note asking someone to hand-edit a config file, which is the
// step that would actually get forgotten.

/** The compiled-in half of `shop_profile`. Null fields mean "no preference". */
export interface ShopProfileOverlay {
  currency: string | null
  language: string | null
}

/** One value the build changed, for the log. */
export interface OverlayChange {
  field: string
  from: string
  to: string
}

/**
 * `config` with the shop's own choices applied, and what changed.
 *
 * A null or empty field is no preference, not an instruction to blank the
 * value: a shop that has never opened the page must build exactly as it does
 * today. An unknown language is likewise ignored rather than applied — the set
 * of catalogs is a property of this build, and honouring a language it cannot
 * render would produce an app with no strings in it.
 */
export function applyShopProfile(
  config: SiteConfig,
  overlay: ShopProfileOverlay | null,
  knownLanguages: readonly string[],
): { config: SiteConfig; changes: OverlayChange[] } {
  if (!overlay) return { config, changes: [] }

  const changes: OverlayChange[] = []
  const locale = { ...config.locale }

  const currency = overlay.currency?.trim()
  if (currency && currency !== locale.currency) {
    changes.push({ field: 'locale.currency', from: locale.currency, to: currency })
    locale.currency = currency
  }

  const language = overlay.language?.trim()
  if (language && language !== locale.language && knownLanguages.includes(language)) {
    changes.push({ field: 'locale.language', from: locale.language, to: language })
    locale.language = language as SiteConfig['locale']['language']
  }

  if (changes.length === 0) return { config, changes: [] }
  return { config: { ...config, locale }, changes }
}

/** Set to skip the read — for a build with no reachable Supabase. */
export const SKIP_ENV = 'FUNDIVE_SKIP_PROFILE_SYNC'

const TIMEOUT_MS = 10_000

/**
 * The shop's compiled-in settings, or null when there is nothing to ask.
 *
 * Null means "build from the config alone": no Supabase credentials in the
 * environment (a dev build, or one the env gate is about to fail anyway), or
 * the skip flag set on purpose.
 *
 * Throws when the credentials ARE present and the read fails. A build that
 * cannot find out what the shop chose must not quietly ship the old value —
 * that is the failure this whole mechanism exists to remove.
 */
export async function fetchShopProfileOverlay(env: Record<string, string | undefined>): Promise<ShopProfileOverlay | null> {
  if (env[SKIP_ENV]) return null

  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null

  const endpoint =
    `${url.replace(/\/+$/, '')}/rest/v1/shop_profile` +
    '?select=currency,language&limit=1'

  let res: Response
  try {
    res = await fetch(endpoint, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (cause) {
    throw new Error(
      `Could not read shop_profile from ${url} to build with this shop's ` +
      `currency and language: ${(cause as Error).message}. ` +
      `Fix the connection, or set ${SKIP_ENV}=1 to build from fundive.config.ts alone.`,
      { cause },
    )
  }

  // 404 is PostgREST saying the table is not there — a database that predates
  // the migration. Failing here would mean the first deploy of this code could
  // not be built until the migration was pushed, an ordering trap for exactly
  // the deploy that introduces the feature. A database with no table has no
  // preference to honour, so build from the config and say so.
  if (res.status === 404) {
    console.warn(
      `fundive: ${url} has no shop_profile table yet — building with the ` +
      'values in fundive.config.ts. Push the migrations and deploy again to ' +
      'apply what the shop chose in Manage → Shop Profile.',
    )
    return null
  }

  if (!res.ok) {
    throw new Error(
      `Could not read shop_profile from ${url}: HTTP ${res.status}. ` +
      `Fix the connection, or set ${SKIP_ENV}=1 to build from fundive.config.ts alone.`,
    )
  }

  const rows = (await res.json()) as Array<{
    currency: string | null
    language: string | null
  }>
  const row = rows[0]
  // No row is a database that predates the table, not a failure: the config's
  // own values are the answer.
  if (!row) return null

  return { currency: row.currency, language: row.language }
}
