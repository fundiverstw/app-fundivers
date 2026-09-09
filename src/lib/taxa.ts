/**
 * The wildlife catalog, as arithmetic.
 *
 * One animal, one row, keyed by its scientific name; every language's word for
 * it hangs off that row. Everything here is pure and network-free, so the
 * picker, the reading surfaces, the tallies and the admin page all resolve a
 * taxon to a label the same way — which is the point. The old free-text field
 * let "turtle", "Turtle" and "ウミガメ" be three different animals; a shared
 * resolver is what stops them becoming three different labels again on the way
 * back out.
 */
import type {
  AlmanacOwnRecord, AlmanacRecordRow, AlmanacSightingRow, Taxon, TaxonNameRow,
  TaxonRank, TaxonRow,
} from '../types/database'
import { TAXON_RANKS } from '../types/database'

/** Where a rank sits on the ladder, coarsest first. Mirrors the database's
 *  `taxon_rank_depth()`; a parent must sit strictly above its child. */
export function rankDepth(rank: TaxonRank): number {
  return TAXON_RANKS.indexOf(rank)
}

/** Ranks a taxon may be filed under a parent of this rank. */
export function ranksBelow(rank: TaxonRank): TaxonRank[] {
  return TAXON_RANKS.filter(r => rankDepth(r) > rankDepth(rank))
}

function namesFor(taxon: Taxon, lang: string): TaxonNameRow[] {
  return (taxon.taxon_names ?? []).filter(n => n.lang === lang)
}

/**
 * What this taxon is called in one language, or null if nothing calls it that.
 * The primary name wins where a taxon carries several; without a primary the
 * first is as good an answer as any and the admin page is where that gets
 * settled.
 */
export function commonName(taxon: Taxon, lang: string): string | null {
  const names = namesFor(taxon, lang)
  return (names.find(n => n.is_primary) ?? names[0])?.name ?? null
}

/**
 * The label to print.
 *
 * The deployment's language, then English, then the scientific name. English
 * is the one cross-language fallback because it is the catalog's schema
 * language — the one every entry is most likely to carry — and the scientific
 * name behind it is never wrong, only Latin. What this does NOT do is reach
 * for a third language: showing a Japanese reader a Chinese label because it
 * happened to exist would be presenting one language's word as another's.
 */
export function displayName(taxon: Taxon, lang: string): string {
  return commonName(taxon, lang) ?? commonName(taxon, 'en') ?? taxon.scientific_name
}

/** True when the label a surface prints IS the scientific name — the caller
 *  then has no second line to add, and printing it twice reads as a bug. */
export function labelIsScientific(taxon: Taxon, lang: string): boolean {
  return displayName(taxon, lang) === taxon.scientific_name
}

/** Casefolded and stripped of accents, so "Clark's" and "clarks" match and a
 *  Japanese or Chinese name is compared as itself. */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** The taxa a diver can file against: the approved catalog plus their own
 *  proposals. Synonyms are never offered — they resolve to their target on
 *  write, so offering both would put two rows in the list for one animal. */
export function selectableTaxa(taxa: readonly Taxon[]): Taxon[] {
  return taxa.filter(t => t.accepted_id === null && t.status !== 'rejected')
}

/**
 * Search the catalog by any name it carries, in any language.
 *
 * Every language on purpose: a Japanese diver types ウミガメ and an English one
 * types turtle, and both have to reach Cheloniidae or the catalog is only
 * usable by whoever shares its language. The scientific name is searched too,
 * so somebody who knows it can go straight there.
 *
 * Ordering is by where the match landed, not by how many characters matched: a
 * name that STARTS with what was typed is what the typist is reaching for, and
 * a name in their own language beats the same match in another.
 */
