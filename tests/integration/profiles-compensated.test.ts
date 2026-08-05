import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
let staffUser: TestUser
let diver: TestUser

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  staffUser = await createTestUser(admin, { role: 'staff' })
  diver     = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (staffUser) await deleteTestUser(admin, staffUser.id)
  if (diver)     await deleteTestUser(admin, diver.id)
})

describe('profiles.compensated', () => {
  it('defaults to false, so a fresh shop attributes nothing until it says who it pays', async () => {
    const { data } = await admin.from('profiles').select('compensated').eq('id', staffUser.id).single()
    expect(data!.compensated).toBe(false)
  })

  it('lets an admin mark someone as paid crew', async () => {
    const adminSb = await userClient(adminUser.email, adminUser.password)
    const { error } = await adminSb.from('profiles').update({ compensated: true }).eq('id', staffUser.id)
    expect(error).toBeNull()

    const { data } = await admin.from('profiles').select('compensated').eq('id', staffUser.id).single()
    expect(data!.compensated).toBe(true)
  })

  it('lets an admin mark themselves as paid — an owner who instructs usually is', async () => {
    const adminSb = await userClient(adminUser.email, adminUser.password)
    const { error } = await adminSb.from('profiles').update({ compensated: true }).eq('id', adminUser.id)
    expect(error).toBeNull()
  })

  it('rejects a staff member flagging themselves, the way it rejects a self role change', async () => {
    await admin.from('profiles').update({ compensated: false }).eq('id', staffUser.id)

    const staffSb = await userClient(staffUser.email, staffUser.password)
    const { error } = await staffSb.from('profiles').update({ compensated: true }).eq('id', staffUser.id)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/admin-managed/)

    const { data } = await admin.from('profiles').select('compensated').eq('id', staffUser.id).single()
    expect(data!.compensated).toBe(false)
  })

  it('rejects a diver flagging themselves', async () => {
    const diverSb = await userClient(diver.email, diver.password)
    const { error } = await diverSb.from('profiles').update({ compensated: true }).eq('id', diver.id)
    expect(error).not.toBeNull()
  })

  it('still lets a staff member update their own ordinary profile fields', async () => {
    // The guard must reject the one column, not the whole self-update path.
    const staffSb = await userClient(staffUser.email, staffUser.password)
    const { error } = await staffSb.from('profiles').update({ nickname: 'Reef' }).eq('id', staffUser.id)
    expect(error).toBeNull()
  })

  it('lets staff read the flag on their colleagues — the split denominator needs it', async () => {
    await admin.from('profiles').update({ compensated: true }).eq('id', adminUser.id)

    const staffSb = await userClient(staffUser.email, staffUser.password)
    const { data, error } = await staffSb.from('profiles')
      .select('id, compensated').eq('id', adminUser.id).single()
    expect(error).toBeNull()
    expect(data!.compensated).toBe(true)
  })

  it('keeps the flag away from divers reading other people', async () => {
    const diverSb = await userClient(diver.email, diver.password)
    const { data } = await diverSb.from('profiles').select('id, compensated').eq('id', adminUser.id)
    expect(data ?? []).toHaveLength(0)
  })
})
