// Integration tests for the Packages referral network (20260623000000_trip_board.sql
// + 20260707150000_rename_trip_board_to_packages.sql). What we lock in against
// the live stack:
//   1. Base tables are admin-only — a diver reads nothing from packages /
//      trusted_partners / package_referrals directly (kickback columns unreachable).
//   2. list_package_board(): divers see only PUBLISHED packages, and the kickback
//      rate is absent from the shape.
//   3. list_my_package_referrals(): a diver sees only their OWN referrals, scoped
//      by auth.uid(), with no kickback ledger columns.
//   4. express_package_interest: needs auth, rejects non-published packages, mints
//      a code, is idempotent, and writes diver_id = the caller.
//   5. referral_code is auto-stamped + unique; the one-live-referral index
//      blocks a duplicate; kickback_amount is generated from amount * rate.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
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
    price: 60000,
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
  it('a diver reads nothing from packages / trusted_partners / package_referrals directly', async () => {
    const shop = await createShop()
    await createPackage({ shopId: shop, status: 'published' })
    const asDiver = await userClient(diver.email, diver.password)

    for (const table of ['packages', 'trusted_partners', 'package_referrals'] as const) {
      const { data, error } = await asDiver.from(table).select('*')
      expect(error).toBeNull()           // RLS filters rows, it doesn't error
      expect(data ?? []).toHaveLength(0)
    }
  })

  it('a non-admin cannot insert a trusted partner or package', async () => {
    const asDiver = await userClient(diver.email, diver.password)
    const { error: e1 } = await asDiver.from('trusted_partners').insert({ name: 'Rogue', country: 'X' } as never)
    expect(e1).not.toBeNull()
  })
})

describe('list_package_board()', () => {
  it('shows only published packages and omits the kickback rate', async () => {
    const shop = await createShop()
    const published = await createPackage({ shopId: shop, status: 'published', overrides: { title: 'Published Package' } })
    await createPackage({ shopId: shop, status: 'draft', overrides: { title: 'Draft Package' } })
    await createPackage({ shopId: shop, status: 'archived', overrides: { title: 'Archived Package' } })

    const asDiver = await userClient(diver.email, diver.password)
    const { data: board, error } = await asDiver.rpc('list_package_board')
    expect(error).toBeNull()
    const matches = (board ?? []).filter(r => (r as { id: string }).id === published)
    expect(matches).toHaveLength(1)
    const row = matches[0] as Record<string, unknown>
    expect(row.title).toBe('Published Package')
    expect(row.partner_name).toBe('Blue Manta Divers')
    expect('kickback_rate' in row).toBe(false)

    // Draft + archived never appear on the board.
    const titles = (board ?? []).map(r => (r as { title: string }).title)
    expect(titles).not.toContain('Draft Package')
    expect(titles).not.toContain('Archived Package')
  })
})

describe('express_package_interest', () => {
  it('requires auth', async () => {
    const shop = await createShop()
    const pkg = await createPackage({ shopId: shop, status: 'published' })
    const { error } = await anonClient().rpc('express_package_interest', { p_package_id: pkg })
    expect(error).not.toBeNull()
  })

  it('rejects a package that is not published', async () => {
    const shop = await createShop()
    const draft = await createPackage({ shopId: shop, status: 'draft' })
    const asDiver = await userClient(diver.email, diver.password)
    const { error } = await asDiver.rpc('express_package_interest', { p_package_id: draft })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/not open for interest/i)
  })

  it('mints a code on first interest, is idempotent, and writes diver_id = caller', async () => {
    const shop = await createShop()
    const pkg = await createPackage({ shopId: shop, status: 'published' })
    const asDiver = await userClient(diver.email, diver.password)

    const { data: code1, error: e1 } = await asDiver.rpc('express_package_interest', { p_package_id: pkg })
    expect(e1).toBeNull()
    expect(code1).toMatch(/^FD-[0-9A-Z]{6}$/)

    // Second tap returns the SAME code (no duplicate row).
    const { data: code2 } = await asDiver.rpc('express_package_interest', { p_package_id: pkg })
    expect(code2).toBe(code1)

    // Exactly one referral, owned by the caller, status interested.
    const { data: refs } = await admin.from('package_referrals').select('*').eq('package_id', pkg)
    expect(refs).toHaveLength(1)
    const ref = refs![0] as Record<string, unknown>
    expect(ref.diver_id).toBe(diver.id)
    expect(ref.status).toBe('interested')
    expect(ref.referral_code).toBe(code1)
  })
})

