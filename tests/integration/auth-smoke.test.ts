/**
 * End-to-end sign-in smoke: exercise the real gotrue /token endpoint with a
 * freshly-created user. Catches auth-service regressions that unit tests
 * miss because they mock supabase.auth.signInWithPassword.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { adminClient, createTestUser, deleteTestUser, type TestUser } from './helpers'
import type { Database } from '../../src/types/database'

const admin = adminClient()
let user: TestUser

beforeAll(async () => {
  user = await createTestUser(admin)
})

afterAll(async () => {
  if (user) await deleteTestUser(admin, user.id).catch(() => {})
})

describe('auth sign-in smoke', () => {
  it('signInWithPassword returns a valid session for an existing user', async () => {
    const anon = createClient<Database>(process.env.API_URL!, process.env.ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data, error } = await anon.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    })

    expect(error).toBeNull()
    expect(data.session).not.toBeNull()
    expect(data.session!.access_token).toBeTruthy()
    expect(data.user?.id).toBe(user.id)
    expect(data.user?.email).toBe(user.email)
  })

  it('signInWithPassword rejects a wrong password with a typed error (not 500)', async () => {
    const anon = createClient<Database>(process.env.API_URL!, process.env.ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data, error } = await anon.auth.signInWithPassword({
      email: user.email,
      password: 'definitely-not-the-right-password',
    })

    expect(data.session).toBeNull()
    expect(error).not.toBeNull()
    // The error should be a normal invalid-credentials error (401), NOT the
    // 500 "Database error querying schema" that indicated our seed bug.
    expect(error!.status).toBe(400)
    expect(String(error!.message)).not.toMatch(/database error/i)
  })
})
