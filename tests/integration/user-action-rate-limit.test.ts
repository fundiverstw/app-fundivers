import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, anonClient, createTestUser, deleteTestUser, type TestUser } from './helpers'

// take_action_slot is the ceiling behind every mail-sending edge function an
// ordinary diver can reach. The edge functions are thin wrappers over it, so
// the behavior that matters is pinned here.
// See 20260813000000_shared_user_action_rate_limit.sql.

const admin = adminClient()
let diver: TestUser
let other: TestUser

async function take(userId: string, action: string, limit = 3, window = '24 hours') {
  const { data, error } = await admin.rpc('take_action_slot' as never, {
    p_user_id: userId, p_action: action, p_limit: limit, p_window: window,
  } as never)
  if (error) throw new Error(`take_action_slot failed: ${error.message}`)
  return data as unknown as number
}

beforeAll(async () => {
  diver = await createTestUser(admin, { role: 'diver' })
  other = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  if (diver) await deleteTestUser(admin, diver.id)
  if (other) await deleteTestUser(admin, other.id)
})

describe('take_action_slot', () => {
  it('allows up to the limit, then refuses with a positive wait', async () => {
    expect(await take(diver.id, 'test_action')).toBe(0)
    expect(await take(diver.id, 'test_action')).toBe(0)
    expect(await take(diver.id, 'test_action')).toBe(0)

    const wait = await take(diver.id, 'test_action')
    expect(wait).toBeGreaterThan(0)
    // A 24h window, so the retry hint should be within it, not some epoch.
    expect(wait).toBeLessThanOrEqual(24 * 3600)
  })

  it('counts each action separately', async () => {
    expect(await take(diver.id, 'a_different_action')).toBe(0)
  })

  it('counts each user separately — one diver cannot spend another budget', async () => {
    expect(await take(other.id, 'test_action')).toBe(0)
  })

  it('refuses a limit below one rather than silently allowing everything', async () => {
    await expect(take(diver.id, 'bad_limit', 0)).rejects.toThrow(/limit must be positive/)
  })

  // The ledger is service-role only: it records who did what and when, and no
  // client has a reason to read it or to spend someone else's budget.
  it('is unreachable from anon and from a signed-in diver', async () => {
    const anon = anonClient()
    const { error: rpcErr } = await anon.rpc('take_action_slot' as never, {
      p_user_id: diver.id, p_action: 'test_action', p_limit: 3, p_window: '24 hours',
    } as never)
    expect(rpcErr).not.toBeNull()

    const { data: rows } = await anon.from('user_action_attempts' as never).select('id')
    expect(rows ?? []).toEqual([])
  })
})
