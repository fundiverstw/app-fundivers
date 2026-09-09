// Integration tests for the wildlife catalog (20260909100000) — the taxa an
// almanac sighting is filed against, and the names hung on them. What we lock
// in:
//   1. The identity rules: one scientific name, case-insensitively, in the
//      shape its rank demands, under a parent that sits above it.
//   2. One common name means one animal within a language. This is the
//      constraint that keeps the free-text problem from coming back a table
//      later.
//   3. Both tables are read-only to `authenticated`; every write is an RPC.
//   4. propose_taxon gets-or-proposes rather than minting duplicates, and a
//      proposal is visible to its author and staff and to nobody else.
//   5. Sightings: filed by id, replaced wholesale on a revision, deduplicated,
//      resolved through synonyms, and refused when the id is not the caller's
//      to file against.
//   6. A record naming an unreviewed animal cannot be approved.
//   7. Merging moves the sightings and leaves the losing name pointing at the
//      winner, so an old name still resolves to the right animal.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

const admin = adminClient()
let staff: TestUser
let diver: TestUser
let otherDiver: TestUser
let siteId: string
const madeTaxa: string[] = []

const YESTERDAY = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA')

/** A scientific name nothing else in the catalog can collide with. */
function uniqueBinomial(): string {
  const tail = Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 6) || 'testis'
  return `Testgenus ${tail}`
}

async function makeTaxon(fields: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin
    .from('taxa')
    .insert(fields as never)
    .select('id').single()
  if (error) throw new Error(`taxon insert failed: ${error.message}`)
  const id = (data as { id: string }).id
  madeTaxa.push(id)
  return id
}

async function sightingsOf(recordId: string) {
  const { data } = await admin
    .from('almanac_sightings')
    .select('taxon_id, raw_label')
    .eq('record_id', recordId)
  return data ?? []
}

beforeAll(async () => {
  staff = await createTestUser(admin, { role: 'staff' })
  diver = await createTestUser(admin, { role: 'diver' })
  otherDiver = await createTestUser(admin, { role: 'diver' })
  const { data, error } = await admin
    .from('dive_sites')
    .insert({ name: `Taxon Reef ${crypto.randomUUID().slice(0, 8)}`, kind: 'dive' } as never)
    .select('id').single()
  if (error) throw new Error(`dive site insert failed: ${error.message}`)
  siteId = (data as { id: string }).id
})

afterAll(async () => {
  await admin.from('almanac_records').delete().eq('site_id', siteId)
  await admin.from('dive_sites').delete().eq('id', siteId)
  // Children first: the parent FK is RESTRICT, so a lineage has to come apart
  // from the bottom.
  for (const id of [...madeTaxa].reverse()) await admin.from('taxa').delete().eq('id', id)
  for (const u of [staff, diver, otherDiver]) await deleteTestUser(admin, u.id)
})

describe('what a scientific name has to be', () => {
  it('refuses a common name where a species name belongs', async () => {
    const { error } = await admin
      .from('taxa')
      .insert({ rank: 'species', scientific_name: 'green sea turtle' } as never)
    expect(error?.message).toContain('taxa_scientific_name_shape_check')
  })

  it('refuses a two-word name above species', async () => {
    const { error } = await admin
      .from('taxa')
      .insert({ rank: 'family', scientific_name: 'Sea turtles' } as never)
    expect(error?.message).toContain('taxa_scientific_name_shape_check')
  })

  // The duplicate this whole schema exists to prevent, in its purest form.
  it('holds one row per name, whatever the capitalization', async () => {
    const name = uniqueBinomial()
    await makeTaxon({ rank: 'species', scientific_name: name })
    const { error } = await admin
      .from('taxa')
      .insert({ rank: 'species', scientific_name: name.toLowerCase() } as never)
    expect(error).not.toBeNull()
  })

  it('refuses a parent that does not sit above the child', async () => {
    const speciesId = await makeTaxon({ rank: 'species', scientific_name: uniqueBinomial() })
    const { error } = await admin
      .from('taxa')
      .insert({ rank: 'family', scientific_name: 'Testfamilyidae', parent_id: speciesId } as never)
    expect(error?.message).toContain('taxon_parent_rank_not_above')
  })

  it('refuses a species filed under a genus that is not its own', async () => {
    const genusId = await makeTaxon({ rank: 'genus', scientific_name: 'Testothergenus' })
    const { error } = await admin
      .from('taxa')
      .insert({
        rank: 'species', scientific_name: uniqueBinomial(), parent_id: genusId,
      } as never)
    expect(error?.message).toContain('taxon_species_genus_mismatch')
  })
})

