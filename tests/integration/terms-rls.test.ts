import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// The Terms of Use are shop-authored (20260711100000). This pins the contract
// the legal flow depends on:
//   - anyone can READ them (the /terms page is reachable before signup),
//   - only an admin can CHANGE them,
//   - there is exactly ONE row, and nobody can add or delete one,
//   - the version can never go backwards (a diver who accepted v3 must not be
//     silently satisfied by a rolled-back v2),
//   - accept_current_terms() records the SERVER's version, not the client's.

const admin = adminClient()

let adminUser: TestUser
let diver: TestUser
let adminSb: Awaited<ReturnType<typeof userClient>>
let diverSb: Awaited<ReturnType<typeof userClient>>
let startVersion: number

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver = await createTestUser(admin, { role: 'diver' })
  adminSb = await userClient(adminUser.email, adminUser.password)
  diverSb = await userClient(diver.email, diver.password)

  const { data } = await admin.from('terms').select('version').single()
  startVersion = data!.version
})

afterAll(async () => {
  await admin.from('terms').update({ body: '' }).eq('singleton', true)
  await deleteTestUser(admin, adminUser.id)
  await deleteTestUser(admin, diver.id)
})

describe('terms RLS', () => {
  it('is readable by anon and by any authenticated diver', async () => {
    const { data: anonRow, error: anonErr } = await anonClient().from('terms').select('*').single()
    expect(anonErr).toBeNull()
    expect(anonRow).toMatchObject({ singleton: true })

    const { data: diverRow, error: diverErr } = await diverSb.from('terms').select('*').single()
    expect(diverErr).toBeNull()
    expect(diverRow!.version).toBeGreaterThanOrEqual(1)
  })

  it('cannot be updated by a diver', async () => {
    await diverSb.from('terms').update({ body: 'hacked' }).eq('singleton', true)
    // RLS surfaces either as an error or as zero affected rows. Either way the
    // row must be untouched — that is the property worth asserting.
    const { data } = await admin.from('terms').select('body').single()
    expect(data!.body).not.toBe('hacked')
  })

  it('can be updated by an admin', async () => {
    const { error } = await adminSb
      .from('terms').update({ body: '# Hello', title: 'Terms' }).eq('singleton', true)
    expect(error).toBeNull()
    const { data } = await admin.from('terms').select('body').single()
    expect(data!.body).toBe('# Hello')
  })

  it('allows no second row and no delete, even for an admin', async () => {
    const { error: insErr } = await adminSb.from('terms').insert({ singleton: true } as never)
    expect(insErr).not.toBeNull()

    await adminSb.from('terms').delete().eq('singleton', true)
    const { count } = await admin.from('terms').select('*', { count: 'exact', head: true })
    expect(count).toBe(1)
  })

  it('refuses to move the version backwards', async () => {
    await admin.from('terms').update({ version: startVersion + 2 }).eq('singleton', true)
    const { error } = await admin.from('terms').update({ version: startVersion }).eq('singleton', true)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/cannot decrease/i)
  })
})

describe('accept_current_terms()', () => {
  it('records the version from the table, whatever the client believes', async () => {
    const target = startVersion + 5
    await admin.from('terms').update({ version: target }).eq('singleton', true)

    const { data: returned, error } = await diverSb.rpc('accept_current_terms')
    expect(error).toBeNull()
    expect(returned).toBe(target)

    const { data: profile } = await admin
      .from('profiles').select('agreed_to_terms_version, agreed_to_terms_at').eq('id', diver.id).single()
    expect(profile!.agreed_to_terms_version).toBe(target)
    expect(profile!.agreed_to_terms_at).not.toBeNull()
  })

  it('takes no arguments, so a client cannot choose its own version', async () => {
    // The old 1-arg signature was dropped by the migration.
    const { error } = await diverSb.rpc('accept_current_terms', { p_version: 9999 } as never)
    expect(error).not.toBeNull()
  })

  it('rejects an unauthenticated caller', async () => {
    const { error } = await anonClient().rpc('accept_current_terms')
    expect(error).not.toBeNull()
  })
})