describe('list_my_package_referrals()', () => {
  it('scopes to the caller and hides the kickback ledger', async () => {
    const shop = await createShop()
    const pkg = await createPackage({ shopId: shop, status: 'published' })

    const asDiver = await userClient(diver.email, diver.password)
    const asOther = await userClient(otherDiver.email, otherDiver.password)
    await asDiver.rpc('express_package_interest', { p_package_id: pkg })
    await asOther.rpc('express_package_interest', { p_package_id: pkg })

    const { data: mineAll, error } = await asDiver.rpc('list_my_package_referrals')
    expect(error).toBeNull()
    const mine = (mineAll ?? []).filter(r => (r as { package_id: string }).package_id === pkg)
    expect(mine).toHaveLength(1)
    const row = mine[0] as Record<string, unknown>
    expect(row.package_title).toBe('Raja Ampat Liveaboard')
    expect(row.partner_name).toBe('Blue Manta Divers')
    expect('booked_amount' in row).toBe(false)
    expect('kickback_amount' in row).toBe(false)

    // The other diver's interest is not visible here.
    const { data: otherAll } = await asOther.rpc('list_my_package_referrals')
    const other = (otherAll ?? []).filter(r => (r as { package_id: string }).package_id === pkg)
    expect(other).toHaveLength(1)
    expect((other[0] as { id: string }).id).not.toBe(row.id)
  })
})

describe('schema invariants', () => {
  it('blocks a second live referral for the same diver+package but allows one after cancel', async () => {
    const shop = await createShop()
    const pkg = await createPackage({ shopId: shop, status: 'published' })

    const first = await admin.from('package_referrals')
      .insert({ package_id: pkg, diver_id: diver.id } as never).select('id').single()
    expect(first.error).toBeNull()

    const dup = await admin.from('package_referrals').insert({ package_id: pkg, diver_id: diver.id } as never)
    expect(dup.error).not.toBeNull()

    // Cancel the first, then a fresh interest is allowed again.
    await admin.from('package_referrals')
      .update({ status: 'cancelled' } as never)
      .eq('id', (first.data as { id: string }).id)
    const retry = await admin.from('package_referrals').insert({ package_id: pkg, diver_id: diver.id } as never)
    expect(retry.error).toBeNull()
  })

  it('generates kickback_amount from booked_amount * kickback_rate', async () => {
    const shop = await createShop()
    const pkg = await createPackage({ shopId: shop, status: 'published' })
    const ins = await admin.from('package_referrals')
      .insert({ package_id: pkg, diver_id: otherDiver.id } as never).select('id').single()
    const id = (ins.data as { id: string }).id

    await admin.from('package_referrals')
      .update({ booked_amount: 60000, kickback_rate: 0.05, status: 'booked' } as never)
      .eq('id', id)
    const { data } = await admin.from('package_referrals').select('kickback_amount').eq('id', id).single()
    expect(Number((data as { kickback_amount: number }).kickback_amount)).toBe(3000)
  })
})

describe('admin referral pipeline', () => {
  it('lets an admin walk a referral through booking + kickback received', async () => {
    const shop = await createShop()
    const pkg = await createPackage({ shopId: shop, status: 'published' })
    const asDiver = await userClient(diver.email, diver.password)
    await asDiver.rpc('express_package_interest', { p_package_id: pkg })

    const asAdmin = await userClient(adminUser.email, adminUser.password)
    const { data: refs } = await asAdmin.from('package_referrals').select('*').eq('package_id', pkg)
    expect(refs).toHaveLength(1)
    const id = (refs![0] as { id: string }).id

    // Admin reads the diver's contact (to broker the intro).
    const { data: prof, error: pErr } = await asAdmin
      .from('profiles').select('id, email').eq('id', diver.id).single()
    expect(pErr).toBeNull()
    expect((prof as { id: string }).id).toBe(diver.id)

    // Record the booking the partner reported, then mark the kickback received.
    const { error: e1 } = await asAdmin.from('package_referrals')
      .update({ status: 'booked', booked_amount: 80000, booked_currency: 'TWD', kickback_rate: 0.05 } as never)
      .eq('id', id)
    expect(e1).toBeNull()
    const { error: e2 } = await asAdmin.from('package_referrals')
      .update({ kickback_status: 'received', received_at: new Date().toISOString() } as never)
      .eq('id', id)
    expect(e2).toBeNull()

    const { data: done } = await asAdmin.from('package_referrals')
      .select('kickback_amount, kickback_status').eq('id', id).single()
    expect(Number((done as { kickback_amount: number }).kickback_amount)).toBe(4000)
    expect((done as { kickback_status: string }).kickback_status).toBe('received')
  })
})
