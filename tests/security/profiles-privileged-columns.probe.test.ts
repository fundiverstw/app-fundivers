import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestUser, deleteTestUser, type TestUser } from '../integration/helpers'
import {
  adminClient, rawFetch, loginAs, restUrl, bearerHeaders,
  ANON_KEY,
} from './probe'

// Wire-level probes for security-audit C1 + H1.
//
// What this covers vs the integration test:
//
//   tests/integration/profiles-privileged-columns-locked.test.ts uses
//   supabase-js — same DB, same RLS, but the JS client normalizes
//   headers, applies the URL builder, and pre-encodes filters. These
//   probes use raw fetch() so we catch any wire-shape an attacker could
//   send that supabase-js wouldn't (PostgREST query operators, PUT vs
//   PATCH, bulk update with no filter, unusual content types, missing
//   apikey, etc.). Each of those is its own historical RLS bypass
//   technique against PostgREST, so the probe set IS the test we want.

const admin = adminClient()

let adminUser:  TestUser
let diverA:     TestUser
let childB:     TestUser
let strangerC:  TestUser   // unrelated diver — for cross-account read probes
let diverHeaders:    () => Record<string, string>
let strangerHeaders: () => Record<string, string>
let adminHeaders:    () => Record<string, string>

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diverA    = await createTestUser(admin, { role: 'diver' })
  childB    = await createTestUser(admin, { role: 'diver' })
  strangerC = await createTestUser(admin, { role: 'diver' })
  const { error } = await admin.from('profiles').update({ parent_account: diverA.id }).eq('id', childB.id)
  if (error) throw new Error(`linking child failed: ${error.message}`)

  diverHeaders    = (await loginAs(diverA.email, diverA.password)).headers
  strangerHeaders = (await loginAs(strangerC.email, strangerC.password)).headers
  adminHeaders    = (await loginAs(adminUser.email, adminUser.password)).headers
})

afterAll(async () => {
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diverA)    await deleteTestUser(admin, diverA.id)
  if (childB)    await deleteTestUser(admin, childB.id)
  if (strangerC) await deleteTestUser(admin, strangerC.id)
})

