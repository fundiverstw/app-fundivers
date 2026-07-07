// Integration coverage for the trusted_partners catalog + list_trusted_partners
// RPC (20260703010000). Runs against the live local Supabase stack.
//
// The security contract: a diver must NOT be able to read a partner's email.
// RLS grants direct table access to admins only; divers read the public
// projection (name/region/blurb, no email) via the SECURITY DEFINER RPC, and
// only active partners are returned.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient, createTestUser, deleteTestUser, type TestUser,
} from './helpers'

const admin = adminClient()
let diver: TestUser
let adminUser: TestUser
const cleanup: string[] = []
const cleanupShops: string[] = []

async function createPartner(
  name: string, email: string, active = true, extra: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin.from('trusted_partners')
    .insert({ name, email, active, ...extra } as never).select('id').single()
  if (error) throw new Error(`createPartner: ${error.message}`)
  const id = (data as { id: string }).id
  cleanup.push(id)
  return id
}

// A Packages partner shop (public.partner_shops). Added for Packages, it should
// also surface on the Trusted Partners tab via list_trusted_partners().
async function createShop(overrides: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin.from('partner_shops').insert({
    name: 'Coral Cove Divers', country: 'Philippines', contact_email: 'shop@example.test',
    ...overrides,
  } as never).select('id').single()
  if (error) throw new Error(`createShop: ${error.message}`)
  const id = (data as { id: string }).id
  cleanupShops.push(id)
  return id
}

beforeAll(async () => {
  diver = await createTestUser(admin, { role: 'diver' })
  adminUser = await createTestUser(admin, { role: 'admin' })
})

afterAll(async () => {
  for (const id of cleanup) await admin.from('trusted_partners').delete().eq('id', id)
  for (const id of cleanupShops) await admin.from('partner_shops').delete().eq('id', id)
  for (const u of [diver, adminUser]) if (u) await deleteTestUser(admin, u.id)
})

describe('trusted_partners access', () => {
  it('hides the table from divers but exposes name/region/blurb (no email) via the RPC', async () => {
    const activeId = await createPartner('Blue Manta', 'bm@example.test', true)
    await createPartner('Retired Co', 'retired@example.test', false)

    const diverClient = await userClient(diver.email, diver.password)

    // Direct table read is denied by RLS → no rows (so no email leak).
    const direct = await diverClient.from('trusted_partners').select('*')
    expect(direct.data ?? []).toEqual([])

    // The RPC returns the active partner, projected WITHOUT the email column.
    const { data, error } = await diverClient.rpc('list_trusted_partners')
    expect(error).toBeNull()
    const rows = (data ?? []) as Array<Record<string, unknown>>
    const bm = rows.find(r => r.id === activeId)
    expect(bm).toBeTruthy()
    expect(bm).not.toHaveProperty('email')
    expect(bm!.name).toBe('Blue Manta')
    // Retired partners are withheld.
    expect(rows.some(r => r.name === 'Retired Co')).toBe(false)
  })

  it('surfaces Packages partner shops (active, with a contact email) via the RPC, mapped and email-free', async () => {
    const shopId = await createShop({
      name: 'Manta Point Dive Co', country: 'Indonesia', location: 'Komodo',
      vouch_notes: 'Great small-group operator.', contact_email: 'mp@example.test',
    })
    // A shop with no contact email can't be messaged, so it must NOT be listed.
    const noEmailId = await createShop({ name: 'Unreachable Shop', contact_email: null })
    // Inactive shops are withheld too.
    const inactiveId = await createShop({ name: 'Closed Shop', active: false })

    const diverClient = await userClient(diver.email, diver.password)

    // Divers still can't read partner_shops directly (kickback/contact columns).
    const direct = await diverClient.from('partner_shops').select('*')
    expect(direct.data ?? []).toEqual([])

    const { data, error } = await diverClient.rpc('list_trusted_partners')
    expect(error).toBeNull()
    const rows = (data ?? []) as Array<Record<string, unknown>>

    const shop = rows.find(r => r.id === shopId)
    expect(shop).toBeTruthy()
    expect(shop).not.toHaveProperty('email')
    expect(shop).not.toHaveProperty('contact_email')
    expect(shop!.name).toBe('Manta Point Dive Co')
    expect(shop!.region).toBe('Komodo')            // coalesce(location, country)
    expect(shop!.blurb).toBe('Great small-group operator.')

    expect(rows.some(r => r.id === noEmailId)).toBe(false)
    expect(rows.some(r => r.id === inactiveId)).toBe(false)
  })

  it('returns the partner website for both catalogs', async () => {
    const tpId = await createPartner('Sitely Co', 'site@example.test', true, { website: 'https://sitely.example' })
    const shopId = await createShop({ name: 'Webbed Divers', website: 'https://webbed.example' })

    const diverClient = await userClient(diver.email, diver.password)
    const { data } = await diverClient.rpc('list_trusted_partners')
    const rows = (data ?? []) as Array<Record<string, unknown>>

    expect(rows.find(r => r.id === tpId)!.website).toBe('https://sitely.example')
    expect(rows.find(r => r.id === shopId)!.website).toBe('https://webbed.example')
  })

  it('falls back to country when a partner shop has no location', async () => {
    const shopId = await createShop({ name: 'Country Only Co', country: 'Palau', location: null })
    const diverClient = await userClient(diver.email, diver.password)
    const { data } = await diverClient.rpc('list_trusted_partners')
    const shop = ((data ?? []) as Array<Record<string, unknown>>).find(r => r.id === shopId)
    expect(shop!.region).toBe('Palau')
  })

  it('lets an admin read the full row including the email', async () => {
    const id = await createPartner('Admin View', 'av@example.test', true)
    const adminScoped = await userClient(adminUser.email, adminUser.password)
    const { data } = await adminScoped.from('trusted_partners')
      .select('*').eq('id', id).maybeSingle()
    expect((data as { email?: string } | null)?.email).toBe('av@example.test')
  })
})
