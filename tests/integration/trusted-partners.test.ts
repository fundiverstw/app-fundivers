// Integration coverage for the trusted_partners catalog + list_trusted_partners
// RPC (20260703010000). Runs against the live local Supabase stack.
//
// The security contract: a diver must NOT be able to read a partner's email.
// RLS grants direct table access to admins only; divers read the public
// projection (name/region/blurb, no email) via the SECURITY DEFINER RPC, and
// only active partners are returned.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient, createTestUser, deleteTestUser, type TestUser,
} from './helpers'

const admin = adminClient()
let diver: TestUser
let adminUser: TestUser
const cleanup: string[] = []

async function createPartner(name: string, email: string, active = true): Promise<string> {
  const { data, error } = await admin.from('trusted_partners')
    .insert({ name, email, active } as never).select('id').single()
  if (error) throw new Error(`createPartner: ${error.message}`)
  const id = (data as { id: string }).id
  cleanup.push(id)
  return id
}

beforeAll(async () => {
  diver = await createTestUser(admin, { role: 'diver' })
  adminUser = await createTestUser(admin, { role: 'admin' })
})

afterAll(async () => {
  for (const id of cleanup) await admin.from('trusted_partners').delete().eq('id', id)
  for (const u of [diver, adminUser]) if (u) await deleteTestUser(admin, u.id)
})

describe('trusted_partners access', () => {
  it('hides the table from divers but exposes name/region/blurb (no email) via the RPC', async () => {
    const activeId = await createPartner('Blue Manta', 'bm@example.test', true)
    await createPartner('Retired Co', 'retired@example.test', false)

    const diverClient = await userClient(diver.email, diver.password)

    // Direct table read is denied by RLS → no rows (so no email leak).
    const direct = await diverClient.from('trusted_partners').select('*')
    expect(direct.data ?? []).toEqual([])

    // The RPC returns the active partner, projected WITHOUT the email column.
    const { data, error } = await diverClient.rpc('list_trusted_partners')
    expect(error).toBeNull()
    const rows = (data ?? []) as Array<Record<string, unknown>>
    const bm = rows.find(r => r.id === activeId)
    expect(bm).toBeTruthy()
    expect(bm).not.toHaveProperty('email')
    expect(bm!.name).toBe('Blue Manta')
    // Retired partners are withheld.
    expect(rows.some(r => r.name === 'Retired Co')).toBe(false)
  })

  it('lets an admin read the full row including the email', async () => {
    const id = await createPartner('Admin View', 'av@example.test', true)
    const adminScoped = await userClient(adminUser.email, adminUser.password)
    const { data } = await adminScoped.from('trusted_partners')
      .select('*').eq('id', id).maybeSingle()
    expect((data as { email?: string } | null)?.email).toBe('av@example.test')
  })
})
