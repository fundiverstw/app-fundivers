// Integration tests for the Packages registration network
// (20260708200000_packages_registration.sql). What we lock in against the live
// stack:
//   1. Base tables are admin-only — a diver reads nothing from packages /
//      package_tiers / package_registrations directly (kickback columns unreachable).
//   2. list_package_board(): divers see only PUBLISHED products, the kickback
//      rate is absent, and it carries min_price / tier_count / catalog id arrays.
//   3. list_package_tiers(): tiers of a published product only.
//   4. list_my_package_registrations(): a diver sees only their OWN rows, scoped
//      by auth.uid(), with no kickback ledger columns.
//   5. cancel_my_package_registration(): a diver cancels their OWN row (and only
//      their own); a cancel frees the one-live index for a retry.
//   6. kickback_amount is generated from estimated_cost * kickback_rate; the
//      one-live index blocks a duplicate live registration.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser
let otherDiver: TestUser
const cleanupUsers: string[] = []
const cleanupPackages: string[] = []
const cleanupShops: string[] = []

async function createShop(overrides: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin.from('trusted_partners').insert({
    name: 'Blue Manta Divers', country: 'Indonesia', ...overrides,
  } as never).select('id').single()
  if (error) throw new Error(`createShop failed: ${error.message}`)
  const id = (data as { id: string }).id
  cleanupShops.push(id)
  return id
}

async function createPackage(args: {
  shopId: string
  status?: 'draft' | 'published' | 'archived'
  overrides?: Record<string, unknown>
}): Promise<string> {
  const { data, error } = await admin.from('packages').insert({
    trusted_partner_id: args.shopId,
    title: 'Raja Ampat Liveaboard',
    destination: 'Raja Ampat, Indonesia',
    status: args.status ?? 'published',
    currency: 'TWD',
    kickback_rate: 0.05,
    published_at: args.status === 'published' || args.status === undefined ? new Date().toISOString() : null,
    ...args.overrides,
  } as never).select('id').single()
  if (error) throw new Error(`createPackage failed: ${error.message}`)
  const id = (data as { id: string }).id
  cleanupPackages.push(id)
  return id
}

async function createTier(packageId: string, name: string, price: number): Promise<string> {
  const { data, error } = await admin.from('package_tiers')
    .insert({ package_id: packageId, name, price, currency: 'TWD' } as never)
    .select('id').single()
  if (error) throw new Error(`createTier failed: ${error.message}`)
  return (data as { id: string }).id
}

/** Insert a registration the way the register-package edge function does
 *  (service role, estimate + kickback rate snapshotted). */
async function createRegistration(args: {
  packageId: string; diverId: string; tierId?: string; estimatedCost?: number; kickbackRate?: number
}) {
  return admin.from('package_registrations').insert({
    package_id: args.packageId,
    diver_id: args.diverId,
    tier_id: args.tierId ?? null,
    preferred_start: '2026-08-01',
    preferred_end: '2026-08-05',
    estimated_cost: args.estimatedCost ?? 60000,
    estimated_currency: 'TWD',
    kickback_rate: args.kickbackRate ?? 0.05,
  } as never).select('id').single()
}

beforeAll(async () => {
  adminUser  = await createTestUser(admin, { role: 'admin' })
  diver      = await createTestUser(admin, { role: 'diver' })
  otherDiver = await createTestUser(admin, { role: 'diver' })
  cleanupUsers.push(adminUser.id, diver.id, otherDiver.id)
})

afterAll(async () => {
  for (const id of cleanupPackages) await admin.from('packages').delete().eq('id', id)
  for (const id of cleanupShops) await admin.from('trusted_partners').delete().eq('id', id)
  for (const id of cleanupUsers) await deleteTestUser(admin, id)
})

describe('base tables are admin-only', () => {
  it('a diver reads nothing from packages / package_tiers / package_registrations directly', async () => {
    const shop = await createShop()
    const pkg = await createPackage({ shopId: shop, status: 'published' })
    await createTier(pkg, 'Package A', 60000)
    await createRegistration({ packageId: pkg, diverId: diver.id })
    const asDiver = await userClient(diver.email, diver.password)

    for (const table of ['packages', 'trusted_partners', 'package_tiers', 'package_registrations'] as const) {
      const { data, error } = await asDiver.from(table).select('*')
      expect(error).toBeNull()           // RLS filters rows, it doesn't error
      expect(data ?? []).toHaveLength(0)
    }
  })

  it('a non-admin cannot insert a package or tier', async () => {
    const shop = await createShop()
    const asDiver = await userClient(diver.email, diver.password)
    const { error: e1 } = await asDiver.from('packages')
      .insert({ trusted_partner_id: shop, title: 'Rogue', destination: 'X' } as never)
    expect(e1).not.toBeNull()
  })
})

describe('list_package_board()', () => {
  it('shows only published products, omits the kickback rate, and carries min_price + catalog ids', async () => {
    const shop = await createShop()
    const published = await createPackage({ shopId: shop, status: 'published', overrides: { title: 'Published Package' } })
    await createTier(published, 'A', 40000)
    await createTier(published, 'B', 60000)
    await createPackage({ shopId: shop, status: 'draft', overrides: { title: 'Draft Package' } })

    const asDiver = await userClient(diver.email, diver.password)
    const { data: board, error } = await asDiver.rpc('list_package_board')
    expect(error).toBeNull()
    const row = (board ?? []).find(r => (r as { id: string }).id === published) as Record<string, unknown>
    expect(row.title).toBe('Published Package')
    expect(row.partner_name).toBe('Blue Manta Divers')
    expect('kickback_rate' in row).toBe(false)
    expect(Number(row.min_price)).toBe(40000)
    expect(Number(row.tier_count)).toBe(2)
    expect(Array.isArray(row.addon_ids)).toBe(true)

    const titles = (board ?? []).map(r => (r as { title: string }).title)
    expect(titles).not.toContain('Draft Package')
  })

  it('hides a published product whose partner is inactive', async () => {
    const shop = await createShop({ active: false })
    const hidden = await createPackage({ shopId: shop, status: 'published', overrides: { title: 'Inactive Partner Package' } })
    await createTier(hidden, 'A', 40000)

    const asDiver = await userClient(diver.email, diver.password)
    const { data: board } = await asDiver.rpc('list_package_board')
    expect((board ?? []).some(r => (r as { id: string }).id === hidden)).toBe(false)
  })
})

