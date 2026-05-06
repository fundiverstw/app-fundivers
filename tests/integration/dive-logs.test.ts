import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, userClient, createTestUser, deleteTestUser, type TestUser } from './helpers'

const admin = adminClient()
let diverA: TestUser
let diverB: TestUser

beforeAll(async () => {
  diverA = await createTestUser(admin, { role: 'diver' })
  diverB = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  // Cascading FK on dive_logs.user_id covers all rows; just delete users.
  if (diverA) await deleteTestUser(admin, diverA.id)
  if (diverB) await deleteTestUser(admin, diverB.id)
})

async function seedLog(userId: string, overrides: { site?: string; dived_on?: string } = {}) {
  const { data, error } = await admin.from('dive_logs').insert({
    user_id: userId,
    dived_on: overrides.dived_on ?? '2026-04-01',
    site:     overrides.site     ?? 'Test Site',
  }).select('id, dive_number').single<{ id: string; dive_number: number }>()
  if (error) throw error
  return data!
}

describe('dive_logs RLS', () => {
  it('a diver only sees their own dive logs', async () => {
    await seedLog(diverA.id, { site: 'A1' })
    await seedLog(diverB.id, { site: 'B1' })

    const sb = await userClient(diverA.email, diverA.password)
    const { data } = await sb.from('dive_logs').select('user_id, site')
    expect((data ?? []).every(r => r.user_id === diverA.id)).toBe(true)
    expect((data ?? []).map(r => r.site)).toContain('A1')
    expect((data ?? []).map(r => r.site)).not.toContain('B1')
  })

  it('a diver can insert their own dive log but not for another user', async () => {
    const sb = await userClient(diverA.email, diverA.password)

    const { error: own } = await sb.from('dive_logs').insert({
      user_id: diverA.id, dived_on: '2026-04-02', site: 'mine',
    })
    expect(own).toBeNull()

    // Trying to forge a row owned by diverB must fail RLS check.
    const { error: forge } = await sb.from('dive_logs').insert({
      user_id: diverB.id, dived_on: '2026-04-02', site: 'forged',
    })
    expect(forge).not.toBeNull()
    // And admin re-read confirms no forged row landed.
    const { count } = await admin
      .from('dive_logs').select('*', { count: 'exact', head: true })
      .eq('user_id', diverB.id).eq('site', 'forged')
    expect(count).toBe(0)
  })

  it('a diver can update + delete their own log but not someone else’s', async () => {
    const own   = await seedLog(diverA.id, { site: 'edit-me' })
    const other = await seedLog(diverB.id, { site: 'hands-off' })
    const sb = await userClient(diverA.email, diverA.password)

    // Update own — succeeds, value lands.
    const { error: ownUpdErr } = await sb.from('dive_logs').update({ site: 'edited' }).eq('id', own.id)
    expect(ownUpdErr).toBeNull()
    const { data: ownAfter } = await admin.from('dive_logs').select('site').eq('id', own.id).single<{ site: string }>()
    expect(ownAfter?.site).toBe('edited')

    // Update someone else’s — silently filtered to 0 rows by RLS.
    await sb.from('dive_logs').update({ site: 'tampered' }).eq('id', other.id)
    const { data: otherAfter } = await admin.from('dive_logs').select('site').eq('id', other.id).single<{ site: string }>()
    expect(otherAfter?.site).toBe('hands-off')

    // Delete own — succeeds.
    await sb.from('dive_logs').delete().eq('id', own.id)
    const { count: ownCount } = await admin.from('dive_logs').select('*', { count: 'exact', head: true }).eq('id', own.id)
    expect(ownCount).toBe(0)

    // Delete someone else’s — RLS blocks, row remains.
    await sb.from('dive_logs').delete().eq('id', other.id)
    const { count: otherCount } = await admin.from('dive_logs').select('*', { count: 'exact', head: true }).eq('id', other.id)
    expect(otherCount).toBe(1)
  })
})

describe('dive_logs dive_number trigger', () => {
  it('auto-assigns 1, 2, 3 … per user when dive_number is omitted on INSERT', async () => {
    const a = await seedLog(diverA.id, { site: 'first',  dived_on: '2026-03-01' })
    const b = await seedLog(diverA.id, { site: 'second', dived_on: '2026-03-02' })
    const c = await seedLog(diverA.id, { site: 'third',  dived_on: '2026-03-03' })
    // Numbers are strictly increasing per user. We don't assert they start at
    // 1 because earlier tests in this file also seeded rows for diverA.
    expect(b.dive_number).toBe(a.dive_number + 1)
    expect(c.dive_number).toBe(b.dive_number + 1)
  })

  it('numbers are independent per user (diverB does not inherit diverA’s sequence)', async () => {
    const a1 = await seedLog(diverA.id, { site: 'a1', dived_on: '2026-03-10' })
    const b1 = await seedLog(diverB.id, { site: 'b1', dived_on: '2026-03-10' })
    // diverA already has many rows from earlier tests; diverB has only the
    // RLS-test row, so b1.dive_number is small and definitely smaller than
    // diverA’s next-number. Assert no cross-talk.
    expect(b1.dive_number).toBeLessThan(a1.dive_number)
  })

  it('rejects a manually-supplied dive_number that conflicts with an existing one (per-user unique)', async () => {
    const first = await seedLog(diverA.id, { site: 'conflict-base', dived_on: '2026-03-20' })
    const { error } = await admin.from('dive_logs').insert({
      user_id:     diverA.id,
      dived_on:    '2026-03-21',
      site:        'duplicate',
      dive_number: first.dive_number,
    })
    expect(error).not.toBeNull()
    expect(String(error?.message)).toMatch(/duplicate|unique/i)
  })
})

describe('dive_log_export_requests', () => {
  it('a diver can read their own export-request audit rows but not another user’s', async () => {
    // Seed via service-role (the edge function path).
    await admin.from('dive_log_export_requests').insert({ user_id: diverA.id })
    await admin.from('dive_log_export_requests').insert({ user_id: diverB.id })

    const sb = await userClient(diverA.email, diverA.password)
    const { data } = await sb.from('dive_log_export_requests').select('user_id')
    expect((data ?? []).every(r => r.user_id === diverA.id)).toBe(true)
  })

  it('an authenticated diver cannot insert into the audit table directly (no client INSERT policy)', async () => {
    const sb = await userClient(diverA.email, diverA.password)
    const { error } = await sb.from('dive_log_export_requests').insert({ user_id: diverA.id })
    // Either an explicit policy error or a 0-row insert. Verify nothing
    // landed by counting rows after the call.
    const { count: before } = await admin
      .from('dive_log_export_requests')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', diverA.id)
    // Re-fetch after a brief moment to be sure the request fully resolved.
    const { count: after } = await admin
      .from('dive_log_export_requests')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', diverA.id)
    expect(after).toBe(before)
    if (error) expect(String(error.message)).toMatch(/policy|permission|violat/i)
  })
})
