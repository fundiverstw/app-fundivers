import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, userClient, type TestUser } from './helpers'

// Pins the L10 + legal-brief #2 migration
// (20260603000000_terms_consent_versioning.sql):
//   - handle_new_user server-stamps agreed_to_terms_at when consent
//     is signaled; ignores any client-supplied timestamp value.
//   - agreed_to_terms_version is stored from raw_user_meta_data,
//     defaulting to 1.
//   - accept_current_terms RPC is the canonical re-acceptance path —
//     also server-stamps both columns.

const admin = adminClient()

let consentedUser:   TestUser
let unconsentedUser: TestUser

async function createUserWithMetadata(metadata: Record<string, unknown>): Promise<TestUser> {
  const rand = Math.random().toString(36).slice(2, 10)
  const email = `terms_${rand}@example.test`
  const password = 'test-password-123'
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: metadata,
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
  return { id: data.user.id, email, password, user: data.user }
}

beforeAll(async () => {
  const farFuture = '2099-01-01T00:00:00.000Z'
  consentedUser = await createUserWithMetadata({
    agreed_to_terms_at:      farFuture,
    agreed_to_terms_version: 1,
  })
  unconsentedUser = await createUserWithMetadata({})
})

afterAll(async () => {
  if (consentedUser)   await admin.auth.admin.deleteUser(consentedUser.id)
  if (unconsentedUser) await admin.auth.admin.deleteUser(unconsentedUser.id)
})

describe('handle_new_user: server-stamps consent timestamp (audit L10)', () => {
  it('ignores client-supplied timestamp and stamps now() instead', async () => {
    const { data } = await admin
      .from('profiles').select('agreed_to_terms_at, agreed_to_terms_version')
      .eq('id', consentedUser.id).single()
    expect(data?.agreed_to_terms_at).not.toBeNull()
    expect(data?.agreed_to_terms_at).not.toContain('2099')
    const stamped = new Date(data!.agreed_to_terms_at!).getTime()
    const drift   = Math.abs(stamped - Date.now())
    expect(drift).toBeLessThan(60_000)
    expect(data?.agreed_to_terms_version).toBe(1)
  })

  it('records null for both columns when client did not signal consent', async () => {
    const { data } = await admin
      .from('profiles').select('agreed_to_terms_at, agreed_to_terms_version')
      .eq('id', unconsentedUser.id).single()
    expect(data?.agreed_to_terms_at).toBeNull()
    expect(data?.agreed_to_terms_version).toBeNull()
  })

  it('defaults version=1 when client signals consent without a version key', async () => {
    const u = await createUserWithMetadata({ agreed_to_terms_at: 'whatever' })
    try {
      const { data } = await admin
        .from('profiles').select('agreed_to_terms_version').eq('id', u.id).single()
      expect(data?.agreed_to_terms_version).toBe(1)
    } finally {
      await admin.auth.admin.deleteUser(u.id)
    }
  })

  it('records a higher client version verbatim (server trusts SPA constant)', async () => {
    const u = await createUserWithMetadata({
      agreed_to_terms_at:      new Date().toISOString(),
      agreed_to_terms_version: 7,
    })
    try {
      const { data } = await admin
        .from('profiles').select('agreed_to_terms_version').eq('id', u.id).single()
      expect(data?.agreed_to_terms_version).toBe(7)
    } finally {
      await admin.auth.admin.deleteUser(u.id)
    }
  })
})

describe('accept_current_terms RPC: re-acceptance', () => {
  it('stamps now() and writes the version for the calling user', async () => {
    await admin.from('profiles').update({
      agreed_to_terms_at:      null,
      agreed_to_terms_version: null,
    } as never).eq('id', consentedUser.id)

    const sb = await userClient(consentedUser.email, consentedUser.password)
    const { error } = await sb.rpc('accept_current_terms', { p_version: 2 })
    expect(error).toBeNull()

    const { data } = await admin
      .from('profiles').select('agreed_to_terms_at, agreed_to_terms_version')
      .eq('id', consentedUser.id).single()
    expect(data?.agreed_to_terms_version).toBe(2)
    expect(data?.agreed_to_terms_at).not.toBeNull()
    const stamped = new Date(data!.agreed_to_terms_at!).getTime()
    expect(Math.abs(stamped - Date.now())).toBeLessThan(60_000)
  })

  it('rejects p_version <= 0', async () => {
    const sb = await userClient(consentedUser.email, consentedUser.password)
    const r = await sb.rpc('accept_current_terms', { p_version: 0 })
    expect(r.error).not.toBeNull()
    const r2 = await sb.rpc('accept_current_terms', { p_version: -1 })
    expect(r2.error).not.toBeNull()
  })

  it('cannot be invoked anonymously', async () => {
    const { anonClient } = await import('./helpers')
    const sb = anonClient()
    const r = await sb.rpc('accept_current_terms', { p_version: 1 })
    expect(r.error).not.toBeNull()
  })

  it('only updates the calling user, not anyone else', async () => {
    const target = unconsentedUser
    await admin.from('profiles').update({
      agreed_to_terms_at:      null,
      agreed_to_terms_version: null,
    } as never).eq('id', target.id)

    const sb = await userClient(consentedUser.email, consentedUser.password)
    await sb.rpc('accept_current_terms', { p_version: 3 })

    const { data } = await admin
      .from('profiles').select('agreed_to_terms_version').eq('id', target.id).single()
    expect(data?.agreed_to_terms_version).toBeNull()
  })
})
