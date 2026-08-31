import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleCreateAccount, type Deps } from './handler'

const ORIGIN = 'http://localhost:5173'

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    admin: {
      auth: { admin: { createUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) } },
      rpc:  vi.fn().mockResolvedValue({ data: [{ in_last_60s: 1, in_last_24h: 1 }], error: null }),
    },
    anon: {
      auth: { signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { access_token: 'a' } }, error: null }) },
    },
    verifyTurnstile: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  } as Deps
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://edge.test/create-account', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ORIGIN, 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: JSON.stringify(body),
  })
}

const VALID = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'secret1234',
  turnstile_token: 'tok',
  agreed_to_terms_at: '2026-08-31T00:00:00.000Z',
  agreed_to_terms_version: 4,
}

let deps: Deps
beforeEach(() => { deps = makeDeps() })

describe('create-account', () => {
  it('creates the account, confirms the email and returns a session', async () => {
    const res = await handleCreateAccount(post(VALID), deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, user_id: 'u1', session: { access_token: 'a' } })

    const createUser = deps.admin.auth.admin.createUser as ReturnType<typeof vi.fn>
    // email_confirm is the whole of the "no confirmation step" fix — the
    // address is marked confirmed at creation, so no link is ever sent.
    expect(createUser.mock.calls[0][0]).toMatchObject({
      email: 'ada@example.com',
      password: 'secret1234',
      email_confirm: true,
    })
  })

  it('passes the passport name through to the profile trigger', async () => {
    await handleCreateAccount(post(VALID), deps)
    const createUser = deps.admin.auth.admin.createUser as ReturnType<typeof vi.fn>
    expect(createUser.mock.calls[0][0].user_metadata).toMatchObject({ name: 'Ada Lovelace' })
  })

  it('normalizes the email and trims the name', async () => {
    await handleCreateAccount(post({ ...VALID, email: '  Ada@Example.COM ', name: '  Ada  ' }), deps)
    const createUser = deps.admin.auth.admin.createUser as ReturnType<typeof vi.fn>
    expect(createUser.mock.calls[0][0].email).toBe('ada@example.com')
    expect(createUser.mock.calls[0][0].user_metadata.name).toBe('Ada')
  })

  it('carries the consent signal, which the trigger stamps for itself', async () => {
    await handleCreateAccount(post(VALID), deps)
    const createUser = deps.admin.auth.admin.createUser as ReturnType<typeof vi.fn>
    expect(createUser.mock.calls[0][0].user_metadata).toMatchObject({
      agreed_to_terms_at: VALID.agreed_to_terms_at,
      agreed_to_terms_version: 4,
    })
  })

  // Omitting the key entirely is what leaves profiles.agreed_to_terms_at null.
  it('omits the consent keys when the diver did not agree', async () => {
    const noConsent = { name: VALID.name, email: VALID.email, password: VALID.password, turnstile_token: VALID.turnstile_token }
    await handleCreateAccount(post(noConsent), deps)
    const createUser = deps.admin.auth.admin.createUser as ReturnType<typeof vi.fn>
    expect(createUser.mock.calls[0][0].user_metadata).not.toHaveProperty('agreed_to_terms_at')
  })
})