describe('one name, one animal, per language', () => {
  it('refuses the same common name on a second taxon in the same language', async () => {
    const first = await makeTaxon({ rank: 'species', scientific_name: uniqueBinomial() })
    const second = await makeTaxon({ rank: 'species', scientific_name: uniqueBinomial() })
    const label = `test wrasse ${crypto.randomUUID().slice(0, 8)}`

    const ok = await admin.from('taxon_names')
      .insert({ taxon_id: first, lang: 'en', name: label } as never)
    expect(ok.error).toBeNull()

    const clash = await admin.from('taxon_names')
      .insert({ taxon_id: second, lang: 'en', name: label.toUpperCase() } as never)
    expect(clash.error).not.toBeNull()
  })

  // Different languages are different namespaces: the same string can be a
  // Japanese name for one animal and an English name for another.
  it('allows the same string in a different language', async () => {
    const taxonId = await makeTaxon({ rank: 'species', scientific_name: uniqueBinomial() })
    const label = `test-name-${crypto.randomUUID().slice(0, 8)}`
    await admin.from('taxon_names').insert({ taxon_id: taxonId, lang: 'en', name: label } as never)
    const { error } = await admin.from('taxon_names')
      .insert({ taxon_id: taxonId, lang: 'ja', name: label } as never)
    expect(error).toBeNull()
  })
})

describe('the catalog is read-only to clients', () => {
  it('refuses a direct insert into taxa from a diver', async () => {
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.from('taxa')
      .insert({ rank: 'species', scientific_name: uniqueBinomial() } as never)
    expect(error).not.toBeNull()
  })

  it('refuses a direct insert into taxon_names from a diver', async () => {
    const taxonId = await makeTaxon({ rank: 'species', scientific_name: uniqueBinomial() })
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.from('taxon_names')
      .insert({ taxon_id: taxonId, lang: 'en', name: 'whatever' } as never)
    expect(error).not.toBeNull()
  })

  it('refuses save_taxon and moderate_taxon to a diver', async () => {
    const client = await userClient(diver.email, diver.password)
    const saved = await client.rpc('save_taxon', {
      p_id: null, p_rank: 'species', p_scientific_name: uniqueBinomial(),
    })
    expect(saved.error?.message).toContain('staff or admin role required')

    const ruled = await client.rpc('moderate_taxon', {
      p_taxon_id: crypto.randomUUID(), p_status: 'approved',
    })
    expect(ruled.error?.message).toContain('staff or admin role required')
  })
})

