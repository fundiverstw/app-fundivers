// Integration coverage for the unified trusted_partners table + the
// list_trusted_partners RPC (20260707220000). Runs against the live local
// Supabase stack.
//
// trusted_partners is now the single "dive shops abroad we vouch for" table
// (also hosts Packages). Security contract: a diver must NOT read a partner's
// contact email. RLS grants direct table access to admins only; divers read the
// public projection (name/region/blurb/website, no email) via the SECURITY
// DEFINER RPC, which returns every active partner plus a `contactable` boolean
// standing in for the withheld email (20260827000000).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient, createTestUser, deleteTestUser, type TestUser,
} from './helpers'

const admin = adminClient()
let diver: TestUser
let adminUser: TestUser
const cleanup: string[] = []

// Insert a trusted partner. `contactEmail` null models a partner the shop holds
// no address for — still listed, just not contactable.
async function createPartner(
  name: string, contactEmail: string | null, active = true, extra: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin.from('trusted_partners')
    .insert({ name, contact_email: contactEmail, active, ...extra } as never).select('id').single()
  if (error) throw new Error(`createPartner: ${error.message}`)
  const id = (data as { id: string }).id
  cleanup.push(id)
  return id
}

beforeAll(async () => {
  diver = await createTestUser(admin, { role: 'diver' })
  adminUser = await createTestUser(admin, { role: 'admin' })
})

afterAll(async () => {
  for (const id of cleanup) await admin.from('trusted_partners').delete().eq('id', id)
  for (const u of [diver, adminUser]) if (u) await deleteTestUser(admin, u.id)
})

describe('trusted_partners access', () => {
  it('hides the table from divers but exposes name/region/blurb/website (no email) via the RPC', async () => {
    const activeId = await createPartner('Blue Manta', 'bm@example.test', true, {
      location: 'Anilao', vouch_notes: 'Great muck diving.', website: 'https://bluemanta.example',
    })
    await createPartner('Retired Co', 'retired@example.test', false)

    const diverClient = await userClient(diver.email, diver.password)

    // Direct table read is denied by RLS → no rows (so no email leak).
    const direct = await diverClient.from('trusted_partners').select('*')
    expect(direct.data ?? []).toEqual([])

    // The RPC returns the active partner, projected WITHOUT any email column.
    const { data, error } = await diverClient.rpc('list_trusted_partners')
    expect(error).toBeNull()
    const rows = (data ?? []) as Array<Record<string, unknown>>
    const bm = rows.find(r => r.id === activeId)
    expect(bm).toBeTruthy()
    expect(bm).not.toHaveProperty('email')
    expect(bm).not.toHaveProperty('contact_email')
    expect(bm!.name).toBe('Blue Manta')
    expect(bm!.region).toBe('Anilao')                 // coalesce(location, country)
    expect(bm!.blurb).toBe('Great muck diving.')      // vouch_notes
    expect(bm!.website).toBe('https://bluemanta.example')
    expect(bm!.contactable).toBe(true)               // has an email, without exposing it
    // Retired partners are withheld.
    expect(rows.some(r => r.name === 'Retired Co')).toBe(false)
  })

  it('lists every active partner, flagging which ones can be messaged', async () => {
    const reachable = await createPartner('Manta Point Dive Co', 'mp@example.test', true, { location: 'Komodo' })
    // No contact email → still vouched for, still listed, just not contactable.
    const noEmail = await createPartner('Unreachable Shop', null, true)
    // Inactive → withheld. Active is the only thing that decides visibility.
    const inactive = await createPartner('Closed Shop', 'closed@example.test', false)

    const diverClient = await userClient(diver.email, diver.password)
    const { data, error } = await diverClient.rpc('list_trusted_partners')
    expect(error).toBeNull()
    const rows = (data ?? []) as Array<Record<string, unknown>>

    expect(rows.find(r => r.id === reachable)?.contactable).toBe(true)
    expect(rows.find(r => r.id === noEmail)?.contactable).toBe(false)
    expect(rows.some(r => r.id === inactive)).toBe(false)
  })

  it('maps region to coalesce(location, country)', async () => {
    const countryOnly = await createPartner('Country Only Co', 'co@example.test', true, { country: 'Palau', location: null })
    const withLocation = await createPartner('Located Co', 'lc@example.test', true, { country: 'Indonesia', location: 'Raja Ampat' })

    const diverClient = await userClient(diver.email, diver.password)
    const { data } = await diverClient.rpc('list_trusted_partners')
    const rows = (data ?? []) as Array<Record<string, unknown>>

    expect(rows.find(r => r.id === countryOnly)!.region).toBe('Palau')
    expect(rows.find(r => r.id === withLocation)!.region).toBe('Raja Ampat')
  })

  it('lets an admin read the full row including the contact email', async () => {
    const id = await createPartner('Admin View', 'av@example.test', true)
    const adminScoped = await userClient(adminUser.email, adminUser.password)
    const { data } = await adminScoped.from('trusted_partners')
      .select('*').eq('id', id).maybeSingle()
    expect((data as { contact_email?: string } | null)?.contact_email).toBe('av@example.test')
  })
})
