import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

type DB = SupabaseClient<Database>

export function adminClient(): DB {
  return createClient<Database>(process.env.API_URL!, process.env.SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function anonClient(): DB {
  return createClient<Database>(process.env.API_URL!, process.env.ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function userClient(email: string, password: string): Promise<DB> {
  const c = createClient<Database>(process.env.API_URL!, process.env.ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return c
}

export interface TestUser {
  id: string
  email: string
  password: string
  user: User
}

/**
 * Create a throwaway auth user with email pre-confirmed. The profile row is
 * created automatically by the `handle_new_user` trigger.
 */
export async function createTestUser(
  admin: DB = adminClient(),
  overrides: { role?: 'customer' | 'staff' | 'admin' } = {}
): Promise<TestUser> {
  const rand = Math.random().toString(36).slice(2, 10)
  const email = `test_${rand}@example.test`
  const password = 'test-password-123'

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)

  if (overrides.role && overrides.role !== 'customer') {
    const { error: rerr } = await admin
      .from('profiles')
      .update({ role: overrides.role })
      .eq('id', data.user.id)
    if (rerr) throw new Error(`role update failed: ${rerr.message}`)
  }

  return { id: data.user.id, email, password, user: data.user }
}

export async function deleteTestUser(admin: DB, userId: string) {
  await admin.auth.admin.deleteUser(userId)
}

/**
 * Insert an activity for tests that need something bookable. Returns the row.
 */
export async function createActivity(
  admin: DB,
  overrides: Partial<Database['public']['Tables']['activities']['Insert']> = {}
) {
  const { data, error } = await admin
    .from('activities')
    .insert({
      title: 'Test Dive ' + Math.random().toString(36).slice(2, 8),
      type: 'dive',
      start_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      is_published: true,
      ...overrides,
    })
    .select()
    .single()
  if (error || !data) throw new Error(`createActivity failed: ${error?.message}`)
  return data
}
