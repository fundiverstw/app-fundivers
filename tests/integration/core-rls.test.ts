import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser,
  createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

// Pins the RLS policy + immutability-trigger contract for profiles, bookings,
// payments. Anything that breaks the PWA's read/write paths (ProfilePage
// update, RegisterForm insert, admin event-detail status flip, etc.) should
// show up here first.

const admin = adminClient()
let adminUser: TestUser
let diverA: TestUser
let diverB: TestUser
let diveId: string

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diverA    = await createTestUser(admin, { role: 'diver' })
  diverB    = await createTestUser(admin, { role: 'diver' })
  diveId    = await createTestDive(admin)
})

afterAll(async () => {
  if (diveId)    await deleteTestDive(admin, diveId)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diverA)    await deleteTestUser(admin, diverA.id)
  if (diverB)    await deleteTestUser(admin, diverB.id)
})

describe('profiles RLS', () => {
  it('diver sees own profile, not others', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const { data } = await sb.from('profiles').select('id').in('id', [diverA.id, diverB.id])
    expect(data?.map(r => r.id)).toEqual([diverA.id])
  })

  it('admin sees everyone', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { data } = await sb.from('profiles').select('id').in('id', [diverA.id, diverB.id, adminUser.id])
    expect(data?.length).toBeGreaterThanOrEqual(3)
  })

  it('diver can update own nickname, not another diver', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const ok = await sb.from('profiles').update({ nickname: 'A-self' }).eq('id', diverA.id).select().single()
    expect(ok.error).toBeNull()
    expect(ok.data?.nickname).toBe('A-self')
    const fail = await sb.from('profiles').update({ nickname: 'hacked' }).eq('id', diverB.id).select()
    // RLS silently filters the row out — update touches zero rows.
    expect(fail.data ?? []).toEqual([])
    const after = await admin.from('profiles').select('nickname').eq('id', diverB.id).single()
    expect(after.data?.nickname).not.toBe('hacked')
  })

  it('admin can update any diver profile (full edit control)', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const ok = await sb.from('profiles').update({
      nickname: 'Admin-edited',
      nationality: 'Atlantean',
      cert_level: 'Rescue Diver',
    }).eq('id', diverB.id).select().single()
    expect(ok.error).toBeNull()
    expect(ok.data?.nickname).toBe('Admin-edited')
    expect(ok.data?.nationality).toBe('Atlantean')
    expect(ok.data?.cert_level).toBe('Rescue Diver')
  })

  it('anon sees nothing', async () => {
    const { data } = await anonClient().from('profiles').select('id').limit(1)
    expect(data ?? []).toEqual([])
  })
})

describe('bookings RLS', () => {
  it('diver inserts + reads own booking, not another diver', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const ins = await sb.from('bookings').insert({
      user_id: diverA.id, event_id: diveId, status: 'pending', details: { gear: { rent: false } },
    }).select().single()
    expect(ins.error).toBeNull()

    const otherSb = await userClient(diverB.email, diverB.password)
    const { data: otherSees } = await otherSb.from('bookings').select('id').eq('id', ins.data!.id)
    expect(otherSees ?? []).toEqual([])
  })

  it('diver cannot insert a booking for a different user_id', async () => {
    const sb = await userClient(diverB.email, diverB.password)
    const { error } = await sb.from('bookings').insert({
      user_id: diverA.id, event_id: diveId, status: 'pending', details: {},
    })
    expect(error).not.toBeNull()
  })

  it('admin updates any booking status', async () => {
    const { data: row } = await admin.from('bookings').select('id').eq('user_id', diverA.id).maybeSingle()
    const adminSb = await userClient(adminUser.email, adminUser.password)
    const upd = await adminSb.from('bookings').update({ status: 'confirmed' }).eq('id', row!.id).select().single()
    expect(upd.error).toBeNull()
    expect(upd.data?.status).toBe('confirmed')
  })
})

describe('bookings.details immutability trigger', () => {
  it('blocks a diver from editing details after insert', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const { data: row } = await admin.from('bookings').select('id, details').eq('user_id', diverA.id).single()
    const { error } = await sb.from('bookings')
      .update({ details: { gear: { rent: true, mode: 'full' } } })
      .eq('id', row!.id)
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/locked/i)
  })

  it('allows a diver to cancel (status change) without touching details', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const { data: row } = await admin.from('bookings').select('id').eq('user_id', diverA.id).single()
    const { error } = await sb.from('bookings').update({ status: 'cancelled' }).eq('id', row!.id)
    expect(error).toBeNull()
  })

  it('allows an admin to edit details', async () => {
    const { data: row } = await admin.from('bookings').select('id').eq('user_id', diverA.id).single()
    const adminSb = await userClient(adminUser.email, adminUser.password)
    const { error } = await adminSb.from('bookings')
      .update({ details: { gear: { rent: true, mode: 'a-la-carte', items: ['Fins'] } } })
      .eq('id', row!.id)
    expect(error).toBeNull()
  })
})

describe('payments RLS', () => {
  it('diver sees own rows only; anon sees none', async () => {
    // Seed a payment via service role (no app path writes payments today).
    const { data: booking } = await admin.from('bookings').select('id').eq('user_id', diverA.id).single()
    await admin.from('payments').insert({
      user_id: diverA.id, booking_id: booking!.id, amount: 1000, currency: 'TWD', status: 'paid',
    })

    const diverSb = await userClient(diverA.email, diverA.password)
    const { data: own } = await diverSb.from('payments').select('id')
    expect((own ?? []).length).toBeGreaterThan(0)

    const otherSb = await userClient(diverB.email, diverB.password)
    const { data: other } = await otherSb.from('payments').select('id').eq('user_id', diverA.id)
    expect(other ?? []).toEqual([])

    const { data: anonSees } = await anonClient().from('payments').select('id')
    expect(anonSees ?? []).toEqual([])
  })

  it('diver cannot insert a payment', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const { error } = await sb.from('payments').insert({
      user_id: diverA.id, amount: 1, currency: 'TWD', status: 'pending',
    })
    expect(error).not.toBeNull()
  })
})
