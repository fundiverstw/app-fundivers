import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, anonClient, userClient, type TestUser } from './helpers'

// Pins the consent contract after the Terms moved into the DB
// (20260711100000_shop_authored_terms.sql):
//
//   - handle_new_user server-stamps agreed_to_terms_at when the client signals
//     consent, ignoring any client-supplied timestamp (audit L10);
//   - the VERSION is read from public.terms, never from raw_user_meta_data. It
//     used to be `coalesce(client_ver, 1)`, so a modified browser could record a
//     version far above the real one and never be re-prompted;
//   - accept_current_terms() takes no arguments and records the live version.
//
// Nothing here may assume the version is 1: it is a shared row and it can only
// ever increase (terms_version_monotonic), so other suites bump it. Read it.

const admin = adminClient()

let consentedUser: TestUser
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

async function currentVersion(): Promise<number> {
  const { data } = await admin.from('terms').select('version').single()
  return data!.version
}

beforeAll(async () => {
  const farFuture = '2099-01-01T00:00:00.000Z'
  consentedUser = await createUserWithMetadata({
    agreed_to_terms_at: farFuture,
    agreed_to_terms_version: 1,
  })
  unconsentedUser = await createUserWithMetadata({})
})

afterAll(async () => {
  if (consentedUser) await admin.auth.admin.deleteUser(consentedUser.id)
  if (unconsentedUser) await admin.auth.admin.deleteUser(unconsentedUser.id)
})

describe('handle_new_user: server owns both consent columns', () => {
  it('ignores the client-supplied timestamp and stamps now() instead', async () => {
    const { data } = await admin
      .from('profiles').select('agreed_to_terms_at').eq('id', consentedUser.id).single()
    expect(data?.agreed_to_terms_at).not.toBeNull()
    expect(data?.agreed_to_terms_at).not.toContain('2099')
    const drift = Math.abs(new Date(data!.agreed_to_terms_at!).getTime() - Date.now())
    expect(drift).toBeLessThan(60_000)
  })

  it('records null for both columns when the client did not signal consent', async () => {
    const { data } = await admin
      .from('profiles').select('agreed_to_terms_at, agreed_to_terms_version')
      .eq('id', unconsentedUser.id).single()
    expect(data?.agreed_to_terms_at).toBeNull()
    expect(data?.agreed_to_terms_version).toBeNull()
  })

  it('records the live terms version when the client omits one', async () => {
    const u = await createUserWithMetadata({ agreed_to_terms_at: 'whatever' })
    try {
      const { data } = await admin
        .from('profiles').select('agreed_to_terms_version').eq('id', u.id).single()
      expect(data?.agreed_to_terms_version).toBe(await currentVersion())
    } finally {
      await admin.auth.admin.deleteUser(u.id)
    }
  })

  // This inverts the old contract. It used to record the client's number
  // verbatim, which let a crafted signup claim a version that does not exist and
  // sail past RequireCurrentTerms forever.
  it('ignores an inflated client version and records the live one', async () => {
    const live = await currentVersion()
    const u = await createUserWithMetadata({
      agreed_to_terms_at: new Date().toISOString(),
      agreed_to_terms_version: live + 999,
    })
    try {
      const { data } = await admin
        .from('profiles').select('agreed_to_terms_version').eq('id', u.id).single()
      expect(data?.agreed_to_terms_version).toBe(live)
      expect(data?.agreed_to_terms_version).not.toBe(live + 999)
    } finally {
      await admin.auth.admin.deleteUser(u.id)
    }
  })
})

describe('accept_current_terms(): re-acceptance', () => {
  it('stamps now() and writes the live version for the calling user', async () => {
    await admin.from('profiles').update({
      agreed_to_terms_at: null,
      agreed_to_terms_version: null,
    } as never).eq('id', consentedUser.id)

    const live = await currentVersion()
    const sb = await userClient(consentedUser.email, consentedUser.password)
    const { data: returned, error } = await sb.rpc('accept_current_terms')
    expect(error).toBeNull()
    expect(returned).toBe(live)

    const { data } = await admin
      .from('profiles').select('agreed_to_terms_at, agreed_to_terms_version')
      .eq('id', consentedUser.id).single()
    expect(data?.agreed_to_terms_version).toBe(live)
    expect(Math.abs(new Date(data!.agreed_to_terms_at!).getTime() - Date.now())).toBeLessThan(60_000)
  })

  // The old 1-arg signature was dropped, so the client cannot name a version at
  // all — the check that used to reject `p_version <= 0` is now unreachable.
  it('has no argument for a client to supply', async () => {
    const sb = await userClient(consentedUser.email, consentedUser.password)
    const r = await sb.rpc('accept_current_terms', { p_version: 2 } as never)
    expect(r.error).not.toBeNull()
  })

  it('cannot be invoked anonymously', async () => {
    const r = await anonClient().rpc('accept_current_terms')
    expect(r.error).not.toBeNull()
  })

  it('only updates the calling user, not anyone else', async () => {
    await admin.from('profiles').update({
      agreed_to_terms_at: null,
      agreed_to_terms_version: null,
    } as never).eq('id', unconsentedUser.id)

    const sb = await userClient(consentedUser.email, consentedUser.password)
    await sb.rpc('accept_current_terms')

    const { data } = await admin
      .from('profiles').select('agreed_to_terms_version').eq('id', unconsentedUser.id).single()
    expect(data?.agreed_to_terms_version).toBeNull()
  })
})
