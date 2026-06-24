import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleRegistration, type Deps, type TurnstileResult } from './handler'

// Security-focused unit suite for the create-registration handler.
//
// Every test builds an in-memory Deps with vi.fn() shims. No network,
// no DB. Two recurring assertions:
//   1. What the handler tried to write — captured via the supabase
//      from(table).update/.insert mock and re-read off `.mock.calls`.
//   2. What it returned — status + body.
//
// The C2 sanitizer is unit-tested separately in
// _shared/profile-patch.test.ts. This suite confirms the handler
// actually CALLS it (i.e., a malicious profile_patch arriving here
// can never reach the admin client with role/status/parent_account
// intact).

// ---------- mock factory --------------------------------------------------

interface CapturedWrites {
  profileUpdate: Array<Record<string, unknown>>
  bookingInsert: Array<Record<string, unknown>>
  createUserCalls: Array<Record<string, unknown>>
  deleteUserCalls: string[]
  sendMailCalls:   Array<Record<string, unknown>>
  turnstileVerifyCalls: Array<{ token: string; ip: string | null }>
  rpcCalls:        Array<{ name: string; args: unknown }>
}

interface MockOpts {
  callerUserId?: string
  callerEmail?:  string
  callerRole?:   'admin' | 'staff' | 'diver'
  targetParentAccount?: string | null
  targetUserId?: string
  targetEmail?:  string
  bookingStatus?: 'pending' | 'waitlisted'
  bookingError?:  string
  profileUpdateError?: string
  existingBooking?: { id: string; status: string } | null
  createUserId?: string
  createUserError?: string
  turnstileResult?: TurnstileResult
  rateLimitCounts?: { in_last_60s: number; in_last_24h: number }
  eventNotFound?:  boolean
  eventPast?:      boolean
  deleteUserError?: string
}

