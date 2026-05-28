import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

const admin = adminClient()
let diver:   TestUser
let staffA:  TestUser
let staffB:  TestUser
let adminUser: TestUser
const noteIds: string[] = []

beforeAll(async () => {
  diver     = await createTestUser(admin)
  staffA    = await createTestUser(admin, { role: 'staff' })
  staffB    = await createTestUser(admin, { role: 'staff' })
  adminUser = await createTestUser(admin, { role: 'admin' })
})

afterAll(async () => {
  if (noteIds.length) await admin.from('diver_notes').delete().in('id', noteIds)
  for (const u of [diver, staffA, staffB, adminUser]) {
    if (u) await deleteTestUser(admin, u.id).catch(() => {})
  }
})

describe('diver_notes RLS + constraints', () => {
  it('rejects empty content and content > 2000 chars', async () => {
    const empty = await admin.from('diver_notes').insert({
      profile_id: diver.id, created_by: adminUser.id, content: '',
    })
    expect(empty.error).toBeTruthy()

    const huge = await admin.from('diver_notes').insert({
      profile_id: diver.id, created_by: adminUser.id, content: 'x'.repeat(2001),
    })
    expect(huge.error).toBeTruthy()
  })

  it('a staff member can insert a note attributed to themselves', async () => {
    const c = await userClient(staffA.email, staffA.password)
    const { data, error } = await c.from('diver_notes').insert({
      profile_id: diver.id, created_by: staffA.id, content: 'Severe shellfish allergy',
    }).select().single()
    expect(error).toBeNull()
    expect(data!.content).toBe('Severe shellfish allergy')
    if (data) noteIds.push(data.id)
  })

  it('staff cannot insert a note attributed to someone else', async () => {
    const c = await userClient(staffA.email, staffA.password)
    const { error } = await c.from('diver_notes').insert({
      profile_id: diver.id, created_by: staffB.id, content: 'forged',
    })
    expect(error).toBeTruthy()
  })

  it('a diver cannot read diver_notes', async () => {
    const c = await userClient(diver.email, diver.password)
    const { data } = await c.from('diver_notes').select('*').eq('profile_id', diver.id)
    expect(data ?? []).toEqual([])
  })

  it('the anon client cannot read diver_notes', async () => {
    const { data } = await anonClient().from('diver_notes').select('*').eq('profile_id', diver.id)
    expect(data ?? []).toEqual([])
  })

  it('staff can read all diver notes', async () => {
    const c = await userClient(staffB.email, staffB.password)
    const { data, error } = await c.from('diver_notes').select('*').eq('profile_id', diver.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('a staff member can edit their own note', async () => {
    const c = await userClient(staffA.email, staffA.password)
    const ins = await c.from('diver_notes').insert({
      profile_id: diver.id, created_by: staffA.id, content: 'typo',
    }).select().single()
    if (ins.data) noteIds.push(ins.data.id)

    const { data, error } = await c
      .from('diver_notes')
      .update({ content: 'fixed', edited_by: staffA.id, edited_at: new Date().toISOString() })
      .eq('id', ins.data!.id)
      .select().single()
    expect(error).toBeNull()
    expect(data!.content).toBe('fixed')
    expect(data!.edited_at).not.toBeNull()
  })

  it("a staff member cannot edit another staff member's note", async () => {
    const cA = await userClient(staffA.email, staffA.password)
    const ins = await cA.from('diver_notes').insert({
      profile_id: diver.id, created_by: staffA.id, content: 'A wrote this',
    }).select().single()
    if (ins.data) noteIds.push(ins.data.id)

    const cB = await userClient(staffB.email, staffB.password)
    // The RLS update USING clause filters the row out, so the update affects
    // 0 rows and returns no data — no error code, just nothing changed.
    const { data: updated } = await cB
      .from('diver_notes')
      .update({ content: 'B tried to forge' })
      .eq('id', ins.data!.id)
      .select()
    expect(updated ?? []).toEqual([])

    const { data: latest } = await admin
      .from('diver_notes').select('content').eq('id', ins.data!.id).single()
    expect(latest!.content).toBe('A wrote this')
  })

  it("an admin can edit any staff member's note", async () => {
    const cA = await userClient(staffA.email, staffA.password)
    const ins = await cA.from('diver_notes').insert({
      profile_id: diver.id, created_by: staffA.id, content: 'first draft',
    }).select().single()
    if (ins.data) noteIds.push(ins.data.id)

    const cAdmin = await userClient(adminUser.email, adminUser.password)
    const { data, error } = await cAdmin
      .from('diver_notes')
      .update({ content: 'admin override', edited_by: adminUser.id, edited_at: new Date().toISOString() })
      .eq('id', ins.data!.id)
      .select().single()
    expect(error).toBeNull()
    expect(data!.content).toBe('admin override')
  })

  it('updating profile_id or created_by is blocked by the freeze trigger', async () => {
    const ins = await admin.from('diver_notes').insert({
      profile_id: diver.id, created_by: adminUser.id, content: 'frozen test',
    }).select().single()
    if (ins.data) noteIds.push(ins.data.id)

    const reassign = await admin
      .from('diver_notes')
      .update({ profile_id: staffA.id })
      .eq('id', ins.data!.id)
    expect(reassign.error).toBeTruthy()

    const reattribute = await admin
      .from('diver_notes')
      .update({ created_by: staffA.id })
      .eq('id', ins.data!.id)
    expect(reattribute.error).toBeTruthy()
  })

  it('a staff member can delete their own note', async () => {
    const c = await userClient(staffA.email, staffA.password)
    const ins = await c.from('diver_notes').insert({
      profile_id: diver.id, created_by: staffA.id, content: 'delete me',
    }).select().single()

    const { error } = await c.from('diver_notes').delete().eq('id', ins.data!.id)
    expect(error).toBeNull()

    const { data } = await admin.from('diver_notes').select('id').eq('id', ins.data!.id)
    expect(data ?? []).toEqual([])
  })

  it("a staff member cannot delete another staff member's note", async () => {
    const cA = await userClient(staffA.email, staffA.password)
    const ins = await cA.from('diver_notes').insert({
      profile_id: diver.id, created_by: staffA.id, content: 'should survive',
    }).select().single()
    if (ins.data) noteIds.push(ins.data.id)

    const cB = await userClient(staffB.email, staffB.password)
    await cB.from('diver_notes').delete().eq('id', ins.data!.id)

    const { data } = await admin.from('diver_notes').select('id').eq('id', ins.data!.id)
    expect((data ?? []).length).toBe(1)
  })

  it('deleting the profile cascades to its diver_notes', async () => {
    // Use a throwaway target so we can verify the cascade without nuking
    // the suite-level diver.
    const target = await createTestUser(admin)
    const ins = await admin.from('diver_notes').insert({
      profile_id: target.id, created_by: adminUser.id, content: 'cascade test',
    }).select().single()
    expect(ins.error).toBeNull()

    await deleteTestUser(admin, target.id)

    const { data } = await admin.from('diver_notes').select('id').eq('id', ins.data!.id)
    expect(data ?? []).toEqual([])
  })
})