describe('PostgREST PATCH /profiles attack surface (audit C1)', () => {
  it('direct PATCH role=admin returns 403 with 42501 in body', async () => {
    const r = await rawFetch(restUrl(`/profiles?id=eq.${diverA.id}`), {
      method: 'PATCH',
      headers: diverHeaders(),
      body: { role: 'admin' },
    })
    expect(r.status).toBe(403)
    expect(r.text).toContain('42501')
    expect(r.text).toMatch(/admin-managed/i)
    const after = await admin.from('profiles').select('role').eq('id', diverA.id).single()
    expect(after.data?.role).toBe('diver')
  })

  it('PATCH with a "Prefer: return=representation" header is still rejected (no info leak via the row echo)', async () => {
    const r = await rawFetch(restUrl(`/profiles?id=eq.${diverA.id}`), {
      method: 'PATCH',
      headers: { ...diverHeaders(), Prefer: 'return=representation' },
      body: { role: 'admin' },
    })
    expect(r.status).toBe(403)
    expect(r.text).not.toContain(diverA.id)
  })

  it('PATCH role=admin via a PostgREST or= filter still hits the trigger (column gate is independent of row filter)', async () => {
    const r = await rawFetch(restUrl(`/profiles?or=(id.eq.${diverA.id},id.eq.${adminUser.id})`), {
      method: 'PATCH',
      headers: diverHeaders(),
      body: { role: 'admin' },
    })
    expect([403, 404]).toContain(r.status)
    expect(r.text).toContain('42501')
    const after = await admin.from('profiles').select('id,role').in('id', [diverA.id, adminUser.id])
    const adminRow = after.data?.find(r => r.id === adminUser.id)
    expect(adminRow?.role).toBe('admin')
  })

  it('PATCH role=admin on someone-else (no id filter that matches the caller) does not escalate them', async () => {
    const r = await rawFetch(restUrl(`/profiles?id=eq.${childB.id}`), {
      method: 'PATCH',
      headers: diverHeaders(),
      body: { role: 'admin' },
    })
    expect([403, 404]).toContain(r.status)
    const after = await admin.from('profiles').select('role').eq('id', childB.id).single()
    expect(after.data?.role).toBe('diver')
  })

  it('bulk PATCH with no filter at all (an attacker shortcut against weak RLS) cannot promote anyone', async () => {
    const r = await rawFetch(restUrl(`/profiles`), {
      method: 'PATCH',
      headers: diverHeaders(),
      body: { role: 'admin' },
    })
    expect([400, 403]).toContain(r.status)
    const after = await admin.from('profiles')
      .select('id,role')
      .in('id', [diverA.id, childB.id, adminUser.id])
    const promoted = after.data?.filter(p => p.id !== adminUser.id && p.role === 'admin') ?? []
    expect(promoted).toEqual([])
  })

  it('PostgREST does not accept PUT for partial-update — and column gate holds either way', async () => {
    const r = await rawFetch(restUrl(`/profiles?id=eq.${diverA.id}`), {
      method: 'PUT',
      headers: { ...diverHeaders(), Prefer: 'resolution=merge-duplicates' },
      body: { id: diverA.id, role: 'admin' },
    })
    expect([400, 403, 405, 422]).toContain(r.status)
    const after = await admin.from('profiles').select('role').eq('id', diverA.id).single()
    expect(after.data?.role).toBe('diver')
  })

  it('one diver cannot read an unrelated diver\'s row even by asking for it directly (RLS row filter)', async () => {
    const r = await rawFetch(restUrl(`/profiles?select=id,role&id=eq.${diverA.id}`), {
      method: 'GET',
      headers: strangerHeaders(),
    })
    expect(r.status).toBe(200)
    expect(r.json()).toEqual([])
  })
})

describe('Status laundering — manual-verification gate (audit M3 + C1 status column)', () => {
  it('pending diver cannot flip own status via PATCH', async () => {
    const pending = await createTestUser(admin, { role: 'diver', status: 'pending' })
    try {
      const sess = await loginAs(pending.email, pending.password)
      const r = await rawFetch(restUrl(`/profiles?id=eq.${pending.id}`), {
        method: 'PATCH',
        headers: sess.headers(),
        body: { status: 'active' },
      })
      expect(r.status).toBe(403)
      expect(r.text).toContain('42501')
      const after = await admin.from('profiles').select('status').eq('id', pending.id).single()
      expect(after.data?.status).toBe('pending')
    } finally {
      await deleteTestUser(admin, pending.id)
    }
  })
})

describe('Parent-of-child escalation (audit H1, wire view)', () => {
  it('parent PATCH child role=admin → 403 with 42501', async () => {
    const r = await rawFetch(restUrl(`/profiles?id=eq.${childB.id}`), {
      method: 'PATCH',
      headers: diverHeaders(),
      body: { role: 'admin' },
    })
    expect(r.status).toBe(403)
    expect(r.text).toContain('42501')
    const after = await admin.from('profiles').select('role').eq('id', childB.id).single()
    expect(after.data?.role).toBe('diver')
  })

  it('parent PATCH parent_account=<self-id, but on child row> cannot re-parent the child silently', async () => {
    const r = await rawFetch(restUrl(`/profiles?id=eq.${childB.id}`), {
      method: 'PATCH',
      headers: diverHeaders(),
      body: { parent_account: adminUser.id },
    })
    expect(r.status).toBe(403)
    const after = await admin.from('profiles').select('parent_account').eq('id', childB.id).single()
    expect(after.data?.parent_account).toBe(diverA.id)
  })
})

