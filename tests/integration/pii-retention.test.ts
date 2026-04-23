import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { adminClient, createTestUser, deleteTestUser, type TestUser } from './helpers'

const admin = adminClient()
let staleDiver: TestUser
let recentDiver: TestUser
let staleAdmin: TestUser  // admins are exempt from the purge

beforeAll(async () => {
  staleDiver  = await createTestUser(admin, { role: 'diver' })
  recentDiver = await createTestUser(admin, { role: 'diver' })
  staleAdmin  = await createTestUser(admin, { role: 'admin' })

  // Fill PII we want to verify gets wiped (or kept, depending on the case).
  const pii = {
    id_number: 'X123456789',
    medical_notes: 'Mild asthma',
    emergency_contact_name:  'Jane Doe',
    emergency_contact_phone: '+886912345678',
    cert_card_path: `${staleDiver.id}/cert.jpg`,
  }
  for (const uid of [staleDiver.id, recentDiver.id, staleAdmin.id]) {
    await admin.from('profiles').update({ ...pii, cert_card_path: `${uid}/cert.jpg` }).eq('id', uid)
  }

  // Age `staleDiver` and `staleAdmin` past the default 12-month cutoff by
  // rewriting their created_at. Only diver rows should be purged; admins
  // are excluded by the function's role filter.
  const oldDate = new Date(Date.now() - 400 * 86_400_000).toISOString()
  await admin.from('profiles').update({ created_at: oldDate }).eq('id', staleDiver.id)
  await admin.from('profiles').update({ created_at: oldDate }).eq('id', staleAdmin.id)
})

afterAll(async () => {
  if (staleDiver)  await deleteTestUser(admin, staleDiver.id)
  if (recentDiver) await deleteTestUser(admin, recentDiver.id)
  if (staleAdmin)  await deleteTestUser(admin, staleAdmin.id)
})

describe('purge_stale_pii', () => {
  it('wipes sensitive columns on stale diver profiles, leaves recent + admin rows intact', async () => {
    const { data: countBefore } = await admin.from('profiles')
      .select('id, id_number, medical_notes, emergency_contact_name, emergency_contact_phone, cert_card_path')
      .in('id', [staleDiver.id, recentDiver.id, staleAdmin.id])
    // Sanity: all three start with PII filled in.
    for (const row of countBefore ?? []) {
      expect(row.id_number).not.toBeNull()
    }

    // Run the purge.
    const { data: affected, error } = await admin.rpc('purge_stale_pii', { older_than_months: 12 })
    expect(error).toBeNull()
    expect(typeof affected).toBe('number')

    const { data: after } = await admin.from('profiles')
      .select('id, id_number, medical_notes, emergency_contact_name, emergency_contact_phone, cert_card_path')
      .in('id', [staleDiver.id, recentDiver.id, staleAdmin.id])
    const byId = new Map((after ?? []).map(r => [r.id, r]))

    // Stale diver: all PII nulled.
    const staleRow = byId.get(staleDiver.id)!
    expect(staleRow.id_number).toBeNull()
    expect(staleRow.medical_notes).toBeNull()
    expect(staleRow.emergency_contact_name).toBeNull()
    expect(staleRow.emergency_contact_phone).toBeNull()
    expect(staleRow.cert_card_path).toBeNull()

    // Recent diver (fresh created_at): untouched.
    const recentRow = byId.get(recentDiver.id)!
    expect(recentRow.id_number).not.toBeNull()

    // Stale admin: role='admin' is exempt, untouched.
    const adminRow = byId.get(staleAdmin.id)!
    expect(adminRow.id_number).not.toBeNull()
  })
})