describe('list_package_tiers()', () => {
  it('returns the tiers of a published product, cheapest first, and nothing for a draft', async () => {
    const shop = await createShop()
    const pub = await createPackage({ shopId: shop, status: 'published' })
    await createTier(pub, 'B', 60000)
    await createTier(pub, 'A', 40000)
    const draft = await createPackage({ shopId: shop, status: 'draft' })
    await createTier(draft, 'X', 10000)

    const asDiver = await userClient(diver.email, diver.password)
    const { data: tiers, error } = await asDiver.rpc('list_package_tiers', { p_package_id: pub })
    expect(error).toBeNull()
    expect((tiers ?? []).map(t => (t as { price: number }).price).map(Number)).toEqual([40000, 60000])

    const { data: none } = await asDiver.rpc('list_package_tiers', { p_package_id: draft })
    expect(none ?? []).toHaveLength(0)
  })
})

describe('list_my_package_registrations()', () => {
  it('scopes to the caller and hides the kickback ledger', async () => {
    const shop = await createShop()
    const pkg = await createPackage({ shopId: shop, status: 'published' })
    const tier = await createTier(pkg, 'A', 60000)
    await createRegistration({ packageId: pkg, diverId: diver.id, tierId: tier })
    await createRegistration({ packageId: pkg, diverId: otherDiver.id, tierId: tier })

    const asDiver = await userClient(diver.email, diver.password)
    const { data: mineAll, error } = await asDiver.rpc('list_my_package_registrations')
    expect(error).toBeNull()
    const mine = (mineAll ?? []).filter(r => (r as { package_id: string }).package_id === pkg)
    expect(mine).toHaveLength(1)
    const row = mine[0] as Record<string, unknown>
    expect(row.package_title).toBe('Raja Ampat Liveaboard')
    expect(row.tier_name).toBe('A')
    expect(Number(row.estimated_cost)).toBe(60000)
    expect('kickback_amount' in row).toBe(false)
    expect('kickback_rate' in row).toBe(false)
  })
})

describe('cancel_my_package_registration()', () => {
  it('cancels the caller’s own row and frees the one-live index for a retry', async () => {
    const shop = await createShop()
    const pkg = await createPackage({ shopId: shop, status: 'published' })
    const ins = await createRegistration({ packageId: pkg, diverId: diver.id })
    const id = (ins.data as { id: string }).id

    // A second live registration for the same diver+package is blocked.
    const dup = await createRegistration({ packageId: pkg, diverId: diver.id })
    expect(dup.error).not.toBeNull()

    const asDiver = await userClient(diver.email, diver.password)
    const { error } = await asDiver.rpc('cancel_my_package_registration', { p_id: id })
    expect(error).toBeNull()

    const { data: after } = await admin.from('package_registrations').select('status').eq('id', id).single()
    expect((after as { status: string }).status).toBe('cancelled')

    // Cancelling freed the index: a fresh registration is allowed again.
    const retry = await createRegistration({ packageId: pkg, diverId: diver.id })
    expect(retry.error).toBeNull()
  })

  it('cannot cancel another diver’s registration', async () => {
    const shop = await createShop()
    const pkg = await createPackage({ shopId: shop, status: 'published' })
    const ins = await createRegistration({ packageId: pkg, diverId: otherDiver.id })
    const id = (ins.data as { id: string }).id

    const asDiver = await userClient(diver.email, diver.password)
    await asDiver.rpc('cancel_my_package_registration', { p_id: id })
    const { data: after } = await admin.from('package_registrations').select('status').eq('id', id).single()
    expect((after as { status: string }).status).toBe('registered')
  })
})

describe('kickback ledger', () => {
  it('generates kickback_amount from estimated_cost * kickback_rate', async () => {
    const shop = await createShop()
    const pkg = await createPackage({ shopId: shop, status: 'published' })
    const ins = await createRegistration({ packageId: pkg, diverId: otherDiver.id, estimatedCost: 60000, kickbackRate: 0.05 })
    const id = (ins.data as { id: string }).id
    const { data } = await admin.from('package_registrations').select('kickback_amount').eq('id', id).single()
    expect(Number((data as { kickback_amount: number }).kickback_amount)).toBe(3000)
  })

  it('lets an admin mark the kickback paid', async () => {
    const shop = await createShop()
    const pkg = await createPackage({ shopId: shop, status: 'published' })
    const ins = await createRegistration({ packageId: pkg, diverId: diver.id, estimatedCost: 80000 })
    const id = (ins.data as { id: string }).id

    const asAdmin = await userClient(adminUser.email, adminUser.password)
    const { error } = await asAdmin.from('package_registrations')
      .update({ kickback_status: 'paid', paid_at: new Date().toISOString() } as never).eq('id', id)
    expect(error).toBeNull()
    const { data } = await asAdmin.from('package_registrations')
      .select('kickback_amount, kickback_status').eq('id', id).single()
    expect(Number((data as { kickback_amount: number }).kickback_amount)).toBe(4000)
    expect((data as { kickback_status: string }).kickback_status).toBe('paid')
  })
})