describe('Anon / no-apikey probes (defense-in-depth — RLS must reject without help)', () => {
  it('PATCH with apikey only (no JWT) silently filters to zero rows under RLS', async () => {
    // PostgREST's contract: when no row passes the RLS filter the UPDATE
    // succeeds with 0 rows affected — returning 204, not 401/403. The
    // security guarantee is that the row didn't change, not the status
    // code. We assert both.
    const before = await admin.from('profiles').select('role').eq('id', diverA.id).single()
    const r = await rawFetch(restUrl(`/profiles?id=eq.${diverA.id}`), {
      method: 'PATCH',
      headers: { apikey: ANON_KEY() },
      body: { role: 'admin' },
    })
    expect([200, 204, 401, 403]).toContain(r.status)
    const after = await admin.from('profiles').select('role').eq('id', diverA.id).single()
    expect(after.data?.role).toBe(before.data?.role)
    expect(after.data?.role).toBe('diver')
  })

  it('PATCH with NO apikey at all is treated as anon — same RLS-zero-rows result', async () => {
    const before = await admin.from('profiles').select('role').eq('id', diverA.id).single()
    const r = await rawFetch(restUrl(`/profiles?id=eq.${diverA.id}`), {
      method: 'PATCH',
      headers: { apikey: '' },
      body: { role: 'admin' },
    })
    expect([200, 204, 401, 403]).toContain(r.status)
    const after = await admin.from('profiles').select('role').eq('id', diverA.id).single()
    expect(after.data?.role).toBe(before.data?.role)
  })

  it('GET /profiles as anon returns zero rows (no PII leak)', async () => {
    const r = await rawFetch(restUrl(`/profiles?select=id,role`), {
      method: 'GET',
      headers: { apikey: ANON_KEY() },
    })
    expect(r.status).toBe(200)
    expect(r.json()).toEqual([])
  })
})

describe('Trigger semantics (verify the trigger lets through what it should)', () => {
  it('admin PATCH role=staff → 200 (positive control)', async () => {
    const target = await createTestUser(admin, { role: 'diver' })
    try {
      const r = await rawFetch(restUrl(`/profiles?id=eq.${target.id}`), {
        method: 'PATCH',
        headers: { ...adminHeaders(), Prefer: 'return=representation' },
        body: { role: 'staff' },
      })
      expect(r.status).toBe(200)
      const after = await admin.from('profiles').select('role').eq('id', target.id).single()
      expect(after.data?.role).toBe('staff')
    } finally {
      await deleteTestUser(admin, target.id)
    }
  })

  it('diver PATCH nickname → 204 (regression — non-privileged column still writable)', async () => {
    const r = await rawFetch(restUrl(`/profiles?id=eq.${diverA.id}`), {
      method: 'PATCH',
      headers: diverHeaders(),
      body: { nickname: 'wire-probe-edit' },
    })
    expect([200, 204]).toContain(r.status)
    const after = await admin.from('profiles').select('nickname').eq('id', diverA.id).single()
    expect(after.data?.nickname).toBe('wire-probe-edit')
  })

  it('diver PATCH role with the SAME current value is a no-op (trigger uses IS DISTINCT FROM)', async () => {
    const r = await rawFetch(restUrl(`/profiles?id=eq.${diverA.id}`), {
      method: 'PATCH',
      headers: diverHeaders(),
      body: { role: 'diver' },
    })
    expect([200, 204]).toContain(r.status)
  })
})

describe('Auth-endpoint hardening (defense-in-depth — these are not specific to C1 but the probe shape lives here)', () => {
  it('GET /profiles with a forged-signature JWT does not see the targeted user\'s row', async () => {
    const { token } = await loginAs(diverA.email, diverA.password)
    const [header, payload] = token.split('.')
    const forged = `${header}.${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
    const r = await rawFetch(`${restUrl('/profiles')}?select=id,role&id=eq.${diverA.id}`, {
      method: 'GET',
      headers: bearerHeaders(forged),
    })
    // PostgREST may 401 the bad Bearer, or it may fall back to anon
    // (depending on PostgREST config). Either way the row must not leak.
    expect([200, 204, 401, 403]).toContain(r.status)
    if (r.status === 200) {
      expect(r.json()).toEqual([])
    }
  })
})