function makeDeps(opts: MockOpts = {}): { deps: Deps; captured: CapturedWrites } {
  const captured: CapturedWrites = {
    profileUpdate: [], bookingInsert: [],
    createUserCalls: [], deleteUserCalls: [], sendMailCalls: [],
    turnstileVerifyCalls: [], rpcCalls: [],
  }

  // Per-table query builder. Each call to admin.from(<table>) gets a
  // fresh chainable that resolves to the table's canned response.
  function from(table: string) {
    const canned: Record<string, unknown> | null = (() => {
      switch (table) {
        case 'profiles':
          // Caller-profile fetch (target_user_id path) returns role;
          // target-profile fetch returns parent_account; readback for
          // PDF returns a minimal profile.
          return { role: opts.callerRole ?? 'diver', parent_account: opts.targetParentAccount ?? null, name: 'Test' }
        case 'bookings':
          return { id: 'b1', status: opts.bookingStatus ?? 'pending', notes: null }
        case 'EO_dives':
          return opts.eventNotFound ? null : {
            _id: 'd1', display_title: 'Test Dive',
            ...(opts.eventPast
              ? { start_date: '2020-01-01', end_date: '2020-01-03' }
              : { start_date: '2030-06-01', end_date: '2030-06-03' }),
          }
        case 'EO_courses':
          return opts.eventNotFound ? null : {
            _id: 'c1', display_title: 'Test Course',
            course_days: opts.eventPast ? ['2020-01-01', '2020-01-02'] : ['2030-06-01', '2030-06-02', '2030-06-03'],
          }
        default:           return null
      }
    })()
    const builder: Record<string, unknown> = {}
    const chain = ['select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'order', 'limit', 'filter', 'match']
    for (const m of chain) builder[m] = () => builder
    builder.single      = () => Promise.resolve({ data: canned, error: null })
    builder.maybeSingle = () => Promise.resolve({ data: canned, error: null })
    builder.then = (onFulfilled?: (r: unknown) => unknown) =>
      Promise.resolve({ data: canned, error: null }).then(onFulfilled)
    builder.update = (row: Record<string, unknown>) => {
      if (table === 'profiles') captured.profileUpdate.push(row)
      const ret: Record<string, unknown> = {}
      ret.eq = () => Promise.resolve({ error: opts.profileUpdateError ? { message: opts.profileUpdateError } : null })
      return ret
    }
    builder.insert = (row: Record<string, unknown>) => {
      if (table === 'bookings') captured.bookingInsert.push(row)
      const ret: Record<string, unknown> = {}
      ret.select = () => ({
        single: () => Promise.resolve({
          data:  opts.bookingError ? null : { id: 'b1', status: opts.bookingStatus ?? 'pending', notes: null },
          error: opts.bookingError ? { message: opts.bookingError } : null,
        }),
      })
      return ret
    }
    // Pre-existing-booking check goes via .from('bookings').select().eq().eq().neq().maybeSingle().
    // We need it to return opts.existingBooking when defined. Override
    // maybeSingle for the bookings table so we can model both states.
    if (table === 'bookings') {
      builder.maybeSingle = () =>
        Promise.resolve({ data: opts.existingBooking ?? null, error: null })
    }
    return builder
  }

  const admin: Deps['admin'] = {
    auth: {
      admin: {
        createUser: vi.fn(async (req) => {
          captured.createUserCalls.push(req as Record<string, unknown>)
          if (opts.createUserError) return { data: { user: null }, error: { message: opts.createUserError } }
          return {
            data:  { user: { id: opts.createUserId ?? 'new-user-id', email: (req as { email: string }).email } },
            error: null,
          }
        }),
        getUserById: vi.fn(async (id) => ({
          data:  { user: { id, email: opts.targetEmail ?? 'target@example.com' } },
          error: null,
        })),
        deleteUser: vi.fn(async (id: string) => {
          captured.deleteUserCalls.push(id)
          return opts.deleteUserError ? { error: { message: opts.deleteUserError } } : {}
        }),
      },
    },
    from: vi.fn(from),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: vi.fn(async (name: string, args: unknown): Promise<any> => {
      captured.rpcCalls.push({ name, args })
      if (name === 'record_signup_attempt') {
        const counts = opts.rateLimitCounts ?? { in_last_60s: 1, in_last_24h: 1 }
        return { data: [counts], error: null }
      }
      if (name === 'log_orphan_auth_user') {
        return { data: null, error: null }
      }
      return { data: null, error: null }
    }),
  } as Deps['admin']

  const makeAuthedClient = vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({
        data:  { user: { id: opts.callerUserId ?? 'caller-uid', email: opts.callerEmail ?? 'caller@example.com' } },
        error: null,
      })),
    },
  }))

  const anon: Deps['anon'] = {
    auth: {
      signInWithPassword: vi.fn(async () => ({
        data:  { session: { access_token: 'fake' } },
        error: null,
      })),
    },
  }

  const transporter: Deps['transporter'] = {
    sendMail: vi.fn(async (msg) => { captured.sendMailCalls.push(msg as Record<string, unknown>); return {} }),
  }

  const verifyTurnstile: Deps['verifyTurnstile'] = vi.fn(async (token, ip) => {
    captured.turnstileVerifyCalls.push({ token, ip })
    return opts.turnstileResult ?? { success: true }
  })

  const deps: Deps = {
    admin,
    makeAuthedClient,
    anon,
    transporter,
    buildPdfBase64: vi.fn(async () => 'ZmFrZS1wZGY='),
    env: { companyEmail: 'fundiverstw@gmail.com', mailFromName: 'FunDivers TW', mailFromAddress: 'fundiverstw@gmail.com' },
    verifyTurnstile,
  }
  return { deps, captured }
}

function postJson(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://test.local/functions/v1/create-registration', {
    method:  'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body:    JSON.stringify(body),
  })
}

const goodBody = {
  event_type:    'dive' as const,
  event_id:      'd1',
  profile_patch: {},
  details:       {},
}

// ---------- tests ---------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleRegistration — request validation', () => {
  it('OPTIONS returns CORS headers and 200', async () => {
    const { deps } = makeDeps()
    const res = await handleRegistration(new Request('http://x/', { method: 'OPTIONS' }), deps)
    expect(res.status).toBe(200)
    // Audit M4 — Allow-Origin is now an allowlist echo, not '*'. The
    // Request constructor in happy-dom strips Origin (forbidden
    // header), so the live OPTIONS we exercise here has no Origin and
    // thus no Allow-Origin echo. Always-set CORS metadata still ships.
    expect(res.headers.get('Vary')).toBe('Origin')
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
  })

  it('non-POST is 405', async () => {
    const { deps } = makeDeps()
    const res = await handleRegistration(new Request('http://x/', { method: 'GET' }), deps)
    expect(res.status).toBe(405)
  })

  it('invalid JSON is 400', async () => {
    const { deps } = makeDeps()
    const res = await handleRegistration(
      new Request('http://x/', { method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' } }),
      deps,
    )
    expect(res.status).toBe(400)
  })

  it('missing event_type/event_id is 400', async () => {
    const { deps } = makeDeps()
    const res = await handleRegistration(postJson({ profile_patch: {}, details: {} }), deps)
    expect(res.status).toBe(400)
  })

  it('guest path missing email/password is 400', async () => {
    const { deps } = makeDeps()
    const res = await handleRegistration(postJson(goodBody), deps)
    expect(res.status).toBe(400)
  })
})

