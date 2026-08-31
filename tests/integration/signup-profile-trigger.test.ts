/**
 * handle_new_user, against the real trigger.
 *
 * The signup redesign moved two decisions into this trigger: a new profile is
 * born 'active' rather than 'pending' (there is no approval queue any more),
 * and it carries the passport name the signup form collected. Both are
 * server-side on purpose — the client can't be trusted with either — so they
 * are pinned here rather than in a unit test over a mock.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { adminClient } from './helpers'

const admin = adminClient()
const created: string[] = []

async function signUp(userMetadata: Record<string, unknown> | undefined) {
  const email = `trigger_${Math.random().toString(36).slice(2, 10)}@example.test`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'test-password-123',
    email_confirm: true,
    user_metadata: userMetadata,
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
  created.push(data.user.id)

  const { data: profile, error: perr } = await admin
    .from('profiles').select('*').eq('id', data.user.id).single()
  if (perr) throw new Error(`profile read failed: ${perr.message}`)
  return { email, profile }
}

afterAll(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {})
})

describe('handle_new_user', () => {
  it('creates the profile active, so a new diver is never parked on /pending', async () => {
    const { profile } = await signUp({ name: 'Ada Lovelace' })
    expect(profile.status).toBe('active')
  })

  it('carries the passport name onto the profile', async () => {
    const { profile } = await signUp({ name: 'Ada Lovelace' })
    expect(profile.name).toBe('Ada Lovelace')
  })

  it('trims the name, and stores nothing when it is only whitespace', async () => {
    expect((await signUp({ name: '  Ada Lovelace  ' })).profile.name).toBe('Ada Lovelace')
    expect((await signUp({ name: '   ' })).profile.name).toBeNull()
  })

  it('leaves the name null when signup sent none', async () => {
    const { profile } = await signUp(undefined)
    expect(profile.name).toBeNull()
    // Still active — a nameless account is not a held one.
    expect(profile.status).toBe('active')
  })

  it('mirrors the auth email onto the profile', async () => {
    const { email, profile } = await signUp({ name: 'Ada' })
    expect(profile.email).toBe(email)
  })
})

async function liveTermsVersion(): Promise<number | null> {
  const { data } = await admin.from('terms').select('version').maybeSingle()
  return data?.version ?? null
}

describe('handle_new_user consent', () => {
  it('records consent against the live terms version', async () => {
    const { profile } = await signUp({
      name: 'Ada',
      agreed_to_terms_at: '2020-01-01T00:00:00.000Z',
      agreed_to_terms_version: 4,
    })
    expect(profile.agreed_to_terms_at).not.toBeNull()
    expect(profile.agreed_to_terms_version).toBe((await liveTermsVersion()) ?? 1)
  })

  // Which version a diver consented to is a server fact, read from
  // public.terms — a client that named a version above the real one would
  // never see the re-acceptance banner again. Pinned in full by
  // terms-consent-versioning.test.ts; asserted here so a future edit to this
  // trigger cannot quietly drop the clamp.
  it('ignores an inflated version from the signup payload', async () => {
    const live = (await liveTermsVersion()) ?? 1
    const { profile } = await signUp({
      name: 'Ada',
      agreed_to_terms_at: new Date().toISOString(),
      agreed_to_terms_version: live + 999,
    })
    expect(profile.agreed_to_terms_version).toBe(live)
  })

  // Non-repudiation (audit L10): the client's timestamp is a claim, not
  // evidence. The trigger stamps its own now(), so a backdated payload cannot
  // put consent before the terms it is consenting to.
  it('ignores the timestamp the client sent and stamps its own', async () => {
    const before = Date.now()
    const { profile } = await signUp({
      name: 'Ada',
      agreed_to_terms_at: '2020-01-01T00:00:00.000Z',
      agreed_to_terms_version: 4,
    })
    const stamped = new Date(profile.agreed_to_terms_at!).getTime()
    expect(stamped).toBeGreaterThanOrEqual(before - 60_000)
    expect(new Date(profile.agreed_to_terms_at!).getUTCFullYear()).not.toBe(2020)
  })

  it('records the live version when the payload carried none', async () => {
    const { profile } = await signUp({ name: 'Ada', agreed_to_terms_at: new Date().toISOString() })
    expect(profile.agreed_to_terms_version).toBe((await liveTermsVersion()) ?? 1)
  })

  it('leaves consent null when the diver never agreed', async () => {
    const { profile } = await signUp({ name: 'Ada' })
    expect(profile.agreed_to_terms_at).toBeNull()
    expect(profile.agreed_to_terms_version).toBeNull()
  })

  // status is a server decision. Accepting it from user_metadata would let
  // anyone re-signup past a closure with a crafted payload.
  it('will not let signup metadata choose its own status', async () => {
    const { profile } = await signUp({ name: 'Ada', status: 'rejected', role: 'admin' })
    expect(profile.status).toBe('active')
    expect(profile.role).toBe('diver')
  })
})
