import { supabase } from './supabase'
import { siteConfig } from '../config/site'
import type { DiveSite, DiveSiteInsert, SiteKind } from '../types/database'

// The shop's places — dive sites and adventure locations. One row per place, so
// "Bat Cave" is the same Bat Cave everywhere: the almanac files observations
// against it, and an event says which one it goes to.
//
// Any signed-in diver reads the catalog AND adds to it (20260827300000). What
// they cannot do is write the table directly: `create_dive_site` is the only
// way in, because `verified` and `created_by` are claims about a row that its
// author must not be the one making. Editing and deleting stay admin-only.

export type { DiveSiteInsert }

/**
 * A place's name in the language this deployment renders in.
 *
 * `name` is the English name and the fallback for everything: a site added by
 * an English-speaking diver has no Chinese name, and a Chinese-language
 * deployment showing a blank where a site should be is worse than showing it
 * in English. The fallback is deliberate and one-way — there is no attempt to
 * guess a translation that nobody supplied.
 */
export function siteName(
  site: Pick<DiveSite, 'name' | 'name_zh_tw' | 'name_ja'>,
  language: string = siteConfig.locale.language,
): string {
  if (language === 'zh-TW') return site.name_zh_tw || site.name
  if (language === 'ja') return site.name_ja || site.name
  return site.name
}

/** A place's other names, for the times both are worth showing at once — the
 *  admin catalog, and the "did you mean" list, where seeing 蝙蝠洞 beside Bat
 *  Cave is what tells a diver the suggestion is the place they meant. */
export function otherSiteNames(
  site: Pick<DiveSite, 'name' | 'name_zh_tw' | 'name_ja'>,
  language: string = siteConfig.locale.language,
): string[] {
  const shown = siteName(site, language)
  return [site.name, site.name_zh_tw, site.name_ja]
    .filter((n): n is string => !!n && n !== shown)
}

export interface SimilarSite {
  id: string
  name: string
  name_zh_tw: string | null
  name_ja: string | null
  kind: SiteKind
  region: string | null
  verified: boolean
  active: boolean
  matched_name: string
  score: number
}

/**
 * Places already in the catalog whose name is close to what someone is typing.
 *
 * Deliberately a suggestion and not a gate. Two genuinely different sites can
 * have similar names — Iron House 2 and Iron House / Iron Reef are both real,
 * a hundred metres apart — and a diver standing on the shore knows which one
 * they mean better than a trigram does. What this prevents is the OTHER case:
 * someone typing "Batcave" because they could not find Bat Cave.
 */
export async function findSimilarDiveSites(
  name: string, kind?: SiteKind,
): Promise<SimilarSite[]> {
  if (name.trim().length < 2) return []
  const { data, error } = await supabase.rpc('find_similar_dive_sites', {
    p_name: name.trim(),
    p_kind: kind ?? null,
  })
  if (error) throw error
  return (data ?? []) as SimilarSite[]
}

/** Add a place. Returns its id, so the caller can select it straight away —
 *  the diver added it because they had an observation to file against it. */
export async function createDiveSite(input: {
  name: string
  kind: SiteKind
  name_zh_tw?: string | null
  name_ja?: string | null
  region?: string | null
  latitude?: number | null
  longitude?: number | null
  aliases?: string[]
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_dive_site', {
    p_name: input.name.trim(),
    p_kind: input.kind,
    p_name_zh_tw: input.name_zh_tw?.trim() || null,
    p_name_ja: input.name_ja?.trim() || null,
    p_region: input.region?.trim() || null,
    p_latitude: input.latitude ?? null,
    p_longitude: input.longitude ?? null,
    p_aliases: input.aliases?.length ? input.aliases : null,
  })
  if (error) throw error
  return data as string
}

/** Staff confirm a place is real and correctly named. */
export async function verifyDiveSite(siteId: string, verified = true): Promise<void> {
  const { error } = await supabase.rpc('verify_dive_site', {
    p_site_id: siteId, p_verified: verified,
  })
  if (error) throw error
}

/** Fold a duplicate into the real place. Its observations come across and its
 *  names survive as aliases, so the spelling that caused the duplicate finds
 *  the survivor next time. */
export async function mergeDiveSites(keepId: string, mergeId: string): Promise<void> {
  const { error } = await supabase.rpc('merge_dive_sites', {
    p_keep: keepId, p_merge: mergeId,
  })
  if (error) throw error
}

/** Every site, active first, then alphabetical — the admin list. */
export async function fetchDiveSites(): Promise<DiveSite[]> {
  const { data, error } = await supabase
    .from('dive_sites').select('*').order('active', { ascending: false }).order('name')
  if (error) throw error
  return (data ?? []) as DiveSite[]
}

/** Insert (no id) or update (id given). */
export async function saveDiveSite(values: DiveSiteInsert, id?: string): Promise<void> {
  const { error } = id
    ? await supabase.from('dive_sites').update(values).eq('id', id)
    : await supabase.from('dive_sites').insert(values)
  if (error) throw error
}

export async function deleteDiveSite(id: string): Promise<void> {
  const { error } = await supabase.from('dive_sites').delete().eq('id', id)
  if (error) throw error
}