describe('handleRegistration — guest path security (audit C2)', () => {
  it('drops profile_patch.role before applying — attacker cannot self-promote to admin', async () => {
    const { deps, captured } = makeDeps()
    const res = await handleRegistration(postJson({
      ...goodBody,
      email:    'mallory@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
      profile_patch: { role: 'admin', name: 'Mallory' },
    }), deps)
    expect(res.status).toBe(200)
    expect(captured.profileUpdate).toHaveLength(1)
    expect(captured.profileUpdate[0]).not.toHaveProperty('role')
    expect(captured.profileUpdate[0].name).toBe('Mallory')
  })

  it('forces status="pending" on guest path even if patch contained "active"', async () => {
    const { deps, captured } = makeDeps()
    await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
      profile_patch: { status: 'active', name: 'G' },
    }), deps)
    expect(captured.profileUpdate[0].status).toBe('pending')
  })

  it('drops parent_account from the patch (H1: H4-adjacent escalation surface)', async () => {
    const { deps, captured } = makeDeps()
    await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
      profile_patch: { parent_account: 'someone-else-uid', name: 'G' },
    }), deps)
    expect(captured.profileUpdate[0]).not.toHaveProperty('parent_account')
  })

  it('drops every attack key in a kitchen-sink patch', async () => {
    const { deps, captured } = makeDeps()
    await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
      profile_patch: {
        id:             'pwned',
        role:           'admin',
        status:         'active',
        parent_account: 'pwned',
        fin_size:       'XL',
        bcd_size:       'L',
        email:          'attacker@example.com',
        created_at:     '1970-01-01',
      },
    }), deps)
    const written = captured.profileUpdate[0]
    expect(written).toEqual({ status: 'pending' }) // status forced; everything else dropped
  })
})

describe('handleRegistration — target_user_id (on-behalf-of) path security', () => {
  it('admin caller can target any user', async () => {
    const { deps } = makeDeps({ callerRole: 'admin' })
    const res = await handleRegistration(postJson({
      ...goodBody,
      target_user_id: 'some-target-uid',
    }, { Authorization: 'Bearer admin-jwt' }), deps)
    expect(res.status).toBe(200)
  })

  it('non-admin caller is rejected when target is not their child (H1-adjacent path)', async () => {
    const { deps } = makeDeps({
      callerRole: 'diver',
      callerUserId: 'caller-uid',
      targetParentAccount: 'someone-else-uid',
    })
    const res = await handleRegistration(postJson({
      ...goodBody,
      target_user_id: 'someone-elses-child',
    }, { Authorization: 'Bearer diver-jwt' }), deps)
    expect(res.status).toBe(403)
  })

  it('parent caller succeeds when target.parent_account === caller.id', async () => {
    const { deps } = makeDeps({
      callerRole: 'diver',
      callerUserId: 'parent-uid',
      targetParentAccount: 'parent-uid',
    })
    const res = await handleRegistration(postJson({
      ...goodBody,
      target_user_id: 'child-uid',
    }, { Authorization: 'Bearer parent-jwt' }), deps)
    expect(res.status).toBe(200)
  })

  it('parent on-behalf-of: profile_patch.role=admin still dropped (parent cannot promote child)', async () => {
    const { deps, captured } = makeDeps({
      callerRole: 'diver',
      callerUserId: 'parent-uid',
      targetParentAccount: 'parent-uid',
    })
    await handleRegistration(postJson({
      ...goodBody,
      target_user_id: 'child-uid',
      profile_patch:  { role: 'admin', name: 'Innocent Child' },
    }, { Authorization: 'Bearer parent-jwt' }), deps)
    expect(captured.profileUpdate[0]).not.toHaveProperty('role')
    expect(captured.profileUpdate[0].name).toBe('Innocent Child')
  })

  it('parent on-behalf-of: payer_id=parent (the caller) is written onto the child booking', async () => {
    const { deps, captured } = makeDeps({
      callerRole: 'diver',
      callerUserId: 'parent-uid',
      targetParentAccount: 'parent-uid',
    })
    await handleRegistration(postJson({
      ...goodBody,
      target_user_id: 'child-uid',
      payer_id:       'parent-uid',
    }, { Authorization: 'Bearer parent-jwt' }), deps)
    expect(captured.bookingInsert[0].payer_id).toBe('parent-uid')
  })

  it('drops a payer_id that is neither the registrant nor the caller', async () => {
    const { deps, captured } = makeDeps({
      callerRole: 'diver',
      callerUserId: 'parent-uid',
      targetParentAccount: 'parent-uid',
    })
    await handleRegistration(postJson({
      ...goodBody,
      target_user_id: 'child-uid',
      payer_id:       'some-stranger-uid',
    }, { Authorization: 'Bearer parent-jwt' }), deps)
    expect(captured.bookingInsert[0].payer_id).toBeNull()
  })

  it('on-behalf-of path does NOT force status="pending" (only guest signup does)', async () => {
    const { deps, captured } = makeDeps({ callerRole: 'admin' })
    await handleRegistration(postJson({
      ...goodBody,
      target_user_id: 'some-target-uid',
      profile_patch:  { status: 'active', name: 'X' },
    }, { Authorization: 'Bearer admin-jwt' }), deps)
    // status was sanitized out of the patch by the allowlist; nothing forces it back in
    expect(captured.profileUpdate[0]).not.toHaveProperty('status')
  })
})

