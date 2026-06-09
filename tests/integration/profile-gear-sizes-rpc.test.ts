import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Pins the contract on the staff/admin gear-size RPC introduced in
// 20260430020000_profile_gear_sizes.sql. The RPC is the only way for a
// non-admin to write fin_size / bcd_size / wetsuit_size on someone
// else's profile (the profiles UPDATE policy stays admin-only). This
// test confirms:
//   - admin can call it for any diver
//   - staff can call it for any diver
//   - a diver cannot call it (and especially not on someone else)
//   - empty strings are normalized to NULL

const admin = adminClient()
let adminUser:  TestUser
let staffUser:  TestUser
let diverA:     TestUser
let diverB:     TestUser

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  staffUser = await createTestUser(admin, { role: 'staff' })
  diverA    = await createTestUser(admin, { role: 'diver' })
  diverB    = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (staffUser) await deleteTestUser(admin, staffUser.id)
  if (diverA)    await deleteTestUser(admin, diverA.id)
  if (diverB)    await deleteTestUser(admin, diverB.id)
})

async function readSizes(diverId: string) {
  const { data } = await admin
    .from('profiles')
    .select('fin_size, bcd_size, wetsuit_size')
    .eq('id', diverId)
    .single<{ fin_size: string | null; bcd_size: string | null; wetsuit_size: string | null }>()
  return data
}

describe('update_diver_gear_sizes RPC', () => {
  it('admin can write gear sizes on any diver', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { error } = await sb.rpc('update_diver_gear_sizes', {
      diver_id:     diverA.id,
      fin_size:     'M',
      bcd_size:     'L',
      wetsuit_size: 'XL',
    })
    expect(error).toBeNull()
    expect(await readSizes(diverA.id)).toEqual({ fin_size: 'M', bcd_size: 'L', wetsuit_size: 'XL' })
  })

  it('staff can write gear sizes on any diver', async () => {
    const sb = await userClient(staffUser.email, staffUser.password)
    const { error } = await sb.rpc('update_diver_gear_sizes', {
      diver_id:     diverB.id,
      fin_size:     'L',
      bcd_size:     'L',
      wetsuit_size: '7mm M',
    })
    expect(error).toBeNull()
    expect(await readSizes(diverB.id)).toEqual({ fin_size: 'L', bcd_size: 'L', wetsuit_size: '7mm M' })
  })

  it('diver cannot call the RPC, even on themselves', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const { error } = await sb.rpc('update_diver_gear_sizes', {
      diver_id:     diverA.id,
      fin_size:     'XS',
      bcd_size:     'XS',
      wetsuit_size: 'XS',
    })
    expect(error).not.toBeNull()
    // Pre-existing sizes from the admin test still in place — RPC was rejected.
    expect(await readSizes(diverA.id)).toEqual({ fin_size: 'M', bcd_size: 'L', wetsuit_size: 'XL' })
  })

  it('diver cannot self-edit gear sizes via direct profiles UPDATE', async () => {
    // Pre-seed via admin RPC so we have a known starting state.
    const adminSb = await userClient(adminUser.email, adminUser.password)
    await adminSb.rpc('update_diver_gear_sizes', {
      diver_id: diverB.id, fin_size: 'L', bcd_size: 'L', wetsuit_size: 'M',
    })

    // Diver's own update attempt — RLS lets them update their profile, but
    // the BEFORE UPDATE trigger rejects the row when these three columns
    // change.
    const sb = await userClient(diverB.email, diverB.password)
    const { error } = await sb.from('profiles').update({ fin_size: 'XS' }).eq('id', diverB.id)
    expect(error).not.toBeNull()
    expect(String(error?.message ?? '')).toMatch(/staff|admin|gear/i)

    // The other gear-size columns are still admin-set values.
    expect(await readSizes(diverB.id)).toEqual({ fin_size: 'L', bcd_size: 'L', wetsuit_size: 'M' })
  })

  it('diver can still update non-gear profile fields without tripping the gear trigger', async () => {
    const sb = await userClient(diverB.email, diverB.password)
    const { error } = await sb.from('profiles').update({ nickname: 'New Name' }).eq('id', diverB.id)
    expect(error).toBeNull()
  })

  it('empty strings are stored as NULL (cleared)', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { error } = await sb.rpc('update_diver_gear_sizes', {
      diver_id:     diverA.id,
      fin_size:     '   ',  // whitespace also normalizes to null
      bcd_size:     '',
      wetsuit_size: '',
    })
    expect(error).toBeNull()
    expect(await readSizes(diverA.id)).toEqual({ fin_size: null, bcd_size: null, wetsuit_size: null })
  })
})
