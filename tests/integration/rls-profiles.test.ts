import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { adminClient, createTestUser, deleteTestUser, userClient, anonClient, type TestUser } from './helpers'

const admin = adminClient()
let customer: TestUser
let other: TestUser
let staff: TestUser

beforeAll(async () => {
  customer = await createTestUser(admin)
  other = await createTestUser(admin)
  staff = await createTestUser(admin, { role: 'staff' })
})

afterAll(async () => {
  for (const u of [customer, other, staff]) {
    if (u) await deleteTestUser(admin, u.id).catch(() => {})
  }
})

// RLS is currently disabled app-wide (see migration 20260421130941_remote_schema.sql).
// Unskip this suite once RLS is re-enabled on public.profiles.
describe.skip('profiles RLS', () => {
  it('anon users see no profile rows', async () => {
    const anon = anonClient()
    const { data } = await anon.from('profiles').select('*').eq('id', customer.id)
    expect(data ?? []).toEqual([])
  })

  it('a customer can read their own profile', async () => {
    const c = await userClient(customer.email, customer.password)
    const { data, error } = await c.from('profiles').select('*').eq('id', customer.id).single()
    expect(error).toBeNull()
    expect(data!.id).toBe(customer.id)
  })

  it('a customer cannot read another user’s profile', async () => {
    const c = await userClient(customer.email, customer.password)
    const { data } = await c.from('profiles').select('*').eq('id', other.id)
    expect(data ?? []).toEqual([])
  })

  it('a customer can update their own profile', async () => {
    const c = await userClient(customer.email, customer.password)
    const { data, error } = await c
      .from('profiles')
      .update({ full_name: 'Ada' })
      .eq('id', customer.id)
      .select()
      .single()
    expect(error).toBeNull()
    expect(data!.full_name).toBe('Ada')
  })

  it('a customer cannot update another user’s profile', async () => {
    const c = await userClient(customer.email, customer.password)
    const { data, error } = await c
      .from('profiles')
      .update({ full_name: 'Hacked' })
      .eq('id', other.id)
      .select()
    // RLS silently returns zero affected rows; no error but also no data
    expect(error).toBeNull()
    expect(data ?? []).toEqual([])
  })

  it('staff can read every profile', async () => {
    const s = await userClient(staff.email, staff.password)
    const { data, error } = await s.from('profiles').select('id').in('id', [customer.id, other.id])
    expect(error).toBeNull()
    expect((data ?? []).map(r => r.id).sort()).toEqual([customer.id, other.id].sort())
  })
})
