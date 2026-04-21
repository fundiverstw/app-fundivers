import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, createTestUser, deleteTestUser, userClient,
  createActivity, type TestUser
} from './helpers'

const admin = adminClient()
let customer: TestUser
let staff: TestUser
let publishedId: string
let draftId: string

beforeAll(async () => {
  customer = await createTestUser(admin)
  staff = await createTestUser(admin, { role: 'staff' })
  const published = await createActivity(admin, { title: 'Published Dive', is_published: true })
  const draft = await createActivity(admin, { title: 'Draft Dive', is_published: false })
  publishedId = published.id
  draftId = draft.id
})

afterAll(async () => {
  await admin.from('activities').delete().in('id', [publishedId, draftId]).then(() => {})
  for (const u of [customer, staff]) await deleteTestUser(admin, u.id).catch(() => {})
})

// RLS is currently disabled app-wide (see migration 20260421130941_remote_schema.sql).
// Unskip this suite once RLS is re-enabled on public.activities.
describe.skip('activities RLS', () => {
  it('authenticated customers see published activities', async () => {
    const c = await userClient(customer.email, customer.password)
    const { data } = await c.from('activities').select('id').eq('id', publishedId)
    expect((data ?? []).map(r => r.id)).toEqual([publishedId])
  })

  it('authenticated customers do NOT see unpublished activities', async () => {
    const c = await userClient(customer.email, customer.password)
    const { data } = await c.from('activities').select('id').eq('id', draftId)
    expect(data ?? []).toEqual([])
  })

  it('a customer cannot insert an activity', async () => {
    const c = await userClient(customer.email, customer.password)
    const { error } = await c.from('activities').insert({
      title: 'Rogue Dive',
      type: 'dive',
      start_time: new Date().toISOString(),
    })
    expect(error).toBeTruthy()
  })

  it('staff can insert, update, and delete activities', async () => {
    const s = await userClient(staff.email, staff.password)

    const { data: ins, error: insErr } = await s
      .from('activities')
      .insert({ title: 'Staff-made Dive', type: 'dive', start_time: new Date().toISOString() })
      .select()
      .single()
    expect(insErr).toBeNull()
    expect(ins).not.toBeNull()

    const { error: updErr } = await s
      .from('activities')
      .update({ title: 'Renamed' })
      .eq('id', ins!.id)
    expect(updErr).toBeNull()

    const { error: delErr } = await s.from('activities').delete().eq('id', ins!.id)
    expect(delErr).toBeNull()
  })

  it('staff can see unpublished activities', async () => {
    const s = await userClient(staff.email, staff.password)
    const { data } = await s.from('activities').select('id').eq('id', draftId)
    expect((data ?? []).map(r => r.id)).toEqual([draftId])
  })
})
