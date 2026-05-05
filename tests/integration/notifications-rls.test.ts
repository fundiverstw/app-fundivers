import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, userClient, createTestUser, deleteTestUser, type TestUser } from './helpers'

const admin = adminClient()
let diverA: TestUser
let diverB: TestUser
const createdIds: string[] = []

beforeAll(async () => {
  diverA = await createTestUser(admin, { role: 'diver' })
  diverB = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  if (createdIds.length) await admin.from('notifications').delete().in('id', createdIds)
  if (diverA) await deleteTestUser(admin, diverA.id)
  if (diverB) await deleteTestUser(admin, diverB.id)
})

async function seedNotification(userId: string, overrides: Partial<{ title: string; body: string; read_at: string | null }> = {}) {
  const { data, error } = await admin.from('notifications').insert({
    user_id: userId,
    title: overrides.title ?? 'Test',
    body:  overrides.body ?? null,
    kind:  'reminder',
    read_at: overrides.read_at ?? null,
  }).select().single<{ id: string }>()
  if (error) throw error
  createdIds.push(data!.id)
  return data!.id
}

describe('notifications RLS', () => {
  it('a diver sees their own notifications and not anyone else’s', async () => {
    await seedNotification(diverA.id, { title: 'For Alice' })
    await seedNotification(diverB.id, { title: 'For Bob' })

    const sb = await userClient(diverA.email, diverA.password)
    const { data } = await sb.from('notifications').select('user_id, title')
    expect((data ?? []).every(r => r.user_id === diverA.id)).toBe(true)
    expect((data ?? []).map(r => r.title)).toContain('For Alice')
    expect((data ?? []).map(r => r.title)).not.toContain('For Bob')
  })

  it('a diver can mark their own notification read but not someone else’s', async () => {
    const ownId = await seedNotification(diverA.id, { title: 'mine' })
    const otherId = await seedNotification(diverB.id, { title: 'theirs' })

    const sb = await userClient(diverA.email, diverA.password)
    const stamped = new Date().toISOString()

    const { error: ownErr } = await sb.from('notifications').update({ read_at: stamped }).eq('id', ownId)
    expect(ownErr).toBeNull()
    const { data: own } = await admin.from('notifications').select('read_at').eq('id', ownId).single<{ read_at: string | null }>()
    expect(own?.read_at).not.toBeNull()

    // RLS makes this update affect 0 rows. Some Postgres setups raise an error,
    // some succeed silently — either way, the row must not be modified.
    await sb.from('notifications').update({ read_at: stamped }).eq('id', otherId)
    const { data: other } = await admin.from('notifications').select('read_at').eq('id', otherId).single<{ read_at: string | null }>()
    expect(other?.read_at).toBeNull()
  })

  it('an authenticated diver cannot insert notifications (server-side fan-out only)', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const { error } = await sb.from('notifications').insert({
      user_id: diverA.id, title: 'self-spam', kind: 'broadcast',
    })
    // No INSERT policy → either an explicit RLS error or a 0-row insert.
    // Confirm no row landed via admin re-read.
    const { count } = await admin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', diverA.id)
      .eq('title', 'self-spam')
    expect(count).toBe(0)
    // Most setups also surface an error; tolerate either shape.
    if (error) expect(String(error.message)).toMatch(/policy|permission|violat/i)
  })
})
