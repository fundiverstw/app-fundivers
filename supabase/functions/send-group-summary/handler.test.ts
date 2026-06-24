import { describe, it, expect, vi } from 'vitest'
import { handleGroupSummary, type Deps } from './handler'

// Unit suite for the group-summary handler. In-memory deps, no network/DB.
// Asserts: authorization (token + group membership), the consolidated
// payload it hands the PDF builder (column count + summed group total),
// and that exactly one summary goes to the company and one to the lead.

interface TableSpec { rows: Array<Record<string, unknown>> }

// Chainable supabase-from stub: records eq/in filters, resolves to the
// filtered list on await and to the first match on maybeSingle().
function makeFrom(tables: Record<string, TableSpec>) {
  return (table: string) => {
    const spec = tables[table] ?? { rows: [] }
    const filters: Record<string, unknown> = {}
    const filtered = () => spec.rows.filter(r =>
      Object.entries(filters).every(([k, v]) =>
        Array.isArray(v) ? v.includes(r[k]) : r[k] === v))
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters[col] = val; return builder },
      in: (col: string, vals: unknown) => { filters[col] = vals; return builder },
      order: () => builder,
      maybeSingle: () => Promise.resolve({ data: filtered()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: filtered(), error: null }),
    }
    return builder
  }
}

interface Opts {
  callerId?: string | null
  callerEmail?: string | null
  bookings?: Array<Record<string, unknown>>
  bookingsError?: boolean
  transporter?: boolean
}

function makeDeps(opts: Opts = {}) {
  const sendMail = vi.fn().mockResolvedValue(undefined)
  const buildGroupPdfBase64 = vi.fn().mockResolvedValue('UERG')
  const bookings = opts.bookings ?? [
    { id: 'b1', user_id: 'u1', status: 'pending', eo_dive_id: 'd1', eo_course_id: null, group_id: 'g1', payer_id: 'u1', created_at: '2030-01-01',
      details: { total: 2800, deposit: 1000, payment_method: 'bank_transfer', transportation: false, gear: { rent: false } } },
    { id: 'b2', user_id: 'c1', status: 'pending', eo_dive_id: 'd1', eo_course_id: null, group_id: 'g1', payer_id: 'u1', created_at: '2030-01-02',
      details: { total: 2800, deposit: 1000, payment_method: 'bank_transfer', transportation: false, gear: { rent: false } } },
  ]
  const tables: Record<string, TableSpec> = {
    bookings: { rows: opts.bookingsError ? [] : bookings },
    profiles: { rows: [
      { id: 'u1', name: 'Ada', nickname: null, date_of_birth: '1990-01-01', nationality: 'TW', cert_level: 'AOW', cert_agency: 'PADI', nitrox_certified: true },
      { id: 'c1', name: 'Bee Jr', nickname: 'Bee', date_of_birth: '2012-05-05', nationality: 'TW', cert_level: null, cert_agency: null, nitrox_certified: false },
    ] },
    EO_dives: { rows: [
      { _id: 'd1', display_title: 'Green Island', admin_title: null, calendar_title: null, start_date: '2030-06-12', end_date: null, course_days: null },
    ] },
  }
  const admin = { from: opts.bookingsError
    ? () => ({ select: () => ({ eq: () => ({ order: () => ({ then: (r: (v: unknown) => unknown) => r({ data: null, error: { message: 'boom' } }) }) }) }) })
    : makeFrom(tables) }
  const deps: Deps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    admin: admin as any,
    makeAuthedClient: () => ({
      auth: { getUser: async () => ({
        data: { user: opts.callerId === null ? null : { id: opts.callerId ?? 'u1', email: opts.callerEmail ?? 'ada@example.com' } },
        error: opts.callerId === null ? { message: 'no user' } : null,
      }) },
    }),
    transporter: opts.transporter === false ? null : { sendMail },
    buildGroupPdfBase64,
    env: { companyEmail: 'shop@fundiverstw.com', mailFromName: 'FunDivers TW', mailFromAddress: 'shop@fundiverstw.com' },
  }
  return { deps, sendMail, buildGroupPdfBase64 }
}

function post(body: unknown, withToken = true): Request {
  return new Request('https://x/send-group-summary', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(withToken ? { authorization: 'Bearer tok' } : {}) },
    body: JSON.stringify(body),
  })
}

describe('handleGroupSummary', () => {
  it('builds one consolidated payload and emails the company + the lead', async () => {
    const { deps, sendMail, buildGroupPdfBase64 } = makeDeps()
    const res = await handleGroupSummary(post({ group_id: 'g1' }), deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, divers: 2, group_total: 5600 })

    expect(buildGroupPdfBase64).toHaveBeenCalledOnce()
    const payload = buildGroupPdfBase64.mock.calls[0][0]
    expect(payload.divers).toHaveLength(2)
    expect(payload.groupTotal).toBe(5600)
    expect(payload.groupDeposit).toBe(2000)
    expect(payload.generatedFor).toBe('Ada')
    expect(payload.divers[0]).toMatchObject({ name: 'Ada', eventTitle: 'Green Island', total: 2800 })

    // One mail to the company, one to the lead.
    expect(sendMail).toHaveBeenCalledTimes(2)
    const recipients = sendMail.mock.calls.map(c => c[0].to)
    expect(recipients).toContain('shop@fundiverstw.com')
    expect(recipients).toContain('ada@example.com')
  })

  it('rejects a caller with no Bearer token', async () => {
    const { deps, buildGroupPdfBase64 } = makeDeps()
    const res = await handleGroupSummary(post({ group_id: 'g1' }, false), deps)
    expect(res.status).toBe(401)
    expect(buildGroupPdfBase64).not.toHaveBeenCalled()
  })

  it('forbids a caller who is neither a booked diver nor the payer', async () => {
    const { deps, buildGroupPdfBase64 } = makeDeps({ callerId: 'stranger', callerEmail: 'x@y.com' })
    const res = await handleGroupSummary(post({ group_id: 'g1' }), deps)
    expect(res.status).toBe(403)
    expect(buildGroupPdfBase64).not.toHaveBeenCalled()
  })

  it('404s when the group has no bookings', async () => {
    const { deps } = makeDeps({ bookings: [] })
    const res = await handleGroupSummary(post({ group_id: 'nope' }), deps)
    expect(res.status).toBe(404)
  })

  it('requires group_id', async () => {
    const { deps } = makeDeps()
    const res = await handleGroupSummary(post({}), deps)
    expect(res.status).toBe(400)
  })

  it('still returns ok when no transporter is wired (skips email)', async () => {
    const { deps, buildGroupPdfBase64 } = makeDeps({ transporter: false })
    const res = await handleGroupSummary(post({ group_id: 'g1' }), deps)
    expect(res.status).toBe(200)
    expect(buildGroupPdfBase64).not.toHaveBeenCalled()
  })
})
