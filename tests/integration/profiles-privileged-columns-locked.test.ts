import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Pins the column-diff trigger introduced in
// 20260602000000_block_self_role_status_parent_change.sql.
//
// The trigger backstops the column-blind RLS policies on profiles —
// "profiles: self update" (20260423130000) and "profiles: parent
// update children" (20260514030000) — both of which permit any
// authenticated caller to PATCH a row they're allowed to touch with
// arbitrary column values. role / status / parent_account are
// admin-managed; this suite asserts each blocked path stays blocked
// and each legitimate path stays open.

const admin = adminClient()

let adminUser: TestUser
let diverA:    TestUser   // parent of childB
let childB:    TestUser   // child of diverA
let staffUser: TestUser
let loneDiver: TestUser   // unrelated diver — used for cross-account tests

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diverA    = await createTestUser(admin, { role: 'diver' })
  childB    = await createTestUser(admin, { role: 'diver' })
  staffUser = await createTestUser(admin, { role: 'staff' })
  loneDiver = await createTestUser(admin, { role: 'diver', status: 'pending' })
  const { error } = await admin.from('profiles').update({ parent_account: diverA.id }).eq('id', childB.id)
  if (error) throw new Error(`could not link child to parent: ${error.message}`)
})

afterAll(async () => {
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diverA)    await deleteTestUser(admin, diverA.id)
  if (childB)    await deleteTestUser(admin, childB.id)
  if (staffUser) await deleteTestUser(admin, staffUser.id)
  if (loneDiver) await deleteTestUser(admin, loneDiver.id)
})

describe('profiles: trigger blocks self-promotion to admin', () => {
  it('diver cannot set own role to admin', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const r = await sb.from('profiles').update({ role: 'admin' as never }).eq('id', diverA.id).select()
    expect(r.error).not.toBeNull()
    expect(r.error?.code).toBe('42501')
    const after = await admin.from('profiles').select('role').eq('id', diverA.id).single()
    expect(after.data?.role).toBe('diver')
  })

  it('diver cannot set own role to staff (any role change is blocked)', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const r = await sb.from('profiles').update({ role: 'staff' as never }).eq('id', diverA.id).select()
    expect(r.error).not.toBeNull()
    expect(r.error?.code).toBe('42501')
  })

  it('staff cannot set own role to admin', async () => {
    const sb = await userClient(staffUser.email, staffUser.password)
    const r = await sb.from('profiles').update({ role: 'admin' as never }).eq('id', staffUser.id).select()
    expect(r.error).not.toBeNull()
    expect(r.error?.code).toBe('42501')
    const after = await admin.from('profiles').select('role').eq('id', staffUser.id).single()
    expect(after.data?.role).toBe('staff')
  })
})

describe('profiles: trigger blocks self-bypass of manual-verification gate', () => {
  it('pending diver cannot flip own status to active', async () => {
    const sb = await userClient(loneDiver.email, loneDiver.password)
    const r = await sb.from('profiles').update({ status: 'active' as never }).eq('id', loneDiver.id).select()
    expect(r.error).not.toBeNull()
    expect(r.error?.code).toBe('42501')
    const after = await admin.from('profiles').select('status').eq('id', loneDiver.id).single()
    expect(after.data?.status).toBe('pending')
  })

  it('active diver cannot toggle status fields (defense-in-depth, blocks status laundering)', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const r = await sb.from('profiles').update({ status: 'rejected' as never }).eq('id', diverA.id).select()
    expect(r.error).not.toBeNull()
    expect(r.error?.code).toBe('42501')
  })
})

describe('profiles: trigger blocks parent_account tampering', () => {
  it('diver cannot self-assign a parent_account', async () => {
    const sb = await userClient(loneDiver.email, loneDiver.password)
    const r = await sb.from('profiles').update({ parent_account: adminUser.id }).eq('id', loneDiver.id).select()
    expect(r.error).not.toBeNull()
    expect(r.error?.code).toBe('42501')
  })

  it('child cannot orphan itself by nulling parent_account', async () => {
    const sb = await userClient(childB.email, childB.password)
    const r = await sb.from('profiles').update({ parent_account: null }).eq('id', childB.id).select()
    expect(r.error).not.toBeNull()
    expect(r.error?.code).toBe('42501')
  })
})

describe('profiles: trigger blocks parent-of-child privilege escalation (audit H1)', () => {
  it('parent cannot promote child to admin', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const r = await sb.from('profiles').update({ role: 'admin' as never }).eq('id', childB.id).select()
    expect(r.error).not.toBeNull()
    expect(r.error?.code).toBe('42501')
    const after = await admin.from('profiles').select('role').eq('id', childB.id).single()
    expect(after.data?.role).toBe('diver')
  })

  it('parent cannot flip child status', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const r = await sb.from('profiles').update({ status: 'rejected' as never }).eq('id', childB.id).select()
    expect(r.error).not.toBeNull()
    expect(r.error?.code).toBe('42501')
    const after = await admin.from('profiles').select('status').eq('id', childB.id).single()
    expect(after.data?.status).toBe('active')
  })

  it('parent cannot re-parent child to a different account', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const r = await sb.from('profiles').update({ parent_account: adminUser.id }).eq('id', childB.id).select()
    expect(r.error).not.toBeNull()
    expect(r.error?.code).toBe('42501')
  })
})

describe('profiles: legitimate paths still work', () => {
  it('admin can change role on any profile', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const r = await sb.from('profiles').update({ role: 'staff' as never }).eq('id', loneDiver.id).select().single()
    expect(r.error).toBeNull()
    expect(r.data?.role).toBe('staff')
    await admin.from('profiles').update({ role: 'diver' as never }).eq('id', loneDiver.id)
  })

  it('admin can change status on any profile', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const r = await sb.from('profiles').update({ status: 'active' as never }).eq('id', loneDiver.id).select().single()
    expect(r.error).toBeNull()
    expect(r.data?.status).toBe('active')
    await admin.from('profiles').update({ status: 'pending' as never }).eq('id', loneDiver.id)
  })

  it('admin can assign parent_account', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const r = await sb.from('profiles').update({ parent_account: diverA.id }).eq('id', loneDiver.id).select().single()
    expect(r.error).toBeNull()
    expect(r.data?.parent_account).toBe(diverA.id)
    await admin.from('profiles').update({ parent_account: null }).eq('id', loneDiver.id)
  })

  it('service-role (cron / edge function) can change privileged columns', async () => {
    const r = await admin.from('profiles').update({ status: 'active' as never }).eq('id', loneDiver.id).select().single()
    expect(r.error).toBeNull()
    expect(r.data?.status).toBe('active')
    await admin.from('profiles').update({ status: 'pending' as never }).eq('id', loneDiver.id)
  })

  it('diver can still edit allowed columns (regression — nickname)', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const r = await sb.from('profiles').update({ nickname: 'A-self-edit' }).eq('id', diverA.id).select().single()
    expect(r.error).toBeNull()
    expect(r.data?.nickname).toBe('A-self-edit')
  })

  it('parent can still edit allowed child columns (regression — nickname on child)', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const r = await sb.from('profiles').update({ nickname: 'Child-edit' }).eq('id', childB.id).select().single()
    expect(r.error).toBeNull()
    expect(r.data?.nickname).toBe('Child-edit')
  })

  it('no-op update (same value) does not trip the trigger', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const r = await sb.from('profiles').update({ role: 'diver' as never }).eq('id', diverA.id).select().single()
    expect(r.error).toBeNull()
  })
})