describe('a diver proposing an animal', () => {
  it('files a pending entry that only its author and staff can see', async () => {
    const client = await userClient(diver.email, diver.password)
    const name = uniqueBinomial()
    const { data, error } = await client.rpc('propose_taxon', {
      p_rank: 'species', p_scientific_name: name, p_common_names: ['test fish'], p_lang: 'en',
    })
    expect(error).toBeNull()
    const taxonId = data as string
    madeTaxa.push(taxonId)

    const mine = await client.from('taxa').select('status').eq('id', taxonId).maybeSingle()
    expect(mine.data?.status).toBe('pending')

    const staffClient = await userClient(staff.email, staff.password)
    const theirs = await staffClient.from('taxa').select('id').eq('id', taxonId).maybeSingle()
    expect(theirs.data).not.toBeNull()

    const stranger = await userClient(otherDiver.email, otherDiver.password)
    const hidden = await stranger.from('taxa').select('id').eq('id', taxonId).maybeSingle()
    expect(hidden.data).toBeNull()
  })

  // Two divers proposing the same animal is the free-text problem again, one
  // table over. The second one gets the first one's row.
  it('hands back the existing entry instead of minting a second', async () => {
    const client = await userClient(diver.email, diver.password)
    const name = uniqueBinomial()
    const first = await client.rpc('propose_taxon', { p_rank: 'species', p_scientific_name: name })
    madeTaxa.push(first.data as string)

    const stranger = await userClient(otherDiver.email, otherDiver.password)
    const second = await stranger.rpc('propose_taxon', {
      p_rank: 'species', p_scientific_name: name.toLowerCase(),
    })
    expect(second.data).toBe(first.data)
  })

  // A fish is a lionfish and a turkeyfish. One box would have made the diver
  // pick a favorite, and the rest are what the next diver searches for.
  it('keeps every name given, and raises one of them as the one to print', async () => {
    const client = await userClient(diver.email, diver.password)
    const suffix = crypto.randomUUID().slice(0, 8)
    const { data } = await client.rpc('propose_taxon', {
      p_rank: 'species',
      p_scientific_name: uniqueBinomial(),
      p_common_names: [`lionfish ${suffix}`, `turkeyfish ${suffix}`, '  ', `lionfish ${suffix}`],
      p_lang: 'en',
    })
    const taxonId = data as string
    madeTaxa.push(taxonId)

    const { data: names } = await admin
      .from('taxon_names').select('name, is_primary').eq('taxon_id', taxonId)
    expect((names ?? []).map(n => n.name).sort())
      .toEqual([`lionfish ${suffix}`, `turkeyfish ${suffix}`])
    expect((names ?? []).filter(n => n.is_primary)).toHaveLength(1)
  })

  // Within a language a name means one animal, and a proposal is not where
  // that gets overturned. The taxon is still created and still usable.
  it('leaves a name that already belongs to another animal where it is', async () => {
    const taken = `sea unicorn ${crypto.randomUUID().slice(0, 8)}`
    const owner = await makeTaxon({ rank: 'species', scientific_name: uniqueBinomial() })
    await admin.from('taxon_names').insert({ taxon_id: owner, lang: 'en', name: taken } as never)

    const client = await userClient(diver.email, diver.password)
    const { data, error } = await client.rpc('propose_taxon', {
      p_rank: 'species', p_scientific_name: uniqueBinomial(),
      p_common_names: [taken], p_lang: 'en',
    })
    expect(error).toBeNull()
    madeTaxa.push(data as string)

    const { data: owned } = await admin
      .from('taxon_names').select('taxon_id').eq('name', taken).single()
    expect(owned!.taxon_id).toBe(owner)
  })

  it('follows a synonym to the name the catalog actually files under', async () => {
    const keepId = await makeTaxon({ rank: 'species', scientific_name: uniqueBinomial() })
    const oldName = uniqueBinomial()
    const synonymId = await makeTaxon({
      rank: 'species', scientific_name: oldName, status: 'rejected', accepted_id: keepId,
    })
    expect(synonymId).not.toBe(keepId)

    const client = await userClient(diver.email, diver.password)
    const { data } = await client.rpc('propose_taxon', {
      p_rank: 'species', p_scientific_name: oldName,
    })
    expect(data).toBe(keepId)
  })
})

