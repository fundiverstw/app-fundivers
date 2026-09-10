import { supabase } from './supabase'
import { siteConfig, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../config/site'

// The shop's own identity settings: logo, training agency, currency, language.
//
// Two of the four reach the running app and two do not, and the difference is
// not a limitation to paper over — it is what the Shop Profile page has to
// explain. `logo` and `standardsOrg` are read at runtime, so an admin's change
// is live on the next render. `currency` and `language` are compiled in: the
// language decides which message catalog is bundled, and the currency is read
// by `vite.config.ts` and the service worker as well as the app. Storing them
// here records what the shop wants; `configDrift` below is what lets the page
// say so out loud instead of pretending the control worked.

export interface ShopProfile {
  /** Object path in the `shop-logo` bucket, or null for the bundled asset. */
  logoPath: string | null
  /** Agency whose vocabulary the app speaks, or null for the deployment's own. */
  standardsOrg: string | null
  /** What the shop writes on a price, e.g. "NTD". */
  currency: string | null
  language: string | null
}

export const NO_SHOP_PROFILE: ShopProfile = {
  logoPath: null,
  standardsOrg: null,
  currency: null,
  language: null,
}

/**
 * The agency the app labels certifications in.
 *
 * PADI when the shop has not chosen, because PADI is the hub every other
 * agency's rungs already point at (`cert_levels.padi_equivalent_id`) — so it is
 * the one vocabulary guaranteed to have a name for every rung.
 */
export function standardsOrgOf(profile: ShopProfile): string {
  return profile.standardsOrg ?? DEFAULT_STANDARDS_ORG
}

export const DEFAULT_STANDARDS_ORG = 'PADI'

/**
 * Where to load the shop's logo from.
 *
 * The bucket is public, so this is a plain URL with no signing and no session —
 * which is what lets the login page and the emailed terms-acceptance page show
 * it. Falls back to the deployment's bundled asset, which is what a shop that
 * has uploaded nothing should see.
 */
export function logoUrlOf(profile: ShopProfile): string {
  if (!profile.logoPath) return siteConfig.assets.logo
  const { data } = supabase.storage.from(SHOP_LOGO_BUCKET).getPublicUrl(profile.logoPath)
  return data.publicUrl
}

export const SHOP_LOGO_BUCKET = 'shop-logo'

/** One field the shop has chosen that the running build does not agree with. */
export interface ConfigDrift {
  field: 'currency' | 'language'
  /** What the admin picked, stored in `shop_profile`. */
  chosen: string
  /** What this bundle was actually built with. */
  running: string
}

/**
 * The compiled-in settings this shop has asked for that this bundle was not
 * built with — that is, saved but not yet deployed.
 *
 * Empty when the shop has expressed no preference or the running build already
 * matches. The build reads these from the same row (src/vite/shop-profile-overlay.ts),
 * so the gap closes on the next deploy with nothing to hand-edit; until then the
 * two genuinely disagree and the page has to say so.
 */
export function configDrift(profile: ShopProfile): ConfigDrift[] {
  const drift: ConfigDrift[] = []

  if (profile.currency && profile.currency !== siteConfig.locale.currency) {
    drift.push({
      field: 'currency',
      chosen: profile.currency,
      running: siteConfig.locale.currency,
    })
  }
  if (profile.language && profile.language !== siteConfig.locale.language) {
    drift.push({
      field: 'language',
      chosen: profile.language,
      running: siteConfig.locale.language,
    })
  }
  return drift
}

/** The languages this build actually ships a catalog for. */
export const BUILT_IN_LANGUAGES: readonly SupportedLanguage[] = SUPPORTED_LANGUAGES

interface ShopProfileRow {
  logo_path: string | null
  standards_org: string | null
  currency: string | null
  language: string | null
}

function fromRow(row: ShopProfileRow): ShopProfile {
  return {
    logoPath: row.logo_path,
    standardsOrg: row.standards_org,
    currency: row.currency,
    language: row.language,
  }
}

/**
 * The shop's profile, or the empty one.
 *
 * A read that fails returns the empty profile rather than throwing: every
 * consumer already renders the config's own values in that case, and a slow or
 * unreachable Supabase should cost a shop its custom logo, not its app.
 */
export async function fetchShopProfile(): Promise<ShopProfile> {
  const { data, error } = await supabase
    .from('shop_profile')
    .select('logo_path, standards_org, currency, language')
    .maybeSingle()
  if (error || !data) return NO_SHOP_PROFILE
  return fromRow(data)
}

export async function saveShopProfile(patch: Partial<ShopProfile>): Promise<void> {
  const row: Partial<ShopProfileRow> = {}
  if ('logoPath' in patch) row.logo_path = patch.logoPath ?? null
  if ('standardsOrg' in patch) row.standards_org = patch.standardsOrg ?? null
  if ('currency' in patch) row.currency = patch.currency ?? null
  if ('language' in patch) row.language = patch.language ?? null

  const { error } = await supabase
    .from('shop_profile')
    .update(row)
    .eq('singleton', true)
  if (error) throw error
}

/** Every agency the certification ladder knows, in alphabetical order. */
export async function fetchStandardsOrganizations(): Promise<string[]> {
  const { data, error } = await supabase.from('cert_levels').select('organization')
  if (error || !data) return []
  return [...new Set(data.map(r => (r as { organization: string }).organization))].sort()
}

export interface CertEquivalenceRow {
  organization: string
  rank: number
  code: string
  name: string
  hub_code: string
  hub_name: string
  /** The chosen agency's name for this rung, or null where it has none. */
  equivalent_name: string | null
}

/** The equivalence chart, every agency's ladder in one agency's words. */
export async function fetchCertEquivalences(organization: string): Promise<CertEquivalenceRow[]> {
  const { data, error } = await supabase.rpc('cert_level_equivalences', { p_organization: organization })
  if (error || !data) return []
  return data as CertEquivalenceRow[]
}
