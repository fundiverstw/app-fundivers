import { describe, it, expect, afterEach } from 'vitest'
import { adminClient, createTestUser, deleteTestUser } from './helpers'

const admin = adminClient()
const cleanupIds: string[] = []

afterEach(async () => {
  while (cleanupIds.length) {
    const id = cleanupIds.pop()!
    await deleteTestUser(admin, id).catch(() => {})
  }
})

describe('handle_new_user trigger', () => {
  it('creates a profile row with default role=diver when an auth user is inserted', async () => {
    const u = await createTestUser(admin)
    cleanupIds.push(u.id)

    const { data, error } = await admin
      .from('profiles')
      .select('*')
      .eq('id', u.id)
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data!.id).toBe(u.id)
    expect(data!.role).toBe('diver')
    expect(data!.nitrox_certified).toBe(false)
    expect(data!.logged_dives).toBe(0)
  })

  it('deleting an auth user cascades to remove the profile row', async () => {
    const u = await createTestUser(admin)

    // Remove directly — do not push to cleanupIds since we delete here
    await deleteTestUser(admin, u.id)

    const { data } = await admin.from('profiles').select('id').eq('id', u.id).maybeSingle()
    expect(data).toBeNull()
  })
})