describe('filing what was seen', () => {
  let turtleId: string
  let mantaId: string

  beforeAll(async () => {
    turtleId = await makeTaxon({ rank: 'species', scientific_name: uniqueBinomial() })
    mantaId = await makeTaxon({ rank: 'species', scientific_name: uniqueBinomial() })
  })

  async function fileRecord(client: Awaited<ReturnType<typeof userClient>>, taxonIds: string[]) {
    const { data, error } = await client.rpc('submit_almanac_record', {
      p_site_id: siteId,
      p_obs_date: YESTERDAY,
      p_taxon_ids: taxonIds,
    })
    expect(error).toBeNull()
    return data as string
  }

  it('writes one sighting per taxon, and replaces them wholesale on a revision', async () => {
    await admin.from('almanac_records').delete().eq('site_id', siteId)
    const client = await userClient(diver.email, diver.password)

    const recordId = await fileRecord(client, [turtleId, mantaId])
    expect((await sightingsOf(recordId)).map(s => s.taxon_id).sort())
      .toEqual([turtleId, mantaId].sort())

    // A revision states what the diver saw, not a delta against last time.
    await fileRecord(client, [turtleId])
    expect((await sightingsOf(recordId)).map(s => s.taxon_id)).toEqual([turtleId])
  })

  it('counts the same animal named twice as once', async () => {
    await admin.from('almanac_records').delete().eq('site_id', siteId)
    const client = await userClient(diver.email, diver.password)
    const recordId = await fileRecord(client, [turtleId, turtleId])
    expect(await sightingsOf(recordId)).toHaveLength(1)
  })

  it('files a synonym against the taxon it is a synonym of', async () => {
    await admin.from('almanac_records').delete().eq('site_id', siteId)
    const synonymId = await makeTaxon({
      rank: 'species', scientific_name: uniqueBinomial(), status: 'rejected', accepted_id: turtleId,
    })
    const client = await userClient(diver.email, diver.password)
    const recordId = await fileRecord(client, [synonymId])
    expect((await sightingsOf(recordId)).map(s => s.taxon_id)).toEqual([turtleId])
  })

  it("refuses another diver's pending proposal", async () => {
    await admin.from('almanac_records').delete().eq('site_id', siteId)
    const stranger = await userClient(otherDiver.email, otherDiver.password)
    const proposed = await stranger.rpc('propose_taxon', {
      p_rank: 'species', p_scientific_name: uniqueBinomial(),
    })
    madeTaxa.push(proposed.data as string)

    const client = await userClient(diver.email, diver.password)
    const { error } = await client.rpc('submit_almanac_record', {
      p_site_id: siteId,
      p_obs_date: YESTERDAY,
      p_taxon_ids: [proposed.data as string],
    })
    expect(error?.message).toContain('almanac_taxon_not_selectable')
  })
})

describe('ruling on a record that names an unreviewed animal', () => {
  it('blocks the approval until the animal itself has been ruled on', async () => {
    await admin.from('almanac_records').delete().eq('site_id', siteId)
    const client = await userClient(diver.email, diver.password)
    const proposed = await client.rpc('propose_taxon', {
      p_rank: 'species', p_scientific_name: uniqueBinomial(),
    })
    const taxonId = proposed.data as string
    madeTaxa.push(taxonId)

    const filed = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY, p_taxon_ids: [taxonId],
    })
    const recordId = filed.data as string

    const staffClient = await userClient(staff.email, staff.password)
    const blocked = await staffClient.rpc('moderate_almanac_record', {
      p_record_id: recordId, p_status: 'approved',
    })
    expect(blocked.error?.message).toContain('almanac_record_has_unreviewed_taxa')

    // The queue says which animal is holding it up, so staff are not guessing.
    const queue = await staffClient.rpc('almanac_pending_records')
    const row = (queue.data ?? []).find(r => r.id === recordId)
    expect(row?.unreviewed_taxa).toEqual([taxonId])

    await staffClient.rpc('moderate_taxon', { p_taxon_id: taxonId, p_status: 'approved' })
    const allowed = await staffClient.rpc('moderate_almanac_record', {
      p_record_id: recordId, p_status: 'approved',
    })
    expect(allowed.error).toBeNull()
  })

  // Throwing a record out does not need its wildlife adjudicated first.
  it('never blocks a rejection', async () => {
    await admin.from('almanac_records').delete().eq('site_id', siteId)
    const client = await userClient(diver.email, diver.password)
    const proposed = await client.rpc('propose_taxon', {
      p_rank: 'species', p_scientific_name: uniqueBinomial(),
    })
    madeTaxa.push(proposed.data as string)
    const filed = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY, p_taxon_ids: [proposed.data as string],
    })

    const staffClient = await userClient(staff.email, staff.password)
    const { error } = await staffClient.rpc('moderate_almanac_record', {
      p_record_id: filed.data as string, p_status: 'rejected',
    })
    expect(error).toBeNull()
  })
})

