import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Pins 20260603020000_profile_delete_cascade_and_admin_rpc.sql.
//
// Two surfaces:
//   1. cascade_profile_delete_to_auth_users — a profile DELETE deletes
//      the matching auth.users row, so manual cleanup / Studio surgery
//      can't leave an orphan auth user that authenticates but has no
//      profile.
//   2. admin_delete_user(uuid) RPC — the SPA's admin "Delete user"
//      button. Gated by is_admin(), refuses self-deletion, wipes both
//      halves via the existing auth.users → profiles FK cascade.

const admin = adminClient()

// Reusable admin caller for RPC tests. Created once, deleted in afterAll.
let adminUser: TestUser

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
})

afterAll(async () => {
  if (adminUser) await deleteTestUser(admin, adminUser.id)
})

// Probe helper — service-role bypasses RLS so we see the actual auth.users
// row (or its absence) regardless of policy.
async function authUserExists(id: string): Promise<boolean> {
  const { data } = await admin.auth.admin.getUserById(id)
  return data.user !== null
}

async function profileExists(id: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('id').eq('id', id).maybeSingle()
  return data !== null
}

describe('cascade_profile_delete_to_auth_users trigger', () => {
  it('deleting a profile row also deletes the matching auth.users row', async () => {
    const u = await createTestUser(admin, { role: 'diver' })
    expect(await authUserExists(u.id)).toBe(true)
    expect(await profileExists(u.id)).toBe(true)

    const { error } = await admin.from('profiles').delete().eq('id', u.id)
    expect(error).toBeNull()

    expect(await profileExists(u.id)).toBe(false)
    expect(await authUserExists(u.id)).toBe(false)
  })

  it('deleting auth.users still cascades to profile (existing FK), and the trigger does not re-recurse', async () => {
    const u = await createTestUser(admin, { role: 'diver' })
    expect(await authUserExists(u.id)).toBe(true)
    expect(await profileExists(u.id)).toBe(true)

    const { error } = await admin.auth.admin.deleteUser(u.id)
    expect(error).toBeNull()

    expect(await authUserExists(u.id)).toBe(false)
    expect(await profileExists(u.id)).toBe(false)
  })

  it('test cleanup helper (admin.auth.admin.deleteUser) keeps working under the new trigger', async () => {
    // The whole integration suite leans on deleteTestUser for cleanup —
    // make sure that path stays clean now that the cascade-down trigger
    // could in principle interact with it.
    const u = await createTestUser(admin, { role: 'staff' })
    await deleteTestUser(admin, u.id)
    expect(await authUserExists(u.id)).toBe(false)
    expect(await profileExists(u.id)).toBe(false)
  })
})

describe('admin_delete_user RPC', () => {
  it('non-admin caller (diver) gets insufficient_privilege', async () => {
    const diver = await createTestUser(admin, { role: 'diver' })
    const victim = await createTestUser(admin, { role: 'diver' })
    try {
      const sb = await userClient(diver.email, diver.password)
      const { error } = await sb.rpc('admin_delete_user', { p_user_id: victim.id })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('42501')
      expect(await authUserExists(victim.id)).toBe(true)
      expect(await profileExists(victim.id)).toBe(true)
    } finally {
      await deleteTestUser(admin, diver.id)
      await deleteTestUser(admin, victim.id)
    }
  })

  it('staff caller is denied (only admin gates pass)', async () => {
    const staff = await createTestUser(admin, { role: 'staff' })
    const victim = await createTestUser(admin, { role: 'diver' })
    try {
      const sb = await userClient(staff.email, staff.password)
      const { error } = await sb.rpc('admin_delete_user', { p_user_id: victim.id })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('42501')
      expect(await profileExists(victim.id)).toBe(true)
    } finally {
      await deleteTestUser(admin, staff.id)
      await deleteTestUser(admin, victim.id)
    }
  })

  it('admin cannot delete their own account', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { error } = await sb.rpc('admin_delete_user', { p_user_id: adminUser.id })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/own account/i)
    expect(await authUserExists(adminUser.id)).toBe(true)
  })

  it('admin can delete a diver — both auth.users and profile go', async () => {
    const victim = await createTestUser(admin, { role: 'diver' })
    const sb = await userClient(adminUser.email, adminUser.password)
    const { error } = await sb.rpc('admin_delete_user', { p_user_id: victim.id })
    expect(error).toBeNull()
    expect(await authUserExists(victim.id)).toBe(false)
    expect(await profileExists(victim.id)).toBe(false)
  })

  it('admin can delete a staff user', async () => {
    const victim = await createTestUser(admin, { role: 'staff' })
    const sb = await userClient(adminUser.email, adminUser.password)
    const { error } = await sb.rpc('admin_delete_user', { p_user_id: victim.id })
    expect(error).toBeNull()
    expect(await authUserExists(victim.id)).toBe(false)
    expect(await profileExists(victim.id)).toBe(false)
  })

  it('records an admin_audit_log row for the delete (via the existing audit trigger)', async () => {
    const victim = await createTestUser(admin, { role: 'diver' })
    const victimId = victim.id
    const sb = await userClient(adminUser.email, adminUser.password)
    const { error } = await sb.rpc('admin_delete_user', { p_user_id: victimId })
    expect(error).toBeNull()

    const { data: rows } = await admin
      .from('admin_audit_log')
      .select('action,target_table,target_id,actor_id,before')
      .eq('target_table', 'profiles')
      .eq('target_id', victimId)
      .eq('action', 'delete')
    expect(rows?.length).toBeGreaterThan(0)
    const row = rows![0]
    expect(row.actor_id).toBe(adminUser.id)
    expect(row.before).not.toBeNull()
  })

  it('passing a non-existent target id is a no-op (no error, no rows affected)', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { error } = await sb.rpc('admin_delete_user', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
    })
    expect(error).toBeNull()
  })
})
