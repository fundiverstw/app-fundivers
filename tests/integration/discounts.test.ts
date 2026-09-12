import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

// Discounts across their three moments: the shop defines one, an event offers
// it, a diver asks, an admin decides. The rule the whole feature rests on is
// that only the last step moves money -- everything before it is a claim.

const admin = adminClient()
let adminUser: TestUser
let staffUser: TestUser
let diver: TestUser
let stranger: TestUser
const diveIds: string[] = []
const discountIds: string[] = []

async function freshDive(): Promise<string> {
  const id = await createTestDive(admin)
  diveIds.push(id)
  return id
}

async function makeDiscount(
  over: { label?: string; kind?: 'percent' | 'fixed'; value?: number; active?: boolean } = {},
): Promise<string> {
  const { data, error } = await admin.from('discounts').insert({
    label: over.label ?? `Test discount ${Math.random().toString(36).slice(2, 8)}`,
    kind: over.kind ?? 'percent',
    value: over.value ?? 10,
    active: over.active ?? true,
  }).select('id').single()
  if (error) throw error
  discountIds.push(data.id)
  return data.id
}

/** An event offering `discountId`, and a booking on it for `userId`. */
async function bookingOn(
  userId: string,
  discountId: string | null,
  details: Record<string, unknown> = { total: 3000, deposit: 1000 },
): Promise<{ bookingId: string; eventId: string }> {
  const eventId = await freshDive()
  if (discountId) {
    const { error } = await admin.from('event_discounts')
      .insert({ event_id: eventId, discount_id: discountId })
    if (error) throw error
  }
  const { data, error } = await admin.from('bookings').insert({
    user_id: userId, event_id: eventId, status: 'pending', details,
  }).select('id').single()
  if (error) throw error
  return { bookingId: data.id, eventId }
}

async function amendmentsOn(bookingId: string): Promise<Array<{ amount: number; note: string }>> {
  const { data } = await admin.from('booking_amendments')
    .select('amount, note').eq('booking_id', bookingId)
  return (data ?? []) as Array<{ amount: number; note: string }>
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  staffUser = await createTestUser(admin, { role: 'staff' })
  diver     = await createTestUser(admin, { role: 'diver' })
  stranger  = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  for (const id of diveIds) await deleteTestDive(admin, id)
  // booking_discounts restricts the catalog row it points at, so the requests
  // have to go first -- deleting the event cascades the bookings under it,
  // which cascades those.
  for (const id of discountIds) await admin.from('discounts').delete().eq('id', id)
  for (const u of [adminUser, staffUser, diver, stranger]) {
    if (u) await deleteTestUser(admin, u.id)
  }
})

describe('discounts catalog', () => {
  it('is readable by any diver and writable only by an admin', async () => {
    await makeDiscount({ label: 'Readable discount' })
    const diverApi = await userClient(diver.email, diver.password)
    const read = await diverApi.from('discounts').select('id').limit(1)
    expect(read.error).toBeNull()

    const written = await diverApi.from('discounts')
      .insert({ label: 'Self-serve 100% off', kind: 'percent', value: 100 })
    expect(written.error).not.toBeNull()

    const staffApi = await userClient(staffUser.email, staffUser.password)
    const staffWrite = await staffApi.from('discounts')
      .insert({ label: 'Staff discount', kind: 'fixed', value: 100 })
    expect(staffWrite.error).not.toBeNull()

    const adminApi = await userClient(adminUser.email, adminUser.password)
    const adminWrite = await adminApi.from('discounts')
      .insert({ label: 'Admin discount', kind: 'fixed', value: 100 }).select('id').single()
    expect(adminWrite.error).toBeNull()
    if (adminWrite.data) discountIds.push(adminWrite.data.id)
  })

  it('refuses a percent outside 1..100 and a fixed amount of nothing', async () => {
    const tooMuch = await admin.from('discounts')
      .insert({ label: 'Free money', kind: 'percent', value: 101 })
    expect(tooMuch.error).not.toBeNull()
    const nothing = await admin.from('discounts')
      .insert({ label: 'Zero off', kind: 'fixed', value: 0 })
    expect(nothing.error).not.toBeNull()
  })
})

