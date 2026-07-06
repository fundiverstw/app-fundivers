import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, createTestUser, deleteTestUser,
  createTestDive, deleteTestDive, type TestUser,
} from './helpers'

// Pins the audit-M5 + legal-brief #4 migration
// (20260603010000_pii_purge_audit_and_broaden.sql):
//   - All three card-path columns nulled (cert/nitrox/deep), not just
//     cert_card_path as the older version did.
//   - bookings.notes for the stale users' bookings is nulled.
//   - One synthetic admin_audit_log row written per purge run carrying
//     the cutoff + affected counts + the scrubbed profile ids.
//   - Already-implemented bits (id_number, medical_notes, emergency
//     contact) still get nulled — regression guard.

const admin = adminClient()
let staleUser:  TestUser
let recentUser: TestUser
let diveId:     string

const STALE_PII = {
  id_number:               'A123456789',
  medical_notes:           'asthma',
  emergency_contact_name:  'Em Contact',
  emergency_contact_phone: '+886-900-000-000',
  cert_card_path:          'stale-user/cert.jpg',
  nitrox_card_path:        'stale-user/nitrox.jpg',
  deep_card_path:          'stale-user/deep.jpg',
}

const RECENT_PII = { ...STALE_PII, id_number: 'B987654321' }

beforeAll(async () => {
  diveId = await createTestDive(admin)
  staleUser  = await createTestUser(admin, { role: 'diver' })
  recentUser = await createTestUser(admin, { role: 'diver' })

  await admin.from('profiles').update(STALE_PII as never).eq('id', staleUser.id)
  await admin.from('profiles').update(RECENT_PII as never).eq('id', recentUser.id)

  // Force staleUser to look 24 months old (no bookings + ancient
  // created_at). recentUser keeps default created_at = now() so the
  // 12-month sweep should leave them alone.
  const longAgo = new Date(Date.now() - 24 * 30 * 86400000).toISOString()
  await admin.from('profiles').update({ created_at: longAgo } as never).eq('id', staleUser.id)
})

afterAll(async () => {
  if (diveId)     await deleteTestDive(admin, diveId)
  if (staleUser)  await deleteTestUser(admin, staleUser.id)
  if (recentUser) await deleteTestUser(admin, recentUser.id)
})

describe('purge_stale_pii: broadened columns + bookings.notes', () => {
  it('nulls all three card-path columns on stale profiles, not just cert_card_path', async () => {
    const before = await admin.from('profiles')
      .select('cert_card_path, nitrox_card_path, deep_card_path')
      .eq('id', staleUser.id).single()
    expect(before.data?.cert_card_path).not.toBeNull()

    const { data: affected, error } = await admin.rpc('purge_stale_pii', { older_than_months: 12 })
    expect(error).toBeNull()
    expect((affected ?? 0)).toBeGreaterThan(0)

    const after = await admin.from('profiles')
      .select('cert_card_path, nitrox_card_path, deep_card_path, id_number, medical_notes, emergency_contact_name, emergency_contact_phone')
      .eq('id', staleUser.id).single()
    expect(after.data?.cert_card_path).toBeNull()
    expect(after.data?.nitrox_card_path).toBeNull()
    expect(after.data?.deep_card_path).toBeNull()
    expect(after.data?.id_number).toBeNull()
    expect(after.data?.medical_notes).toBeNull()
    expect(after.data?.emergency_contact_name).toBeNull()
    expect(after.data?.emergency_contact_phone).toBeNull()
  })

  it('leaves recent profiles untouched (purge is gated by inactivity cutoff)', async () => {
    const after = await admin.from('profiles')
      .select('cert_card_path, nitrox_card_path, deep_card_path, id_number, medical_notes')
      .eq('id', recentUser.id).single()
    expect(after.data?.id_number).toBe(RECENT_PII.id_number)
    expect(after.data?.cert_card_path).toBe(RECENT_PII.cert_card_path)
    expect(after.data?.nitrox_card_path).toBe(RECENT_PII.nitrox_card_path)
    expect(after.data?.deep_card_path).toBe(RECENT_PII.deep_card_path)
    expect(after.data?.medical_notes).toBe(RECENT_PII.medical_notes)
  })

  it('nulls bookings.notes for stale users\' bookings', async () => {
    const fresh = await createTestUser(admin, { role: 'diver' })
    try {
      const longAgo = new Date(Date.now() - 24 * 30 * 86400000).toISOString()
      await admin.from('profiles').update({ created_at: longAgo } as never).eq('id', fresh.id)
      const { data: booking } = await admin.from('bookings').insert({
        user_id:      fresh.id,
        status:       'confirmed',
        notes:        'private medical history note',
        details:      {},
        event_id:     diveId,
      } as never).select().single()
      expect(booking?.notes).toBe('private medical history note')

      await admin.from('bookings').update({ created_at: longAgo } as never).eq('id', booking!.id)

      await admin.rpc('purge_stale_pii', { older_than_months: 12 })

      const after = await admin.from('bookings').select('notes').eq('id', booking!.id).single()
      expect(after.data?.notes).toBeNull()
    } finally {
      await deleteTestUser(admin, fresh.id)
    }
  })
})

describe('purge_stale_pii: admin_audit_log compliance evidence (audit M5)', () => {
  it('writes one synthetic admin_audit_log row per purge run', async () => {
    const before = await admin.from('admin_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('target_table', 'profiles').eq('target_id', 'pii_purge')

    await admin.rpc('purge_stale_pii', { older_than_months: 12 })

    const after = await admin.from('admin_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('target_table', 'profiles').eq('target_id', 'pii_purge')
    expect((after.count ?? 0)).toBeGreaterThan(before.count ?? 0)
  })

  it('audit row carries cutoff + counts + scrubbed ids', async () => {
    const fresh = await createTestUser(admin, { role: 'diver' })
    try {
      const longAgo = new Date(Date.now() - 24 * 30 * 86400000).toISOString()
      await admin.from('profiles').update({ created_at: longAgo, id_number: 'C111' } as never).eq('id', fresh.id)
      await admin.rpc('purge_stale_pii', { older_than_months: 12 })

      const { data } = await admin.from('admin_audit_log')
        .select('actor_id, action, target_table, target_id, before')
        .eq('target_table', 'profiles')
        .eq('target_id', 'pii_purge')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      expect(data?.actor_id).toBeNull()
      expect(data?.action).toBe('delete')
      expect(data?.target_table).toBe('profiles')
      expect(data?.target_id).toBe('pii_purge')
      const before = data?.before as Record<string, unknown>
      expect(before.cutoff).toBeDefined()
      expect(before.older_than_months).toBe(12)
      expect(Array.isArray(before.profile_ids)).toBe(true)
      expect((before.profile_ids as string[])).toContain(fresh.id)
      expect(typeof before.profiles_scrubbed).toBe('number')
      expect(typeof before.booking_notes_scrubbed).toBe('number')
    } finally {
      await deleteTestUser(admin, fresh.id)
    }
  })
})