describe('handleRegistration — authed self path security', () => {
  it('self-auth path: role=admin in patch is dropped', async () => {
    const { deps, captured } = makeDeps({ callerUserId: 'self-uid', callerEmail: 'self@example.com' })
    await handleRegistration(postJson({
      ...goodBody,
      profile_patch: { role: 'admin', name: 'Self' },
    }, { Authorization: 'Bearer self-jwt' }), deps)
    expect(captured.profileUpdate[0]).not.toHaveProperty('role')
  })

  it('invalid bearer is 401', async () => {
    const { deps } = makeDeps()
    deps.makeAuthedClient = vi.fn(() => ({
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'jwt expired' } })) },
    }))
    const res = await handleRegistration(postJson(goodBody, { Authorization: 'Bearer bad' }), deps)
    expect(res.status).toBe(401)
  })
})

describe('handleRegistration — rollback semantics', () => {
  it('guest path: booking insert failure deletes the just-created auth user', async () => {
    const { deps, captured } = makeDeps({
      createUserId:  'new-user-id',
      bookingError:  'unique violation',
    })
    const res = await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }), deps)
    expect(res.status).toBe(500)
    expect(captured.deleteUserCalls).toEqual(['new-user-id'])
  })

  it('authed path: booking insert failure does NOT delete an existing auth user', async () => {
    const { deps, captured } = makeDeps({
      callerUserId: 'pre-existing-uid',
      bookingError: 'unique violation',
    })
    const res = await handleRegistration(postJson(goodBody, { Authorization: 'Bearer existing-jwt' }), deps)
    expect(res.status).toBe(500)
    expect(captured.deleteUserCalls).toEqual([])
  })

  it('guest path: profile update failure also rolls back the auth user', async () => {
    const { deps, captured } = makeDeps({
      createUserId:       'new-user-id',
      profileUpdateError: 'some db error',
    })
    const res = await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }), deps)
    expect(res.status).toBe(500)
    expect(captured.deleteUserCalls).toEqual(['new-user-id'])
  })

  it('pre-existing active booking is rejected (and rolls back guest user)', async () => {
    const { deps, captured } = makeDeps({
      createUserId:    'new-user-id',
      existingBooking: { id: 'b-old', status: 'pending' },
    })
    const res = await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }), deps)
    expect(res.status).toBe(500)
    expect(captured.deleteUserCalls).toEqual(['new-user-id'])
  })
})