describe('folding a duplicate into the entry it duplicates', () => {
  it('moves the sightings, keeps the name as a synonym, and drops a collision', async () => {
    await admin.from('almanac_records').delete().eq('site_id', siteId)
    const keepId = await makeTaxon({ rank: 'species', scientific_name: uniqueBinomial() })
    const client = await userClient(diver.email, diver.password)
    const duplicate = await client.rpc('propose_taxon', {
      p_rank: 'species', p_scientific_name: uniqueBinomial(),
    })
    const duplicateId = duplicate.data as string
    madeTaxa.push(duplicateId)

    // One record names both, which after the merge is one animal named twice.
    const filed = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY, p_taxon_ids: [keepId, duplicateId],
    })
    const recordId = filed.data as string
    expect(await sightingsOf(recordId)).toHaveLength(2)

    const staffClient = await userClient(staff.email, staff.password)
    const { error } = await staffClient.rpc('moderate_taxon', {
      p_taxon_id: duplicateId, p_status: 'rejected', p_accepted_id: keepId,
    })
    expect(error).toBeNull()

    expect((await sightingsOf(recordId)).map(s => s.taxon_id)).toEqual([keepId])

    const merged = await admin.from('taxa')
      .select('status, accepted_id').eq('id', duplicateId).single()
    expect(merged.data!.status).toBe('rejected')
    expect(merged.data!.accepted_id).toBe(keepId)
  })

  it('refuses to delete an entry sightings are filed against', async () => {
    await admin.from('almanac_records').delete().eq('site_id', siteId)
    const taxonId = await makeTaxon({ rank: 'species', scientific_name: uniqueBinomial() })
    const client = await userClient(diver.email, diver.password)
    await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY, p_taxon_ids: [taxonId],
    })

    const staffClient = await userClient(staff.email, staff.password)
    const { error } = await staffClient.rpc('delete_taxon', { p_taxon_id: taxonId })
    expect(error?.message).toContain('taxon_has_sightings')
  })
})

describe('the free text left over from before the catalog', () => {
  it('maps every sighting that says one label onto a taxon, in one action', async () => {
    await admin.from('almanac_records').delete().eq('site_id', siteId)
    const taxonId = await makeTaxon({ rank: 'species', scientific_name: uniqueBinomial() })
    const client = await userClient(diver.email, diver.password)
    const filed = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY, p_taxon_ids: [],
    })
    const recordId = filed.data as string
    const label = `clownfish ${crypto.randomUUID().slice(0, 8)}`
    await admin.from('almanac_sightings')
      .insert({ record_id: recordId, raw_label: label } as never)

    const staffClient = await userClient(staff.email, staff.password)
    const queue = await staffClient.rpc('almanac_unmatched_wildlife')
    expect((queue.data ?? []).some(row => row.label === label)).toBe(true)

    const mapped = await staffClient.rpc('map_unmatched_wildlife', {
      p_label: label, p_taxon_id: taxonId,
    })
    expect(mapped.data).toBe(1)
    expect(await sightingsOf(recordId)).toEqual([{ taxon_id: taxonId, raw_label: null }])
  })

  it('keeps the queue and the mapping to staff', async () => {
    const client = await userClient(diver.email, diver.password)
    const queue = await client.rpc('almanac_unmatched_wildlife')
    expect(queue.error?.message).toContain('staff or admin role required')
  })
})