describe('create-account validation', () => {
  it.each([
    ['name',     { ...VALID, name: '   ' },        'name required'],
    ['email',    { ...VALID, email: '' },          'email required'],
    ['password', { ...VALID, password: 'short' },  'password must be at least 8 characters'],
    ['captcha',  { ...VALID, turnstile_token: '' }, 'captcha token required'],
  ])('rejects a missing %s', async (_field, body, message) => {
    const res = await handleCreateAccount(post(body), deps)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(message)
    expect(deps.admin.auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('rejects a non-POST', async () => {
    const res = await handleCreateAccount(
      new Request('https://edge.test/create-account', { method: 'GET', headers: { Origin: ORIGIN } }),
      deps,
    )
    expect(res.status).toBe(405)
  })

  it('answers a CORS preflight', async () => {
    const res = await handleCreateAccount(
      new Request('https://edge.test/create-account', { method: 'OPTIONS', headers: { Origin: ORIGIN } }),
      deps,
    )
    expect(res.status).toBe(200)
    // The origin echo itself is not assertable here: jsdom strips the Origin
    // request header, so corsHeaders never sees one. What this pins is that
    // the preflight is answered at all, with the method and header allowances
    // the browser needs before it will send the real POST.
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('content-type')
  })

  it('rejects a malformed body', async () => {
    const res = await handleCreateAccount(
      new Request('https://edge.test/create-account', {
        method: 'POST', headers: { Origin: ORIGIN }, body: 'not json',
      }),
      deps,
    )
    expect(res.status).toBe(400)
  })
})

describe('create-account abuse gates', () => {
  it('rejects an unverified captcha before spending a monthly active user', async () => {
    deps = makeDeps({ verifyTurnstile: vi.fn().mockResolvedValue({ success: false, errorCodes: ['invalid-input-response'] }) })
    const res = await handleCreateAccount(post(VALID), deps)
    expect(res.status).toBe(403)
    expect(deps.admin.auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('verifies the token against the caller IP', async () => {
    await handleCreateAccount(post(VALID), deps)
    expect(deps.verifyTurnstile).toHaveBeenCalledWith('tok', '203.0.113.7')
  })

  it('spends the per-IP budget on a hashed address, never the address itself', async () => {
    await handleCreateAccount(post(VALID), deps)
    const rpc = deps.admin.rpc as ReturnType<typeof vi.fn>
    expect(rpc.mock.calls[0][0]).toBe('record_signup_attempt')
    expect(rpc.mock.calls[0][1].p_ip_hash).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(rpc.mock.calls[0][1].p_ip_hash).not.toContain('203.0.113.7')
  })

  it('rejects a burst', async () => {
    deps = makeDeps({
      admin: {
        auth: { admin: { createUser: vi.fn() } },
        rpc:  vi.fn().mockResolvedValue({ data: [{ in_last_60s: 9, in_last_24h: 9 }], error: null }),
      },
    } as Partial<Deps>)
    const res = await handleCreateAccount(post(VALID), deps)
    expect(res.status).toBe(429)
    expect(deps.admin.auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('rejects a day-long grind', async () => {
    deps = makeDeps({
      admin: {
        auth: { admin: { createUser: vi.fn() } },
        rpc:  vi.fn().mockResolvedValue({ data: [{ in_last_60s: 1, in_last_24h: 99 }], error: null }),
      },
    } as Partial<Deps>)
    const res = await handleCreateAccount(post(VALID), deps)
    expect(res.status).toBe(429)
  })

  it('runs the captcha before the rate limit, so a bot cannot burn a real visitor budget', async () => {
    deps = makeDeps({ verifyTurnstile: vi.fn().mockResolvedValue({ success: false }) })
    await handleCreateAccount(post(VALID), deps)
    expect(deps.admin.rpc).not.toHaveBeenCalled()
  })
})

describe('create-account failures', () => {
  // The SPA needs this one distinguishable, because the useful answer is
  // "sign in instead" rather than "try again".
  it.each([
    ['a code',        { message: 'boom', code: 'email_exists' }],
    ['a prose match', { message: 'User already registered' }],
  ])('normalizes an already-taken address reported as %s', async (_shape, error) => {
    deps = makeDeps({
      admin: {
        auth: { admin: { createUser: vi.fn().mockResolvedValue({ data: { user: null }, error }) } },
        rpc:  vi.fn().mockResolvedValue({ data: [{ in_last_60s: 1, in_last_24h: 1 }], error: null }),
      },
    } as Partial<Deps>)
    const res = await handleCreateAccount(post(VALID), deps)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('email_exists')
  })

  it('reports any other creation failure as a 400', async () => {
    deps = makeDeps({
      admin: {
        auth: { admin: { createUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'weak password' } }) } },
        rpc:  vi.fn().mockResolvedValue({ data: [{ in_last_60s: 1, in_last_24h: 1 }], error: null }),
      },
    } as Partial<Deps>)
    const res = await handleCreateAccount(post(VALID), deps)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBeUndefined()
  })

  // The account exists and the password is the diver's own, so this is not a
  // failed signup — the SPA signs in for itself.
  it('still succeeds when the courtesy sign-in fails', async () => {
    deps = makeDeps({
      anon: { auth: { signInWithPassword: vi.fn().mockResolvedValue({ data: null, error: { message: 'nope' } }) } },
    } as Partial<Deps>)
    const res = await handleCreateAccount(post(VALID), deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, user_id: 'u1', session: null })
  })

  it('surfaces a rate-limit read failure as a 500', async () => {
    deps = makeDeps({
      admin: {
        auth: { admin: { createUser: vi.fn() } },
        rpc:  vi.fn().mockResolvedValue({ data: null, error: { message: 'relation missing', code: '42P01' } }),
      },
    } as Partial<Deps>)
    const res = await handleCreateAccount(post(VALID), deps)
    expect(res.status).toBe(500)
    // safeError suppresses the raw Postgres text.
    expect((await res.json()).error).not.toContain('relation missing')
  })
})
