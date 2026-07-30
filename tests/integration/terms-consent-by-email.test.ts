import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser, type TestUser,
} from './helpers'

// The consent route for a diver with no session
// (20260803000000_terms_consent_by_email.sql).
//
// An account an admin minted for a walk-in records no terms consent and is
// never gated, because that diver has no password. They consent instead through
// a one-time link, which means an anon-callable RPC that writes to profiles —
// so the properties worth pinning are the ones that keep that safe: the token is
// single-use, expiry is enforced, the recorded version comes from the server,
// and nothing about the diver leaks to whoever holds (or guesses) a token.

const admin = adminClient()
let diver: TestUser
let otherDiver: TestUser
let adminUser: TestUser

async function mintToken(userId: string, expiresAt?: string): Promise<string> {
  const { data, error } = await admin.from('terms_consent_tokens').insert({
    user_id: userId,
    expires_at: expiresAt ?? new Date(Date.now() + 90 * 86_400_000).toISOString(),
  } as never).select('token').single()
  if (error) throw new Error(`mintToken failed: ${error.message}`)
  return (data as { token: string }).token
}

async function currentVersion(): Promise<number> {
  const { data } = await admin.from('terms').select('version').single()
  return data!.version
}

async function consentOf(userId: string) {
  const { data } = await admin
    .from('profiles').select('agreed_to_terms_at, agreed_to_terms_version')
    .eq('id', userId).single()
  return data!
}

beforeAll(async () => {
  diver      = await createTestUser(admin, { role: 'diver' })
  otherDiver = await createTestUser(admin, { role: 'diver' })
  adminUser  = await createTestUser(admin, { role: 'admin' })
  // Start from "never agreed" — createTestUser may stamp consent.
  await admin.from('profiles')
    .update({ agreed_to_terms_at: null, agreed_to_terms_version: null })
    .in('id', [diver.id, otherDiver.id])
})

afterAll(async () => {
  for (const u of [diver, otherDiver, adminUser]) {
    if (u) await deleteTestUser(admin, u.id)
  }
})

describe('accept_terms_with_token', () => {
  it('records consent for the token owner at the live version, with no session', async () => {
    const token = await mintToken(diver.id)
    const version = await currentVersion()

    const anon = anonClient()
    const { data, error } = await anon.rpc('accept_terms_with_token', { p_token: token })
    expect(error).toBeNull()
    expect(data).toBe(version)

    const after = await consentOf(diver.id)
    expect(after.agreed_to_terms_version).toBe(version)
    expect(after.agreed_to_terms_at).not.toBeNull()
  })

  it('burns the token — a replay fails and cannot re-stamp', async () => {
    const token = await mintToken(otherDiver.id)
    const anon = anonClient()
    expect((await anon.rpc('accept_terms_with_token', { p_token: token })).error).toBeNull()

    const first = await consentOf(otherDiver.id)
    const replay = await anon.rpc('accept_terms_with_token', { p_token: token })
    expect(replay.error).not.toBeNull()

    // The first stamp stands; the failed replay changed nothing.
    const second = await consentOf(otherDiver.id)
    expect(second.agreed_to_terms_at).toBe(first.agreed_to_terms_at)
  })

  it('refuses an expired token and leaves consent untouched', async () => {
    const fresh = await createTestUser(admin, { role: 'diver' })
    try {
      await admin.from('profiles')
        .update({ agreed_to_terms_at: null, agreed_to_terms_version: null })
        .eq('id', fresh.id)
      const token = await mintToken(fresh.id, new Date(Date.now() - 86_400_000).toISOString())

      const { error } = await anonClient().rpc('accept_terms_with_token', { p_token: token })
      expect(error).not.toBeNull()
      expect((await consentOf(fresh.id)).agreed_to_terms_at).toBeNull()
    } finally {
      await deleteTestUser(admin, fresh.id)
    }
  })

  it('refuses a token nobody minted', async () => {
    const { error } = await anonClient().rpc('accept_terms_with_token', {
      p_token: '00000000-0000-0000-0000-000000000000',
    })
    expect(error).not.toBeNull()
  })

  // The version is the whole reason the RPC exists rather than a plain UPDATE:
  // a caller must not be able to claim consent to a version never shown.
  it('takes no version argument at all', async () => {
    const token = await mintToken(diver.id)
    const { error } = await anonClient().rpc('accept_terms_with_token', {
      p_token: token, p_version: 999,
    } as never)
    expect(error).not.toBeNull()
    await admin.from('terms_consent_tokens').delete().eq('token', token)
  })
})

