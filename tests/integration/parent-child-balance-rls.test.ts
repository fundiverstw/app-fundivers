import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

// A parent must see every input to their child's balance, not just some.
//
// The diver-facing balance is `details.total + amendments - payments - credits`.
// `bookings` and `payments` had parent-select policies from the start;
// `booking_amendments` and `credits` did not, so a parent saw the child's
// undiscounted total and the payments against it, but zero discount rows and
// zero credit rows. Both silently summed to 0 and the parent was shown a
// balance higher than the child owed — with nothing wrong in the app code,
// which was asking for rows RLS would never return.
//
// These run against the live local stack precisely because that is the only
// way to exercise RLS; a mocked client would have happily returned the rows.

const admin = adminClient()
let parent: TestUser
let child: TestUser
let unrelated: TestUser
let bookingId: string
const cleanupDives: string[] = []
const cleanupUsers: string[] = []

beforeAll(async () => {
  parent    = await createTestUser(admin, { role: 'diver' })
  child     = await createTestUser(admin, { role: 'diver' })
  unrelated = await createTestUser(admin, { role: 'diver' })
  cleanupUsers.push(parent.id, child.id, unrelated.id)

  const { error: linkErr } = await admin
    .from('profiles')
    .update({ parent_account: parent.id } as never)
    .eq('id', child.id)
  if (linkErr) throw linkErr

  const dive = await createTestDive(admin)
  cleanupDives.push(dive)

  const { data: booking, error: bErr } = await admin.from('bookings').insert({
    user_id: child.id, event_id: dive, status: 'confirmed', details: { total: 3000 },
  }).select('id').single()
  if (bErr) throw bErr
  bookingId = booking.id

  // The four balance inputs: a total (above), a payment, a discount, a credit.
  const { error: payErr } = await admin.from('payments').insert({
    booking_id: bookingId, user_id: child.id, amount: 1000, status: 'paid', method: 'cash',
  })
  if (payErr) throw payErr

  const { error: amdErr } = await admin.from('booking_amendments').insert({
    booking_id: bookingId, amount: -500, note: 'Loyalty discount', created_by: parent.id,
  })
  if (amdErr) throw amdErr

  const { error: crErr } = await admin.from('credits').insert({
    user_id: child.id, booking_id: bookingId, amount: 200, status: 'open', reason: 'goodwill',
  })
  if (crErr) throw crErr
})

afterAll(async () => {
  for (const id of cleanupDives) await deleteTestDive(admin, id)
  for (const id of cleanupUsers) await deleteTestUser(admin, id)
})

describe('parent reads every input to a child booking balance', () => {
  it('sees the discount on a child booking', async () => {
    // The reported bug: this returned zero rows, so the discount was dropped
    // from the balance the parent was shown.
    const db = await userClient(parent.email, parent.password)
    const { data, error } = await db
      .from('booking_amendments').select('amount').eq('booking_id', bookingId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].amount).toBe(-500)
  })

  it('sees the open credit on a child booking', async () => {
    const db = await userClient(parent.email, parent.password)
    const { data, error } = await db
      .from('credits').select('amount').eq('booking_id', bookingId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].amount).toBe(200)
  })

  it('sees the booking and its payments, as it always did', async () => {
    const db = await userClient(parent.email, parent.password)
    const [bookings, payments] = await Promise.all([
      db.from('bookings').select('id').eq('id', bookingId),
      db.from('payments').select('amount').eq('booking_id', bookingId),
    ])
    expect(bookings.data).toHaveLength(1)
    expect(payments.data).toHaveLength(1)
  })

  it('can compute the same balance the shop charges', async () => {
    // The whole point: every input present means the arithmetic lands on the
    // real figure. 3000 total − 500 discount − 1000 paid − 200 credit = 1300.
    const db = await userClient(parent.email, parent.password)
    const [bookings, amendments, payments, credits] = await Promise.all([
      db.from('bookings').select('details').eq('id', bookingId),
      db.from('booking_amendments').select('amount').eq('booking_id', bookingId),
      db.from('payments').select('amount, status').eq('booking_id', bookingId),
      db.from('credits').select('amount').eq('booking_id', bookingId).eq('status', 'open'),
    ])
    const total = Number((bookings.data![0].details as { total?: number }).total ?? 0)
    const delta = (amendments.data ?? []).reduce((s, a) => s + a.amount, 0)
    const paid = (payments.data ?? []).reduce((s, p) => s + (p.status === 'paid' ? p.amount : 0), 0)
    const credit = (credits.data ?? []).reduce((s, c) => s + c.amount, 0)
    expect(total + delta - paid - credit).toBe(1300)
  })

  it('the child still sees their own rows', async () => {
    const db = await userClient(child.email, child.password)
    const [amendments, credits] = await Promise.all([
      db.from('booking_amendments').select('amount').eq('booking_id', bookingId),
      db.from('credits').select('amount').eq('booking_id', bookingId),
    ])
    expect(amendments.data).toHaveLength(1)
    expect(credits.data).toHaveLength(1)
  })

  it('an unrelated diver sees none of it', async () => {
    // Widening the policy must not widen it past the parent.
    const db = await userClient(unrelated.email, unrelated.password)
    const [bookings, amendments, credits, payments] = await Promise.all([
      db.from('bookings').select('id').eq('id', bookingId),
      db.from('booking_amendments').select('amount').eq('booking_id', bookingId),
      db.from('credits').select('amount').eq('booking_id', bookingId),
      db.from('payments').select('amount').eq('booking_id', bookingId),
    ])
    expect(bookings.data).toHaveLength(0)
    expect(amendments.data).toHaveLength(0)
    expect(credits.data).toHaveLength(0)
    expect(payments.data).toHaveLength(0)
  })

  it('a parent cannot write an amendment — reading is not authoring', async () => {
    const db = await userClient(parent.email, parent.password)
    const { error } = await db.from('booking_amendments').insert({
      booking_id: bookingId, amount: -9999, note: 'self-serve discount', created_by: parent.id,
    })
    expect(error).not.toBeNull()
  })
})
