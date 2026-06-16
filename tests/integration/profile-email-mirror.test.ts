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

describe('profiles.email mirror of auth.users', () => {
  it('handle_new_user copies the signup email onto the profile', async () => {
    const u = await createTestUser(admin)
    cleanupIds.push(u.id)

    const { data, error } = await admin.from('profiles').select('email').eq('id', u.id).single()
    expect(error).toBeNull()
    expect(data!.email).toBe(u.email)
  })

  it('is read-only — a profile update cannot change the email', async () => {
    const u = await createTestUser(admin)
    cleanupIds.push(u.id)

    await admin.from('profiles').update({ email: 'spoofed@evil.test' } as never).eq('id', u.id)

    const { data } = await admin.from('profiles').select('email').eq('id', u.id).single()
    expect(data!.email).toBe(u.email)
  })

  it('follows an auth.users email change', async () => {
    const u = await createTestUser(admin)
    cleanupIds.push(u.id)

    const newEmail = `changed_${u.id.slice(0, 8)}@example.test`
    const { error: upErr } = await admin.auth.admin.updateUserById(u.id, { email: newEmail, email_confirm: true })
    expect(upErr).toBeNull()

    const { data } = await admin.from('profiles').select('email').eq('id', u.id).single()
    expect(data!.email).toBe(newEmail)
  })
})
