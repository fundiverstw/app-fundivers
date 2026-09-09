import { describe, it, expect } from 'vitest'
import {
  attachNames, commonName, displayName, labelIsScientific, lineageOf, normalize,
  ownRecordsFrom, ranksBelow, scientificNameProblem, searchTaxa, selectableTaxa, taxonIndex,
} from './taxa'
import type { AlmanacRecordRow, Taxon, TaxonNameRow, TaxonRow } from '../types/database'

const taxon = (over: Partial<Taxon> = {}): Taxon => ({
  id: 'taxon-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  rank: 'species',
  scientific_name: 'Chelonia mydas',
  authority: null,
  worms_aphia_id: null,
  parent_id: null,
  accepted_id: null,
  status: 'approved',
  proposed_by: null,
  reviewed_by: null,
  reviewed_at: null,
  staff_notes: null,
  taxon_names: [],
  ...over,
})

const name = (over: Partial<TaxonNameRow> = {}): TaxonNameRow => ({
  id: 'name-1',
  created_at: '2026-01-01T00:00:00Z',
  taxon_id: 'taxon-1',
  lang: 'en',
  name: 'green sea turtle',
  is_primary: true,
  ...over,
})

describe('what an animal is called', () => {
  it('prints the name in the language the deployment renders in', () => {
    const t = taxon({ taxon_names: [name(), name({ id: 'n2', lang: 'ja', name: 'アオウミガメ' })] })
    expect(displayName(t, 'ja')).toBe('アオウミガメ')
    expect(displayName(t, 'en')).toBe('green sea turtle')
  })

  it('prefers the primary name where a language carries several', () => {
    const t = taxon({ taxon_names: [
      name({ id: 'n1', name: 'green turtle', is_primary: false }),
      name({ id: 'n2', name: 'green sea turtle', is_primary: true }),
    ] })
    expect(commonName(t, 'en')).toBe('green sea turtle')
  })

  // English is the catalog's schema language and the scientific name is never
  // wrong. What must NOT happen is a third language filling in: showing a
  // Japanese reader a Chinese label presents one language's word as another's.
  it('falls back to English, then to the scientific name, and no further', () => {
    const withEnglish = taxon({ taxon_names: [name()] })
    expect(displayName(withEnglish, 'ja')).toBe('green sea turtle')

    const chineseOnly = taxon({ taxon_names: [name({ lang: 'zh-TW', name: '綠蠵龜' })] })
    expect(displayName(chineseOnly, 'ja')).toBe('Chelonia mydas')
    expect(labelIsScientific(chineseOnly, 'ja')).toBe(true)
  })
})

describe('searching the catalog', () => {
  const turtle = taxon({
    id: 'turtle',
    taxon_names: [name(), name({ id: 'n2', lang: 'ja', name: 'アオウミガメ' })],
  })
  const manta = taxon({
    id: 'manta',
    scientific_name: 'Mobula alfredi',
    taxon_names: [name({ id: 'n3', taxon_id: 'manta', name: 'reef manta ray' })],
  })
  const family = taxon({
    id: 'family',
    rank: 'family',
    scientific_name: 'Cheloniidae',
    taxon_names: [name({ id: 'n4', taxon_id: 'family', name: 'sea turtle' })],
  })

  // The point of the catalog: whatever language a diver knows the animal by
  // reaches the same row, so two divers cannot file it as two animals.
  it('matches a name in any language, not just the displayed one', () => {
    expect(searchTaxa([turtle, manta], 'アオウミガメ', 'en').map(t => t.id)).toEqual(['turtle'])
    expect(searchTaxa([turtle, manta], 'green sea', 'ja').map(t => t.id)).toEqual(['turtle'])
  })

  it('matches the scientific name, for whoever knows it', () => {
    expect(searchTaxa([turtle, manta], 'mobula', 'en').map(t => t.id)).toEqual(['manta'])
  })

  it('puts a name that starts with what was typed above one that merely contains it', () => {
    expect(searchTaxa([turtle, family], 'sea turtle', 'en').map(t => t.id))
      .toEqual(['family', 'turtle'])
  })

  it('returns nothing for an empty query rather than the whole catalog', () => {
    expect(searchTaxa([turtle, manta], '   ', 'en')).toEqual([])
  })

  it('ignores case and punctuation, so "Clark\'s" finds clarks', () => {
    expect(normalize("Clark's anemonefish")).toBe('clark s anemonefish')
  })
})