describe('terms_consent_token_state', () => {
  it('reports valid, then used, for the same token', async () => {
    const fresh = await createTestUser(admin, { role: 'diver' })
    try {
      const token = await mintToken(fresh.id)
      const anon = anonClient()
      expect((await anon.rpc('terms_consent_token_state', { p_token: token })).data).toBe('valid')
      await anon.rpc('accept_terms_with_token', { p_token: token })
      expect((await anon.rpc('terms_consent_token_state', { p_token: token })).data).toBe('used')
    } finally {
      await deleteTestUser(admin, fresh.id)
    }
  })

  it('reports expired for a lapsed token', async () => {
    const token = await mintToken(diver.id, new Date(Date.now() - 1000).toISOString())
    const { data } = await anonClient().rpc('terms_consent_token_state', { p_token: token })
    expect(data).toBe('expired')
    await admin.from('terms_consent_tokens').delete().eq('token', token)
  })

  it('reports unknown for a guessed token, disclosing nothing', async () => {
    const { data, error } = await anonClient().rpc('terms_consent_token_state', {
      p_token: '00000000-0000-0000-0000-000000000000',
    })
    expect(error).toBeNull()
    expect(data).toBe('unknown')
  })
})

describe('terms_consent_tokens RLS', () => {
  it('anon cannot read the table — that would be a consent-forging kit', async () => {
    const token = await mintToken(diver.id)
    try {
      const { data } = await anonClient().from('terms_consent_tokens').select('*')
      expect(data ?? []).toEqual([])
    } finally {
      await admin.from('terms_consent_tokens').delete().eq('token', token)
    }
  })

  it('a diver cannot read even their own token row', async () => {
    const token = await mintToken(diver.id)
    try {
      const sb = await userClient(diver.email, diver.password)
      const { data } = await sb.from('terms_consent_tokens').select('*')
      expect(data ?? []).toEqual([])
    } finally {
      await admin.from('terms_consent_tokens').delete().eq('token', token)
    }
  })

  it('an admin can read them, for the user card status line', async () => {
    const token = await mintToken(diver.id)
    try {
      const sb = await userClient(adminUser.email, adminUser.password)
      const { data } = await sb.from('terms_consent_tokens').select('*').eq('token', token)
      expect((data ?? []).length).toBe(1)
    } finally {
      await admin.from('terms_consent_tokens').delete().eq('token', token)
    }
  })

  it('nobody but the service role can mint a token', async () => {
    const expires = new Date(Date.now() + 86_400_000).toISOString()
    for (const sb of [
      anonClient(),
      await userClient(diver.email, diver.password),
      await userClient(adminUser.email, adminUser.password),
    ]) {
      const { error } = await sb.from('terms_consent_tokens')
        .insert({ user_id: diver.id, expires_at: expires } as never)
      expect(error).not.toBeNull()
    }
  })

  it('an admin cannot mark a token used by hand', async () => {
    const token = await mintToken(diver.id)
    try {
      const sb = await userClient(adminUser.email, adminUser.password)
      await sb.from('terms_consent_tokens')
        .update({ used_at: new Date().toISOString() } as never).eq('token', token)
      const { data } = await admin.from('terms_consent_tokens')
        .select('used_at').eq('token', token).single()
      expect((data as { used_at: string | null }).used_at).toBeNull()
    } finally {
      await admin.from('terms_consent_tokens').delete().eq('token', token)
    }
  })

  it('drops a diver\'s tokens when the account is deleted', async () => {
    const fresh = await createTestUser(admin, { role: 'diver' })
    const token = await mintToken(fresh.id)
    await deleteTestUser(admin, fresh.id)
    const { data } = await admin.from('terms_consent_tokens').select('token').eq('token', token)
    expect(data ?? []).toEqual([])
  })
})