describe('requesting a discount', () => {
  it('lets the diver ask for one their event offers, and moves no money', async () => {
    const discountId = await makeDiscount({ kind: 'percent', value: 10 })
    const { bookingId } = await bookingOn(diver.id, discountId)

    const diverApi = await userClient(diver.email, diver.password)
    const { data, error } = await diverApi.rpc('request_booking_discount', {
      p_booking_id: bookingId, p_discount_id: discountId, p_note: 'student card attached',
    })
    expect(error).toBeNull()
    expect(data).toBeTruthy()

    const { data: row } = await admin.from('booking_discounts')
      .select('*').eq('id', data as string).single()
    expect(row?.status).toBe('requested')
    expect(row?.amount).toBeNull()
    expect(row?.amendment_id).toBeNull()
    expect(row?.requested_by).toBe(diver.id)
    // The claim is not the price: nothing has touched the ledger.
    expect(await amendmentsOn(bookingId)).toEqual([])
  })

  it('refuses a discount the event does not offer', async () => {
    const offered = await makeDiscount()
    const notOffered = await makeDiscount()
    const { bookingId } = await bookingOn(diver.id, offered)

    const diverApi = await userClient(diver.email, diver.password)
    const { error } = await diverApi.rpc('request_booking_discount', {
      p_booking_id: bookingId, p_discount_id: notOffered, p_note: null,
    })
    expect(error).not.toBeNull()
  })

  it('refuses a retired discount even where the event still offers it', async () => {
    const discountId = await makeDiscount()
    const { bookingId } = await bookingOn(diver.id, discountId)
    await admin.from('discounts').update({ active: false }).eq('id', discountId)

    const diverApi = await userClient(diver.email, diver.password)
    const { error } = await diverApi.rpc('request_booking_discount', {
      p_booking_id: bookingId, p_discount_id: discountId, p_note: null,
    })
    expect(error).not.toBeNull()
  })

  it("refuses someone else's booking", async () => {
    const discountId = await makeDiscount()
    const { bookingId } = await bookingOn(diver.id, discountId)

    const strangerApi = await userClient(stranger.email, stranger.password)
    const { error } = await strangerApi.rpc('request_booking_discount', {
      p_booking_id: bookingId, p_discount_id: discountId, p_note: null,
    })
    expect(error).not.toBeNull()
  })

  // The post-registration path: an admin applying a discount to one diver must
  // not have to change what the whole event is offered to reach them.
  it('lets an admin apply an active discount the event never offered', async () => {
    const discountId = await makeDiscount()
    const { bookingId } = await bookingOn(diver.id, null)

    const adminApi = await userClient(adminUser.email, adminUser.password)
    const { error } = await adminApi.rpc('request_booking_discount', {
      p_booking_id: bookingId, p_discount_id: discountId, p_note: 'agreed by phone',
    })
    expect(error).toBeNull()
  })

  it('refuses a second live request for the same discount, and allows one after a rejection', async () => {
    const discountId = await makeDiscount()
    const { bookingId } = await bookingOn(diver.id, discountId)
    const diverApi = await userClient(diver.email, diver.password)
    const adminApi = await userClient(adminUser.email, adminUser.password)

    const first = await diverApi.rpc('request_booking_discount', {
      p_booking_id: bookingId, p_discount_id: discountId, p_note: null,
    })
    expect(first.error).toBeNull()

    const again = await diverApi.rpc('request_booking_discount', {
      p_booking_id: bookingId, p_discount_id: discountId, p_note: null,
    })
    expect(again.error).not.toBeNull()

    await adminApi.rpc('decide_booking_discount', {
      p_request_id: first.data as string, p_approve: false, p_note: 'no card shown',
    })
    const third = await diverApi.rpc('request_booking_discount', {
      p_booking_id: bookingId, p_discount_id: discountId, p_note: 'card now attached',
    })
    expect(third.error).toBeNull()
  })

  it('refuses a cancelled booking', async () => {
    const discountId = await makeDiscount()
    const { bookingId } = await bookingOn(diver.id, discountId)
    await admin.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)

    const adminApi = await userClient(adminUser.email, adminUser.password)
    const { error } = await adminApi.rpc('request_booking_discount', {
      p_booking_id: bookingId, p_discount_id: discountId, p_note: null,
    })
    expect(error).not.toBeNull()
  })

  it('notifies every admin, and nobody else', async () => {
    const discountId = await makeDiscount({ label: 'Notified discount' })
    const { bookingId } = await bookingOn(diver.id, discountId)

    const diverApi = await userClient(diver.email, diver.password)
    const { data: requestId } = await diverApi.rpc('request_booking_discount', {
      p_booking_id: bookingId, p_discount_id: discountId, p_note: null,
    })
    expect(requestId).toBeTruthy()

    const { data: notes } = await admin.from('notifications')
      .select('user_id, title, body, url, kind')
      .eq('kind', 'discount_request')
      .eq('user_id', adminUser.id)
    const mine = (notes ?? []).filter(n => (n.body ?? '').includes('Notified discount'))
    expect(mine).toHaveLength(1)
    expect(mine[0].url).toBe('/admin/discounts')
    expect(mine[0].body).toContain('Test Dive')

    const { data: diverNotes } = await admin.from('notifications')
      .select('id').eq('kind', 'discount_request').eq('user_id', diver.id)
    expect(diverNotes ?? []).toHaveLength(0)
  })

  it('has no write policy at all — no client can insert or approve directly', async () => {
    const discountId = await makeDiscount()
    const { bookingId } = await bookingOn(diver.id, discountId)
    const diverApi = await userClient(diver.email, diver.password)
    const adminApi = await userClient(adminUser.email, adminUser.password)

    const diverInsert = await diverApi.from('booking_discounts')
      .insert({ booking_id: bookingId, discount_id: discountId, status: 'approved' })
    expect(diverInsert.error).not.toBeNull()

    // Even an admin has to go through the RPC: approving is what writes the
    // amendment, and a direct row would be an approval with no money behind it.
    const adminInsert = await adminApi.from('booking_discounts')
      .insert({ booking_id: bookingId, discount_id: discountId })
    expect(adminInsert.error).not.toBeNull()

    const { data: requestId } = await adminApi.rpc('request_booking_discount', {
      p_booking_id: bookingId, p_discount_id: discountId, p_note: null,
    })
    const selfApprove = await adminApi.from('booking_discounts')
      .update({ status: 'approved' }).eq('id', requestId as string)
    expect(selfApprove.error ?? { count: 0 }).toBeTruthy()
    const { data: after } = await admin.from('booking_discounts')
      .select('status').eq('id', requestId as string).single()
    expect(after?.status).toBe('requested')
  })
})