describe('what a diver may file against', () => {
  it('leaves synonyms and rejected names out of the picker', () => {
    const accepted = taxon({ id: 'keep' })
    const synonym = taxon({ id: 'old', scientific_name: 'Manta alfredi', status: 'rejected', accepted_id: 'keep' })
    const rejected = taxon({ id: 'no', scientific_name: 'Nonsense', status: 'rejected' })
    const pending = taxon({ id: 'mine', scientific_name: 'Pterois volitans', status: 'pending' })
    expect(selectableTaxa([accepted, synonym, rejected, pending]).map(t => t.id))
      .toEqual(['keep', 'mine'])
  })
})

describe('the rank ladder', () => {
  it('offers only ranks below a parent, since that is what the database allows', () => {
    expect(ranksBelow('family')).toEqual(['genus', 'species'])
    expect(ranksBelow('species')).toEqual([])
  })
})

describe('a scientific name a diver typed', () => {
  it('accepts a binomial for a species and a single word above it', () => {
    expect(scientificNameProblem('species', 'Chelonia mydas')).toBeNull()
    expect(scientificNameProblem('family', 'Cheloniidae')).toBeNull()
  })

  // The failure this whole change exists to prevent, caught by the form rather
  // than by a round trip that comes back as a constraint violation.
  it('refuses a common name, at either kind of rank', () => {
    expect(scientificNameProblem('species', 'green sea turtle')).toBe('binomial')
    expect(scientificNameProblem('family', 'sea turtles')).toBe('one_word')
    expect(scientificNameProblem('species', '  ')).toBe('blank')
  })
})

describe('the lineage of an entry', () => {
  it('walks up to the coarsest ancestor it holds, itself last', () => {
    const family = taxon({ id: 'f', rank: 'family', scientific_name: 'Cheloniidae' })
    const species = taxon({ id: 's', parent_id: 'f' })
    const byId = taxonIndex([family, species])
    expect(lineageOf(species, byId).map(t => t.id)).toEqual(['f', 's'])
  })

  it('stops rather than looping if the chain ever closed on itself', () => {
    const a = taxon({ id: 'a', rank: 'family', scientific_name: 'Aaa', parent_id: 'b' })
    const b = taxon({ id: 'b', rank: 'order', scientific_name: 'Bbb', parent_id: 'a' })
    expect(lineageOf(a, taxonIndex([a, b])).map(t => t.id)).toEqual(['b', 'a'])
  })
})

describe('joining the catalog to its names', () => {
  it('hands every taxon its own names and an empty list to the rest', () => {
    const rows: TaxonRow[] = [taxon({ id: 'a' }), taxon({ id: 'b' })]
    const joined = attachNames(rows, [name({ taxon_id: 'a' })])
    expect(joined[0].taxon_names).toHaveLength(1)
    expect(joined[1].taxon_names).toEqual([])
  })
})

describe("a diver's own records and their sightings", () => {
  const row = (id: string): AlmanacRecordRow => ({
    id,
    created_at: '2026-08-02T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
    diver_id: 'diver-1',
    site_id: 'site-1',
    obs_date: '2026-08-01',
    air_temp_c: null,
    water_temp_c: null,
    visibility_m: null,
    current_strength: null,
    wave_height_m: null,
    wave_period_s: null,
    weather: null,
    coral_health: null,
    elevation_m: null,
    route_condition: null,
    summit_visible: null,
    trash_band: null,
    trash_count: null,
    trash_kinds: [],
    status: 'pending',
    approved_by: null,
    approved_at: null,
    staff_notes: null,
  })

  // Two kinds of thing, kept apart: an id the catalog vouches for, and a
  // string nobody has. A surface that blended them would print an unchecked
  // label beside a curated one as if they carried the same weight.
  it('splits the sightings into taxa and the loose labels still awaiting one', () => {
    const [record] = ownRecordsFrom([row('r1')], [
      { record_id: 'r1', taxon_id: 'taxon-1', raw_label: null },
      { record_id: 'r1', taxon_id: null, raw_label: 'clownfish' },
      { record_id: 'r2', taxon_id: 'taxon-2', raw_label: null },
    ])
    expect(record.wildlife_taxa).toEqual(['taxon-1'])
    expect(record.wildlife_unmatched).toEqual(['clownfish'])
  })

  it('gives a record with nothing filed two empty lists, not undefined', () => {
    const [record] = ownRecordsFrom([row('r1')], [])
    expect(record.wildlife_taxa).toEqual([])
    expect(record.wildlife_unmatched).toEqual([])
  })
})
