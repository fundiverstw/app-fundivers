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
 *
 * The trigger leaves new profiles with status='pending' (the default). Tests
 * default to flipping status to 'active' so existing RLS contracts that
 * predate the manual-verification gate keep passing. Pass `status: 'pending'`
 * explicitly when you're testing the gate itself.
 */
export async function createTestUser(
  admin: DB = adminClient(),
  overrides: {
    role?: 'diver' | 'admin' | 'staff'
    status?: 'pending' | 'active' | 'rejected'
  } = {}
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

  const patch: Record<string, string> = { status: overrides.status ?? 'active' }
  if (overrides.role && overrides.role !== 'diver') patch.role = overrides.role
  const { error: rerr } = await admin
    .from('profiles')
    .update(patch as never)
    .eq('id', data.user.id)
  if (rerr) throw new Error(`profile update failed: ${rerr.message}`)

  return { id: data.user.id, email, password, user: data.user }
}

export async function deleteTestUser(admin: DB, userId: string) {
  await admin.auth.admin.deleteUser(userId)
}

/**
 * Insert an EO_dive row for tests that need something bookable. Returns the _id.
 * _id is uuid; date/time columns are still text (Bubble legacy).
 */
export async function createTestDive(admin: DB = adminClient()): Promise<string> {
  const id = crypto.randomUUID()
  const startDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const { error } = await admin.from('EO_dives' as never).insert({
    _id: id,
    admin_title: 'Test Dive',
    notes: '',
    start_date: startDate,
    time: '09:00:00',
    end_date: startDate,
  } as never)
  if (error) throw new Error(`createTestDive failed: ${error.message}`)
  return id
}

export async function createTestCourse(admin: DB = adminClient()): Promise<string> {
  const id = crypto.randomUUID()
  const startDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const { error } = await admin.from('EO_courses' as never).insert({
    _id: id,
    display_title: 'Test Course',
    start_time: '09:00:00',
    course_days: [startDate],
  } as never)
  if (error) throw new Error(`createTestCourse failed: ${error.message}`)
  return id
}

export async function deleteTestDive(admin: DB, id: string) {
  await admin.from('EO_dives' as never).delete().eq('_id', id)
}

export async function deleteTestCourse(admin: DB, id: string) {
  await admin.from('EO_courses' as never).delete().eq('_id', id)
}