describe('handleRegistration — email behaviour', () => {
  it('null transporter skips email entirely without breaking the response', async () => {
    const { deps, captured } = makeDeps()
    deps.transporter = null
    const res = await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }), deps)
    expect(res.status).toBe(200)
    expect(captured.sendMailCalls).toEqual([])
  })

  it('transporter throwing does not fail the response (best-effort email)', async () => {
    const { deps } = makeDeps()
    deps.transporter = { sendMail: vi.fn(async () => { throw new Error('smtp down') }) }
    const res = await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }), deps)
    expect(res.status).toBe(200)
  })

  it('suppress_email skips the per-diver email (group summary sent separately)', async () => {
    const { deps, captured } = makeDeps()
    const res = await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
      group_id: 'grp-1',
      suppress_email: true,
    }), deps)
    expect(res.status).toBe(200)
    expect(captured.sendMailCalls).toEqual([])
  })

  it('does not send a duplicate email to the company inbox when registrant === company', async () => {
    const { deps, captured } = makeDeps()
    await handleRegistration(postJson({
      ...goodBody,
      email:    'fundiverstw@gmail.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }), deps)
    expect(captured.sendMailCalls).toHaveLength(1)
    expect(captured.sendMailCalls[0].to).toBe('fundiverstw@gmail.com')
  })

  it('waitlisted booking sends text-only email (no PDF attachment)', async () => {
    const { deps, captured } = makeDeps({ bookingStatus: 'waitlisted' })
    await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }), deps)
    expect(captured.sendMailCalls.length).toBeGreaterThan(0)
    for (const msg of captured.sendMailCalls) {
      expect(msg.attachments).toBeUndefined()
      expect(msg.subject).toMatch(/^waitlist--/)
    }
  })

  it('forwards the itemized charge snapshot into the PDF payload', async () => {
    const { deps } = makeDeps()
    const charges = [
      { kind: 'base', label: 'Base', amount: 2800 },
      { kind: 'gear', label: 'Gear: BCD', amount: 400 },
    ]
    await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
      details:  { charges, total: 3200 },
    }), deps)
    const buildPdf = deps.buildPdfBase64 as unknown as { mock: { calls: Array<[{ charges: unknown }]> } }
    expect(buildPdf.mock.calls[0][0].charges).toEqual(charges)
  })
})

describe('handleRegistration — H2 guest path gates (Turnstile, rate limit, event existence)', () => {
  it('rejects guest path when turnstile_token is missing', async () => {
    const { deps, captured } = makeDeps()
    const res = await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
    }), deps)
    expect(res.status).toBe(400)
    expect(captured.createUserCalls).toEqual([])
  })

  it('rejects guest path when Turnstile verify fails', async () => {
    const { deps, captured } = makeDeps({
      turnstileResult: { success: false, errorCodes: ['invalid-input-response'] },
    })
    const res = await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tampered',
    }), deps)
    expect(res.status).toBe(403)
    expect(captured.turnstileVerifyCalls).toHaveLength(1)
    expect(captured.createUserCalls).toEqual([])
  })

  it('forwards the client IP from cf-connecting-ip to verifyTurnstile', async () => {
    const { deps, captured } = makeDeps()
    await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }, { 'cf-connecting-ip': '203.0.113.10' }), deps)
    expect(captured.turnstileVerifyCalls[0].ip).toBe('203.0.113.10')
  })

  it('falls through to x-forwarded-for when cf-connecting-ip is absent', async () => {
    const { deps, captured } = makeDeps()
    await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }, { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }), deps)
    expect(captured.turnstileVerifyCalls[0].ip).toBe('198.51.100.7')
  })

  it('throttles when 60s window exceeded', async () => {
    const { deps, captured } = makeDeps({
      rateLimitCounts: { in_last_60s: 6, in_last_24h: 6 },
    })
    const res = await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }), deps)
    expect(res.status).toBe(429)
    expect(captured.createUserCalls).toEqual([])
  })

  it('throttles when 24h window exceeded', async () => {
    const { deps, captured } = makeDeps({
      rateLimitCounts: { in_last_60s: 1, in_last_24h: 51 },
    })
    const res = await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }), deps)
    expect(res.status).toBe(429)
    expect(captured.createUserCalls).toEqual([])
  })

  it('rejects an unknown event_id before creating an auth user', async () => {
    const { deps, captured } = makeDeps({ eventNotFound: true })
    const res = await handleRegistration(postJson({
      ...goodBody,
      event_id: 'does-not-exist',
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }), deps)
    expect(res.status).toBe(404)
    expect(captured.createUserCalls).toEqual([])
  })

  it('authed self-signup skips Turnstile entirely (no token required)', async () => {
    const { deps, captured } = makeDeps({ callerUserId: 'self-uid' })
    const res = await handleRegistration(
      postJson(goodBody, { Authorization: 'Bearer self-jwt' }),
      deps,
    )
    expect(res.status).toBe(200)
    expect(captured.turnstileVerifyCalls).toEqual([])
  })

  it('authed on-behalf-of skips Turnstile entirely', async () => {
    const { deps, captured } = makeDeps({ callerRole: 'admin' })
    const res = await handleRegistration(
      postJson({ ...goodBody, target_user_id: 'kid' }, { Authorization: 'Bearer admin-jwt' }),
      deps,
    )
    expect(res.status).toBe(200)
    expect(captured.turnstileVerifyCalls).toEqual([])
  })
})

