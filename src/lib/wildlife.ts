/**
 * Reading and writing the wildlife catalog.
 *
 * The arithmetic lives in `taxa.ts` and stays network-free; this is the layer
 * that talks to the database. The split is the same one the rest of the app
 * makes, and it matters more here than usual: every surface that shows an
 * animal resolves its name through the pure helpers, so a change of wording
 * cannot depend on which query the row arrived from.
 *
 * `authenticated` holds SELECT on both tables and nothing else. Every write is
 * a `SECURITY DEFINER` function, so who may approve a proposal, merge a
 * duplicate or rename an animal is decided in one place instead of in a policy
 * per column.
 */
import { supabase } from './supabase'
import { attachNames } from './taxa'
import type { Taxon, TaxonRank, TaxonRow, TaxonNameRow, UnmatchedWildlife } from '../types/database'

/**
 * The whole catalog, names attached.
 *
 * Two reads rather than one embedded read: PostgREST can nest `taxon_names`
 * inside `taxa`, but the typed inference for that needs foreign-key metadata
 * this project's hand-written `Database` type does not carry, and a catalog of
 * a few hundred rows is one small query either way.
 *
 * What comes back is what RLS allows: the approved catalog for everyone, plus
 * the caller's own pending proposals, plus everything for staff.
 */
export async function fetchTaxa(): Promise<Taxon[]> {
  const [catalog, names] = await Promise.all([
    supabase.from('taxa').select('*').order('scientific_name'),
    supabase.from('taxon_names').select('*'),
  ])
  if (catalog.error) throw catalog.error
  if (names.error) throw names.error
  return attachNames(
    (catalog.data ?? []) as TaxonRow[],
    (names.data ?? []) as TaxonNameRow[],
  )
}

/** A diver names an animal the catalog does not have. Returns the id to file
 *  the sighting against — the existing entry where the name is already known,
 *  a pending one otherwise. */
export async function proposeTaxon(
  rank: TaxonRank,
  scientificName: string,
  commonName: string,
  lang: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('propose_taxon', {
    p_rank: rank,
    p_scientific_name: scientificName,
    p_common_name: commonName || null,
    p_lang: commonName ? lang : null,
  })
  if (error) throw error
  return data as string
}

export interface TaxonDraft {
  rank: TaxonRank
  scientific_name: string
  authority: string | null
  worms_aphia_id: number | null
  parent_id: string | null
}

export async function saveTaxon(draft: TaxonDraft, id?: string): Promise<string> {
  const { data, error } = await supabase.rpc('save_taxon', {
    p_id: id ?? null,
    p_rank: draft.rank,
    p_scientific_name: draft.scientific_name,
    p_authority: draft.authority,
    p_worms_aphia_id: draft.worms_aphia_id,
    p_parent_id: draft.parent_id,
  })
  if (error) throw error
  return data as string
}

/** Rule on a proposal. `acceptedId` merges instead: the sightings move to that
 *  taxon and this name becomes a synonym pointing at it. */
export async function moderateTaxon(
  taxonId: string,
  status: 'approved' | 'rejected',
  acceptedId: string | null = null,
  staffNotes: string | null = null,
): Promise<void> {
  const { error } = await supabase.rpc('moderate_taxon', {
    p_taxon_id: taxonId,
    p_status: status,
    p_accepted_id: acceptedId,
    p_staff_notes: staffNotes,
  })
  if (error) throw error
}

export async function deleteTaxon(taxonId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_taxon', { p_taxon_id: taxonId })
  if (error) throw error
}

export async function setTaxonName(
  taxonId: string,
  lang: string,
  name: string,
  isPrimary: boolean,
  nameId?: string,
): Promise<void> {
  const { error } = await supabase.rpc('set_taxon_name', {
    p_taxon_id: taxonId,
    p_lang: lang,
    p_name: name,
    p_is_primary: isPrimary,
    p_name_id: nameId ?? null,
  })
  if (error) throw error
}

export async function deleteTaxonName(nameId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_taxon_name', { p_name_id: nameId })
  if (error) throw error
}

/** The pre-catalog free text still waiting to be mapped, commonest first. */
export async function fetchUnmatchedWildlife(): Promise<UnmatchedWildlife[]> {
  const { data, error } = await supabase.rpc('almanac_unmatched_wildlife')
  if (error) throw error
  return data ?? []
}

/** Point every sighting carrying one label at a taxon. Returns how many moved. */
export async function mapUnmatchedWildlife(label: string, taxonId: string): Promise<number> {
  const { data, error } = await supabase.rpc('map_unmatched_wildlife', {
    p_label: label,
    p_taxon_id: taxonId,
  })
  if (error) throw error
  return data as number
}
