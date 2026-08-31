import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Pins the payment_methods contract: publicly readable (the register form has
// to render the options before the diver is signed in), admin-written, and
// constrained so a method can't be saved in a shape the renderer or the money
// math would mishandle.

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser

const createdIds: string[] = []

function uniqKey() {
  return `test_${Math.random().toString(36).slice(2, 10)}`
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver     = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  for (const id of createdIds) await admin.from('payment_methods').delete().eq('id', id)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diver)     await deleteTestUser(admin, diver.id)
})

describe('payment_methods read access', () => {
  it('ships the shop the methods its bookings already reference', async () => {
    const { data, error } = await admin
      .from('payment_methods').select('key').order('sort_order')
    expect(error).toBeNull()
    const keys = (data ?? []).map(m => m.key)
    // The four hardcoded methods the seed carried over, so no existing
    // booking's details.payment_method stops resolving.
    for (const k of ['bank_transfer', 'paypal', 'credit_card', 'cash']) {
      expect(keys).toContain(k)
    }
  })

  it('is readable signed out — the register form renders before sign-in', async () => {
    const { data, error } = await anonClient()
      .from('payment_methods').select('key,label').limit(1)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(1)
  })

  it('is readable by a plain diver', async () => {
    const sb = await userClient(diver.email, diver.password)
    const { data, error } = await sb.from('payment_methods').select('key')
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThanOrEqual(4)
  })
})

describe('payment_methods writes are admin-only', () => {
  it('admin can insert, update and delete', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const key = uniqKey()
    const { data, error } = await sb
      .from('payment_methods')
      .insert({ key, label: 'Test transfer', account_number: '1234-5678' })
      .select('id').single<{ id: string }>()
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    createdIds.push(data!.id)

    const { error: upErr } = await sb
      .from('payment_methods').update({ surcharge_percent: 3 }).eq('id', data!.id)
    expect(upErr).toBeNull()

    const { error: delErr } = await sb
      .from('payment_methods').delete().eq('id', data!.id)
    expect(delErr).toBeNull()
  })

  it('a diver cannot insert, update or delete', async () => {
    const sb = await userClient(diver.email, diver.password)
    const { error: insErr } = await sb
      .from('payment_methods').insert({ key: uniqKey(), label: 'Diver made this' })
    expect(insErr).not.toBeNull()

    const { data: existing } = await admin
      .from('payment_methods').select('id').eq('key', 'cash').single<{ id: string }>()

    // RLS filters rather than errors on update/delete: the row simply isn't
    // visible to write, so nothing changes.
    await sb.from('payment_methods').update({ label: 'Hijacked' }).eq('id', existing!.id)
    await sb.from('payment_methods').delete().eq('id', existing!.id)
    const { data: after } = await admin
      .from('payment_methods').select('label').eq('id', existing!.id).single<{ label: string }>()
    expect(after).not.toBeNull()
    expect(after!.label).not.toBe('Hijacked')
  })
})

describe('payment_methods constraints', () => {
  async function insert(row: Record<string, unknown>) {
    const { data, error } = await admin
      .from('payment_methods')
      // @ts-expect-error — deliberately invalid shapes
      .insert({ label: 'Test', ...row }).select('id').single<{ id: string }>()
    if (data) createdIds.push(data.id)
    return error
  }

  it('rejects a key that is not a lowercase slug', async () => {
    for (const bad of ['Bank Transfer', 'bank-transfer', 'bank transfer', '', 'BANK']) {
      expect(await insert({ key: bad })).not.toBeNull()
    }
  })

  it('rejects a duplicate key — the value bookings resolve through', async () => {
    expect(await insert({ key: 'cash' })).not.toBeNull()
  })

  it('rejects a blank label', async () => {
    const { error } = await admin
      .from('payment_methods').insert({ key: uniqKey(), label: '   ' })
    expect(error).not.toBeNull()
  })

  it('rejects a surcharge outside 0–100', async () => {
    expect(await insert({ key: uniqKey(), surcharge_percent: -1 })).not.toBeNull()
    expect(await insert({ key: uniqKey(), surcharge_percent: 101 })).not.toBeNull()
  })

  it('rejects a payment link that is not an http(s) URL', async () => {
    expect(await insert({ key: uniqKey(), pay_url: 'paypal.me/example' })).not.toBeNull()
    expect(await insert({ key: uniqKey(), pay_url: 'javascript:alert(1)' })).not.toBeNull()
  })

  it('accepts a fully-filled transfer method', async () => {
    const { data, error } = await admin.from('payment_methods').insert({
      key: uniqKey(),
      label: 'International transfer',
      surcharge_percent: 2.5,
      bank_name: 'CTBC Bank',
      bank_branch: 'Yonghe',
      bank_code: '822',
      account_number: '1234-5678-9012',
      account_holder: 'The Shop',
      swift_bic: 'CTCBTWTP',
      pay_url: 'https://paypal.me/example',
      notes: 'Sender pays the wire fee.',
      sort_order: 99,
    }).select('id, surcharge_percent').single<{ id: string; surcharge_percent: number }>()
    expect(error).toBeNull()
    if (data) createdIds.push(data.id)
    expect(Number(data!.surcharge_percent)).toBe(2.5)
  })
})
