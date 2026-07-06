import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

// Pins the manual-verification gate from migration
// 20260501100000_profile_status.sql:
//
//   - New profiles default to status='pending' (the trigger lets the column
//     default fill in).
//   - is_active_user() returns true only when the caller's profile is active.
//   - bookings + push_subscriptions inserts under a user JWT require
//     is_active_user(); pending users get blocked. Service-role bypass is
//     unaffected (covered by the create-registration flow elsewhere).

const admin = adminClient()
let pendingUser: TestUser
let activeUser:  TestUser
let diveId:      string

beforeAll(async () => {
  // createTestUser defaults to active; pin status explicitly here so the
  // intent of each fixture is obvious from the call site.
  pendingUser = await createTestUser(admin, { status: 'pending' })
  activeUser  = await createTestUser(admin, { status: 'active' })
  diveId      = await createTestDive(admin)
})

afterAll(async () => {
  if (diveId)      await deleteTestDive(admin, diveId)
  if (pendingUser) await deleteTestUser(admin, pendingUser.id)
  if (activeUser)  await deleteTestUser(admin, activeUser.id)
})

describe('profiles.status defaults', () => {
  it('handle_new_user trigger creates profiles as pending', async () => {
    const { data: user } = await admin.auth.admin.createUser({
      email: `pending_default_${Math.random().toString(36).slice(2, 8)}@example.test`,
      password: 'test-password-123',
      email_confirm: true,
    })
    const id = user.user!.id
    try {
      const { data } = await admin.from('profiles').select('status').eq('id', id).single()
      expect(data?.status).toBe('pending')
    } finally {
      await admin.auth.admin.deleteUser(id)
    }
  })

  it('check constraint rejects unknown status values', async () => {
    const { error } = await admin
      .from('profiles')
      .update({ status: 'banned' as never })
      .eq('id', activeUser.id)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/check constraint|profiles_status_check/i)
  })
})

describe('bookings RLS — is_active_user() gate', () => {
  it('pending user cannot insert a booking under their own JWT', async () => {
    const sb = await userClient(pendingUser.email, pendingUser.password)
    const { error } = await sb.from('bookings').insert({
      user_id: pendingUser.id, event_id: diveId, status: 'pending', details: {},
    })
    expect(error).not.toBeNull()
  })

  it('active user can insert a booking under their own JWT', async () => {
    const sb = await userClient(activeUser.email, activeUser.password)
    const ins = await sb.from('bookings').insert({
      user_id: activeUser.id, event_id: diveId, status: 'pending', details: {},
    }).select().single()
    expect(ins.error).toBeNull()
    expect(ins.data?.user_id).toBe(activeUser.id)
  })

  it('flipping status pending → active unblocks the same user', async () => {
    // Use a fresh pending user so the unique (user, dive) index doesn't
    // conflict with the booking just inserted by activeUser above.
    const u = await createTestUser(admin, { status: 'pending' })
    try {
      const sb = await userClient(u.email, u.password)
      const blocked = await sb.from('bookings').insert({
        user_id: u.id, event_id: diveId, status: 'pending', details: {},
      })
      expect(blocked.error).not.toBeNull()

      await admin.from('profiles').update({ status: 'active' }).eq('id', u.id)

      const ok = await sb.from('bookings').insert({
        user_id: u.id, event_id: diveId, status: 'pending', details: {},
      }).select().single()
      expect(ok.error).toBeNull()
    } finally {
      await deleteTestUser(admin, u.id)
    }
  })
})

describe('push_subscriptions RLS — is_active_user() gate', () => {
  it('pending user cannot insert their own subscription', async () => {
    const sb = await userClient(pendingUser.email, pendingUser.password)
    const { error } = await sb.from('push_subscriptions').insert({
      user_id:  pendingUser.id,
      endpoint: `https://example.invalid/push/${pendingUser.id}`,
      p256dh:   'p',
      auth:     'a',
    })
    expect(error).not.toBeNull()
  })

  it('active user can insert their own subscription', async () => {
    const sb = await userClient(activeUser.email, activeUser.password)
    const { error } = await sb.from('push_subscriptions').insert({
      user_id:  activeUser.id,
      endpoint: `https://example.invalid/push/${activeUser.id}`,
      p256dh:   'p',
      auth:     'a',
    })
    expect(error).toBeNull()
  })
})