export function searchTaxa(taxa: readonly Taxon[], query: string, lang: string): Taxon[] {
  const q = normalize(query)
  if (!q) return []

  const scored: { taxon: Taxon; score: number }[] = []
  for (const taxon of taxa) {
    let best = Infinity
    const consider = (value: string, langBonus: number) => {
      const n = normalize(value)
      if (!n.includes(q)) return
      best = Math.min(best, (n.startsWith(q) ? 0 : 2) + langBonus)
    }
    consider(taxon.scientific_name, 1)
    for (const name of taxon.taxon_names ?? []) {
      consider(name.name, name.lang === lang ? 0 : 1)
    }
    if (best < Infinity) scored.push({ taxon, score: best })
  }

  return scored
    .sort((a, b) => a.score - b.score
      || displayName(a.taxon, lang).localeCompare(displayName(b.taxon, lang)))
    .map(s => s.taxon)
}

/** By id, for the surfaces that hold sighting ids and need the animal. */
export function taxonIndex(taxa: readonly Taxon[]): Map<string, Taxon> {
  return new Map(taxa.map(taxon => [taxon.id, taxon]))
}

/** A taxon's ancestors, coarsest first, followed by the taxon itself. Stops on
 *  a parent that is not in hand rather than guessing, and cannot loop on a
 *  cycle the database should never have let in. */
export function lineageOf(taxon: Taxon, byId: Map<string, Taxon>): Taxon[] {
  const chain: Taxon[] = [taxon]
  const seen = new Set([taxon.id])
  let current = taxon
  while (current.parent_id) {
    const parent = byId.get(current.parent_id)
    if (!parent || seen.has(parent.id)) break
    chain.unshift(parent)
    seen.add(parent.id)
    current = parent
  }
  return chain
}

/**
 * What is wrong with a proposed scientific name, or null if nothing is.
 *
 * The same two shapes `taxa_scientific_name_shape_check` enforces, checked
 * here first so a diver proposing an animal is told "that is a common name,
 * not a scientific one" by the form instead of by a failed round trip. A
 * binomial for a species; one capitalized word for every rank above it.
 */
export type ScientificNameProblem = 'blank' | 'binomial' | 'one_word'

export function scientificNameProblem(
  rank: TaxonRank,
  name: string,
): ScientificNameProblem | null {
  const trimmed = name.trim()
  if (!trimmed) return 'blank'
  if (rank === 'species') {
    return /^[A-Z][a-z]+ [a-z]+(-[a-z]+)?$/.test(trimmed) ? null : 'binomial'
  }
  return /^[A-Z][a-z]+$/.test(trimmed) ? null : 'one_word'
}

/** The catalog as one object per animal: the rows and their names arrive as
 *  two reads (PostgREST embedding needs foreign-key metadata this hand-written
 *  Database type does not carry) and are joined here, once, for everybody. */
export function attachNames(
  taxa: readonly TaxonRow[],
  names: readonly TaxonNameRow[],
): Taxon[] {
  const byTaxon = new Map<string, TaxonNameRow[]>()
  for (const name of names) {
    const bucket = byTaxon.get(name.taxon_id)
    if (bucket) bucket.push(name)
    else byTaxon.set(name.taxon_id, [name])
  }
  return taxa.map(taxon => ({ ...taxon, taxon_names: byTaxon.get(taxon.id) ?? [] }))
}

/**
 * A diver's own records, with their sightings folded in.
 *
 * The table stopped carrying what was seen when sightings became rows, so the
 * "Your entries" read asks for both and this turns the pair into the same two
 * arrays the read RPCs return. One shape for every surface: a reading list that
 * had to know which query it came from would drift the day one of them changed.
 */
export function ownRecordsFrom(
  rows: readonly AlmanacRecordRow[],
  sightings: readonly Pick<AlmanacSightingRow, 'record_id' | 'taxon_id' | 'raw_label'>[],
): AlmanacOwnRecord[] {
  const byRecord = new Map<string, typeof sightings[number][]>()
  for (const sighting of sightings) {
    const bucket = byRecord.get(sighting.record_id)
    if (bucket) bucket.push(sighting)
    else byRecord.set(sighting.record_id, [sighting])
  }
  return rows.map(row => {
    const filed = byRecord.get(row.id) ?? []
    return {
      ...row,
      wildlife_taxa: filed
        .map(s => s.taxon_id)
        .filter((id): id is string => id !== null),
      wildlife_unmatched: filed
        .map(s => s.raw_label)
        .filter((label): label is string => label !== null),
    }
  })
}