describe('deciding a discount', () => {
  async function openRequest(
    over: { kind?: 'percent' | 'fixed'; value?: number } = {},
    details: Record<string, unknown> = { total: 3000, deposit: 1000 },
  ) {
    const discountId = await makeDiscount(over)
    const { bookingId } = await bookingOn(diver.id, discountId, details)
    const diverApi = await userClient(diver.email, diver.password)
    const { data, error } = await diverApi.rpc('request_booking_discount', {
      p_booking_id: bookingId, p_discount_id: discountId, p_note: null,
    })
    if (error) throw error
    return { requestId: data as string, bookingId, discountId }
  }

  it('is refused to a diver and to staff', async () => {
    const { requestId } = await openRequest()
    const diverApi = await userClient(diver.email, diver.password)
    const staffApi = await userClient(staffUser.email, staffUser.password)

    expect((await diverApi.rpc('decide_booking_discount', {
      p_request_id: requestId, p_approve: true, p_note: null,
    })).error).not.toBeNull()
    expect((await staffApi.rpc('decide_booking_discount', {
      p_request_id: requestId, p_approve: true, p_note: null,
    })).error).not.toBeNull()
  })

  it('writes a negative amendment for a percent of the frozen total', async () => {
    const { requestId, bookingId } = await openRequest({ kind: 'percent', value: 10 })
    const adminApi = await userClient(adminUser.email, adminUser.password)

    const { data, error } = await adminApi.rpc('decide_booking_discount', {
      p_request_id: requestId, p_approve: true, p_note: null,
    })
    expect(error).toBeNull()
    expect(Number(data)).toBe(300)

    const rows = await amendmentsOn(bookingId)
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(-300)
    // The note a diver reads is the shop's own wording for the discount.
    expect(rows[0].note).toContain('(10%)')

    const { data: row } = await admin.from('booking_discounts')
      .select('*').eq('id', requestId).single()
    expect(row?.status).toBe('approved')
    expect(row?.amount).toBe(300)
    expect(row?.amendment_id).toBeTruthy()
    expect(row?.decided_by).toBe(adminUser.id)
  })

  it('clamps a fixed discount to what the booking still owes', async () => {
    const { requestId, bookingId } = await openRequest(
      { kind: 'fixed', value: 5000 }, { total: 3000, deposit: 1000 },
    )
    const adminApi = await userClient(adminUser.email, adminUser.password)
    const { data } = await adminApi.rpc('decide_booking_discount', {
      p_request_id: requestId, p_approve: true, p_note: null,
    })
    // Never past zero: handing money back is a credit, decided deliberately.
    expect(Number(data)).toBe(3000)
    expect((await amendmentsOn(bookingId))[0].amount).toBe(-3000)
  })

  it('rejects without touching the ledger, and cannot be decided twice', async () => {
    const { requestId, bookingId } = await openRequest()
    const adminApi = await userClient(adminUser.email, adminUser.password)

    const { data, error } = await adminApi.rpc('decide_booking_discount', {
      p_request_id: requestId, p_approve: false, p_note: 'no proof',
    })
    expect(error).toBeNull()
    expect(Number(data)).toBe(0)
    expect(await amendmentsOn(bookingId)).toEqual([])

    const { data: row } = await admin.from('booking_discounts')
      .select('status, note, decided_at').eq('id', requestId).single()
    expect(row?.status).toBe('rejected')
    expect(row?.note).toBe('no proof')
    expect(row?.decided_at).toBeTruthy()

    const again = await adminApi.rpc('decide_booking_discount', {
      p_request_id: requestId, p_approve: true, p_note: null,
    })
    expect(again.error).not.toBeNull()
  })

  it('refuses to approve onto a booking cancelled since the request', async () => {
    const { requestId, bookingId } = await openRequest()
    await admin.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
    const adminApi = await userClient(adminUser.email, adminUser.password)
    const { error } = await adminApi.rpc('decide_booking_discount', {
      p_request_id: requestId, p_approve: true, p_note: null,
    })
    expect(error).not.toBeNull()
  })

  // A discount lowers what is owed, which can cover the deposit for the first
  // time. Without the promotion the diver holds a spot the shop reads as
  // unconfirmed forever -- there is no later payment to trigger it.
  it('confirms a pending booking whose deposit the discount now covers', async () => {
    const { requestId, bookingId } = await openRequest(
      { kind: 'fixed', value: 2500 }, { total: 3000, deposit: 1000 },
    )
    const { error: payErr } = await admin.from('payments').insert({
      user_id: diver.id, booking_id: bookingId, amount: 500,
      status: 'paid', method: 'cash', reference: 'receipt-1',
    })
    expect(payErr).toBeNull()

    const adminApi = await userClient(adminUser.email, adminUser.password)
    const { error } = await adminApi.rpc('decide_booking_discount', {
      p_request_id: requestId, p_approve: true, p_note: null,
    })
    expect(error).toBeNull()

    const { data: booking } = await admin.from('bookings')
      .select('status').eq('id', bookingId).single()
    expect(booking?.status).toBe('confirmed')
  })

  // The admin header badge counts these with an embedded filter, and the queue
  // it links to drops cancelled bookings. If the two ever disagree the badge
  // points at a decision nobody can make -- decide_booking_discount refuses a
  // cancelled booking outright.
  it('is not counted by the header badge once its booking is cancelled', async () => {
    const { bookingId } = await openRequest()
    const adminApi = await userClient(adminUser.email, adminUser.password)

    const countOpen = async () => {
      const { count, error } = await adminApi
        .from('booking_discounts')
        .select('id, bookings!inner(status)', { count: 'exact', head: true })
        .eq('status', 'requested')
        .neq('bookings.status', 'cancelled')
      expect(error).toBeNull()
      return count ?? 0
    }

    const before = await countOpen()
    expect(before).toBeGreaterThan(0)
    await admin.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
    expect(await countOpen()).toBe(before - 1)
  })

  it('tells the diver, and lets them read their own request', async () => {
    const { requestId, bookingId } = await openRequest()
    const adminApi = await userClient(adminUser.email, adminUser.password)
    await adminApi.rpc('decide_booking_discount', {
      p_request_id: requestId, p_approve: true, p_note: null,
    })

    const { data: notes } = await admin.from('notifications')
      .select('title, url, kind').eq('user_id', diver.id).eq('kind', 'discount')
    expect(notes?.length).toBeGreaterThan(0)
    expect(notes?.[0].url).toBe('/records/payments')

    const diverApi = await userClient(diver.email, diver.password)
    const { data: own } = await diverApi.from('booking_discounts')
      .select('id, status').eq('booking_id', bookingId)
    expect(own?.map(r => r.status)).toContain('approved')

    const strangerApi = await userClient(stranger.email, stranger.password)
    const { data: theirs } = await strangerApi.from('booking_discounts')
      .select('id').eq('booking_id', bookingId)
    expect(theirs ?? []).toHaveLength(0)
  })
})
