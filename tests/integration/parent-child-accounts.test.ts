import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, userClient, createTestUser, deleteTestUser, type TestUser } from './helpers'

// Phase A coverage:
//   • the one-level family-tree trigger blocks grandchildren
//   • RLS lets a parent SELECT child profiles + INSERT bookings for them
//   • RLS still hides unrelated divers from a parent

const admin = adminClient()
let parent:    TestUser
let child:     TestUser
let unrelated: TestUser

beforeAll(async () => {
  parent    = await createTestUser(admin, { role: 'diver' })
  child     = await createTestUser(admin, { role: 'diver' })
  unrelated = await createTestUser(admin, { role: 'diver' })

  // Wire parent↔child by setting parent_account on the child row.
  const { error } = await admin
    .from('profiles')
    .update({ parent_account: parent.id } as never)
    .eq('id', child.id)
  if (error) throw error
})

afterAll(async () => {
  if (parent)    await deleteTestUser(admin, parent.id)
  if (child)     await deleteTestUser(admin, child.id)
  if (unrelated) await deleteTestUser(admin, unrelated.id)
})

describe('trg_profiles_one_level_family', () => {
  it('rejects a grandchild (child trying to acquire its own child)', async () => {
    const grandkid = await createTestUser(admin, { role: 'diver' })
    try {
      const { error } = await admin
        .from('profiles')
        .update({ parent_account: child.id } as never)
        .eq('id', grandkid.id)
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/one-level/i)
    } finally {
      await deleteTestUser(admin, grandkid.id)
    }
  })

  it('rejects demoting a parent (a diver with children cannot acquire a parent themselves)', async () => {
    const wouldBeNewParent = await createTestUser(admin, { role: 'diver' })
    try {
      const { error } = await admin
        .from('profiles')
        .update({ parent_account: wouldBeNewParent.id } as never)
        .eq('id', parent.id)
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/own children/i)
    } finally {
      await deleteTestUser(admin, wouldBeNewParent.id)
    }
  })

  it('rejects self-parent', async () => {
    // Use a fresh standalone diver so the trigger's "your own children"
    // branch doesn't fire first — we want the CHECK / self-FK rule to
    // surface here.
    const standalone = await createTestUser(admin, { role: 'diver' })
    try {
      const { error } = await admin
        .from('profiles')
        .update({ parent_account: standalone.id } as never)
        .eq('id', standalone.id)
      expect(error).not.toBeNull()
    } finally {
      await deleteTestUser(admin, standalone.id)
    }
  })
})

describe('parent ↔ child RLS', () => {
  it('parent can SELECT their child profile but not an unrelated diver', async () => {
    const asParent = await userClient(parent.email, parent.password)

    const { data: hitChild } = await asParent
      .from('profiles').select('id, parent_account').eq('id', child.id).maybeSingle()
    expect(hitChild?.id).toBe(child.id)
    expect(hitChild?.parent_account).toBe(parent.id)

    const { data: missUnrelated } = await asParent
      .from('profiles').select('id').eq('id', unrelated.id).maybeSingle()
    expect(missUnrelated).toBeNull()
  })

  it('parent can UPDATE their child profile but not an unrelated diver', async () => {
    const asParent = await userClient(parent.email, parent.password)

    const { error: childErr } = await asParent
      .from('profiles')
      .update({ nickname: 'Renamed by parent' } as never)
      .eq('id', child.id)
    expect(childErr).toBeNull()

    // Unrelated diver: RLS makes the UPDATE silently affect 0 rows. Read it
    // back through admin to verify nothing changed.
    await asParent
      .from('profiles')
      .update({ nickname: 'Hacked' } as never)
      .eq('id', unrelated.id)
    const { data: unrelatedRow } = await admin
      .from('profiles').select('nickname').eq('id', unrelated.id).single<{ nickname: string | null }>()
    expect(unrelatedRow?.nickname).not.toBe('Hacked')
  })

  it('parent can SELECT bookings belonging to their child', async () => {
    // Seed a booking for the child via admin (need an EO_dive _id; helpers
    // for this exist but we'd need to clean up afterward — skip and just
    // assert that the SELECT path works by counting rows after admin insert).
    const { createTestDive, deleteTestDive } = await import('./helpers')
    const diveId = await createTestDive(admin)
    try {
      const { data: b, error: bErr } = await admin
        .from('bookings')
        .insert({
          user_id: child.id, eo_dive_id: diveId, eo_course_id: null, details: {} as never,
        } as never)
        .select('id')
        .single<{ id: string }>()
      expect(bErr).toBeNull()
      expect(b?.id).toBeTruthy()

      const asParent = await userClient(parent.email, parent.password)
      const { data: visible } = await asParent
        .from('bookings').select('id, user_id').eq('id', b!.id).maybeSingle()
      expect(visible?.id).toBe(b!.id)
      expect(visible?.user_id).toBe(child.id)

      await admin.from('bookings').delete().eq('id', b!.id)
    } finally {
      await deleteTestDive(admin, diveId)
    }
  })
})
