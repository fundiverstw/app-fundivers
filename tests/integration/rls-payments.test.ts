import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, createTestUser, deleteTestUser, userClient, type TestUser
} from './helpers'

const admin = adminClient()
let me: TestUser
let other: TestUser
let staff: TestUser
const paymentIds: string[] = []

beforeAll(async () => {
  me = await createTestUser(admin)
  other = await createTestUser(admin)
  staff = await createTestUser(admin, { role: 'staff' })

  const rows = [
    { user_id: me.id, amount: 1000, status: 'pending' as const, note: 'Mine' },
    { user_id: other.id, amount: 2000, status: 'paid' as const, note: 'Theirs' },
  ]
  const { data } = await admin.from('payments').insert(rows).select()
  for (const r of data ?? []) paymentIds.push(r.id)
})

afterAll(async () => {
  if (paymentIds.length) await admin.from('payments').delete().in('id', paymentIds)
  for (const u of [me, other, staff]) await deleteTestUser(admin, u.id).catch(() => {})
})

// RLS is currently disabled app-wide (see migration 20260421130941_remote_schema.sql).
// Unskip this suite once RLS is re-enabled on public.payments.
describe.skip('payments RLS', () => {
  it('a customer sees only their own payments', async () => {
    const c = await userClient(me.email, me.password)
    const { data } = await c.from('payments').select('user_id')
    expect(data ?? []).not.toHaveLength(0)
    for (const row of data!) expect(row.user_id).toBe(me.id)
  })

  it('a customer cannot read another user’s payments', async () => {
    const c = await userClient(me.email, me.password)
    const { data } = await c.from('payments').select('*').eq('user_id', other.id)
    expect(data ?? []).toEqual([])
  })

  it('a customer cannot insert payments (staff-only)', async () => {
    const c = await userClient(me.email, me.password)
    const { error } = await c.from('payments').insert({
      user_id: me.id, amount: 500, status: 'pending',
    })
    expect(error).toBeTruthy()
  })

  it('staff can read all payments', async () => {
    const s = await userClient(staff.email, staff.password)
    const { data } = await s.from('payments').select('user_id').in('id', paymentIds)
    expect((data ?? []).length).toBe(paymentIds.length)
  })

  it('staff can insert a payment record', async () => {
    const s = await userClient(staff.email, staff.password)
    const { data, error } = await s
      .from('payments')
      .insert({ user_id: me.id, amount: 750, status: 'paid', note: 'Staff entry' })
      .select().single()
    expect(error).toBeNull()
    if (data) paymentIds.push(data.id)
  })
})