describe('handleRegistration — H2 orphan logging on rollback failure', () => {
  it('logs to orphan_auth_users when deleteUser returns an error', async () => {
    const { deps, captured } = makeDeps({
      createUserId:   'new-user-id',
      bookingError:   'unique violation',
      deleteUserError: 'auth service down',
    })
    const res = await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }), deps)
    expect(res.status).toBe(500)
    expect(captured.deleteUserCalls).toEqual(['new-user-id'])
    const orphanCall = captured.rpcCalls.find(c => c.name === 'log_orphan_auth_user')
    expect(orphanCall).toBeDefined()
    const args = orphanCall!.args as { p_user_id: string; p_email: string; p_reason: string }
    expect(args.p_user_id).toBe('new-user-id')
    expect(args.p_email).toBe('g@example.com')
    expect(args.p_reason).toMatch(/auth service down/)
  })

  it('no orphan log when deleteUser succeeds (happy rollback)', async () => {
    const { deps, captured } = makeDeps({
      createUserId: 'new-user-id',
      bookingError: 'unique violation',
    })
    await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }), deps)
    expect(captured.rpcCalls.find(c => c.name === 'log_orphan_auth_user')).toBeUndefined()
  })
})

describe('handleRegistration — happy path returns the booking id and session', () => {
  it('guest signup returns { booking_id, status, session }', async () => {
    const { deps } = makeDeps({ createUserId: 'new-user-id' })
    const res = await handleRegistration(postJson({
      ...goodBody,
      email:    'g@example.com',
      password: 'hunter2hunter2',
      turnstile_token: 'tk',
    }), deps)
    expect(res.status).toBe(200)
    const body = await res.json() as { booking_id: string; status: string; session: unknown }
    expect(body.booking_id).toBe('b1')
    expect(body.status).toBe('pending')
    expect(body.session).not.toBeNull()
  })

  it('authed self-signup returns session=null (no new sign-in needed)', async () => {
    const { deps } = makeDeps({ callerUserId: 'self-uid' })
    const res = await handleRegistration(postJson(goodBody, { Authorization: 'Bearer self-jwt' }), deps)
    expect(res.status).toBe(200)
    const body = await res.json() as { session: unknown }
    expect(body.session).toBeNull()
  })
})

describe('handleRegistration — past-event guard', () => {
  it('rejects an authed diver registering for a past event', async () => {
    const { deps, captured } = makeDeps({ callerUserId: 'self-uid', callerRole: 'diver', eventPast: true })
    const res = await handleRegistration(postJson(goodBody, { Authorization: 'Bearer self-jwt' }), deps)
    expect(res.status).toBe(403)
    expect(captured.bookingInsert).toHaveLength(0)
  })

  it('rejects a guest registering for a past event before creating the user', async () => {
    const { deps, captured } = makeDeps({ eventPast: true })
    const res = await handleRegistration(postJson({
      ...goodBody, email: 'g@example.com', password: 'hunter2hunter2', turnstile_token: 'tk',
    }), deps)
    expect(res.status).toBe(403)
    expect(captured.createUserCalls).toHaveLength(0)
    expect(captured.bookingInsert).toHaveLength(0)
  })

  it('lets an admin register a diver for a past event (full control)', async () => {
    const { deps, captured } = makeDeps({ callerRole: 'admin', eventPast: true })
    const res = await handleRegistration(postJson({
      ...goodBody, target_user_id: 'some-target-uid',
    }, { Authorization: 'Bearer admin-jwt' }), deps)
    expect(res.status).toBe(200)
    expect(captured.bookingInsert).toHaveLength(1)
  })

  it('rejects a parent registering a child for a past event', async () => {
    const { deps } = makeDeps({ callerRole: 'diver', callerUserId: 'parent-uid', targetParentAccount: 'parent-uid', eventPast: true })
    const res = await handleRegistration(postJson({
      ...goodBody, target_user_id: 'child-uid',
    }, { Authorization: 'Bearer parent-jwt' }), deps)
    expect(res.status).toBe(403)
  })
})
