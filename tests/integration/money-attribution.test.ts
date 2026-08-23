// Three schema guarantees behind "who did what, and against what receipt".
//
// A payment that moved real money names the transaction it came from; a
// cancelled booking names the session that cancelled it; a settled credit
// names the session that closed it. All three are enforced by the database
// rather than by the callers, because each has several call sites -- an admin
// form, an RPC, a trigger -- and a rule living in only one of them is a rule
// the others will drift away from.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient, createTestUser, deleteTestUser,
  createTestDive, deleteTestDive, type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser
const cleanupUsers: string[] = []
const cleanupDives: string[] = []

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver = await createTestUser(admin, { role: 'diver' })
  cleanupUsers.push(adminUser.id, diver.id)
})

afterAll(async () => {
  for (const id of cleanupUsers) await deleteTestUser(admin, id)
  for (const id of cleanupDives) await deleteTestDive(admin, id)
})

// A unique index allows one live booking per diver per event, so every case
// gets its own dive rather than sharing one.
async function freshBooking(status = 'confirmed'): Promise<string> {
  const eventId = await createTestDive(admin)
  cleanupDives.push(eventId)
  const { data, error } = await admin.from('bookings').insert({
    user_id: diver.id, event_id: eventId, status,
    details: { total: 5000, deposit: 2000 },
  } as never).select('id').single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

describe('payments_reference_required', () => {
  it('refuses a paid row that names no receipt or transaction', async () => {
    const b = await freshBooking()
    const { error } = await admin.from('payments').insert({
      user_id: diver.id, booking_id: b, amount: 2000, status: 'paid', method: 'bank_transfer',
    } as never)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/payments_reference_required/)
  })

  it('refuses whitespace dressed up as a reference', async () => {
    const b = await freshBooking()
    const { error } = await admin.from('payments').insert({
      user_id: diver.id, booking_id: b, amount: 2000, status: 'paid',
      method: 'cash', reference: '   ',
    } as never)
    expect(error).not.toBeNull()
  })

  it('refuses a refund with no reference — the movement most likely to be queried', async () => {
    const b = await freshBooking()
    const { error } = await admin.from('payments').insert({
      user_id: diver.id, booking_id: b, amount: 500, status: 'refunded', method: 'cash',
    } as never)
    expect(error).not.toBeNull()
  })

  it('accepts a paid row that names one', async () => {
    const b = await freshBooking()
    const { error } = await admin.from('payments').insert({
      user_id: diver.id, booking_id: b, amount: 2000, status: 'paid',
      method: 'bank_transfer', reference: 'TW-BANK-4417',
    } as never)
    expect(error).toBeNull()
  })

  // Applying store credit writes a paid row so the booking's balance clears,
  // but nothing arrives at the shop -- the cash came in earlier, on whatever
  // booking generated the credit. There is no transaction to point at.
  it('exempts account_credit rows, which move no money', async () => {
    const b = await freshBooking()
    const { error } = await admin.from('payments').insert({
      user_id: diver.id, booking_id: b, amount: 2000, status: 'paid', method: 'account_credit',
    } as never)
    expect(error).toBeNull()
  })

  it('exempts a pending row — a promise is not a receipt', async () => {
    const b = await freshBooking()
    const { error } = await admin.from('payments').insert({
      user_id: diver.id, booking_id: b, amount: 2000, status: 'pending', method: 'cash',
    } as never)
    expect(error).toBeNull()
  })

  // Voiding is an admin taking back their own mistake. Demanding a reference
  // to undo one would leave the mistake standing.
  it('lets a referenced payment be voided', async () => {
    const b = await freshBooking()
    const { data } = await admin.from('payments').insert({
      user_id: diver.id, booking_id: b, amount: 2000, status: 'paid',
      method: 'cash', reference: 'CASH-1',
    } as never).select('id').single()
    const { error } = await admin.from('payments')
      .update({ status: 'voided' }).eq('id', (data as { id: string }).id)
    expect(error).toBeNull()
  })
})

describe('record_group_payment', () => {
  it('refuses a blank reference rather than writing unreferenced rows', async () => {
    const asAdmin = await userClient(adminUser.email, adminUser.password)
    const { error } = await asAdmin.rpc('record_group_payment', {
      p_lead: diver.id, p_amount: 1000, p_reference: '  ',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/reference/i)
  })
})

describe('bookings cancellation stamp', () => {
  async function read(id: string) {
    const { data } = await admin.from('bookings')
      .select('status, cancelled_at, cancelled_by').eq('id', id).single()
    return data as { status: string; cancelled_at: string | null; cancelled_by: string | null }
  }

  it('is empty while the booking stands', async () => {
    expect(await read(await freshBooking())).toMatchObject({ cancelled_at: null, cancelled_by: null })
  })

  it('stamps the session that cancelled it', async () => {
    const b = await freshBooking()
    const asAdmin = await userClient(adminUser.email, adminUser.password)
    const { error } = await asAdmin.from('bookings').update({ status: 'cancelled' }).eq('id', b)
    expect(error).toBeNull()
    const row = await read(b)
    expect(row.cancelled_by).toBe(adminUser.id)
    expect(row.cancelled_at).not.toBeNull()
  })

  it('names the diver when the diver cancels their own spot', async () => {
    const b = await freshBooking('pending')
    const asDiver = await userClient(diver.email, diver.password)
    const { error } = await asDiver.from('bookings').update({ status: 'cancelled' }).eq('id', b)
    expect(error).toBeNull()
    expect((await read(b)).cancelled_by).toBe(diver.id)
  })

  it('clears the stamp when the booking is restored — it is not cancelled any more', async () => {
    const b = await freshBooking()
    await admin.from('bookings').update({ status: 'cancelled' }).eq('id', b)
    await admin.from('bookings').update({ status: 'confirmed' }).eq('id', b)
    expect(await read(b)).toMatchObject({ cancelled_at: null, cancelled_by: null })
  })

  // The stamp records a past act. An unrelated later edit must not move it,
  // and must not let anyone write a different name into it.
  it('holds its value through an unrelated edit, and cannot be forged', async () => {
    const b = await freshBooking()
    const asAdmin = await userClient(adminUser.email, adminUser.password)
    await asAdmin.from('bookings').update({ status: 'cancelled' }).eq('id', b)
    const before = await read(b)

    await admin.from('bookings').update({
      notes: 'later edit', cancelled_by: diver.id, cancelled_at: '2020-01-01T00:00:00Z',
    } as never).eq('id', b)

    expect(await read(b)).toMatchObject({
      cancelled_by: before.cancelled_by, cancelled_at: before.cancelled_at,
    })
  })
})

describe('credits settled_by stamp', () => {
  async function makeCredit(): Promise<string> {
    const { data, error } = await admin.from('credits').insert({
      user_id: diver.id, amount: 1000, currency: 'TWD',
      reason: 'test credit', status: 'open', created_by: adminUser.id, source: 'manual',
    } as never).select('id').single()
    if (error) throw new Error(error.message)
    return (data as { id: string }).id
  }

  async function read(id: string) {
    const { data } = await admin.from('credits').select('status, settled_by').eq('id', id).single()
    return data as { status: string; settled_by: string | null }
  }

  it('names the session that closed the credit', async () => {
    const c = await makeCredit()
    const asAdmin = await userClient(adminUser.email, adminUser.password)
    const { error } = await asAdmin.from('credits')
      .update({ status: 'settled', settled_at: new Date().toISOString(), settled_note: 'paid out' })
      .eq('id', c)
    expect(error).toBeNull()
    expect((await read(c)).settled_by).toBe(adminUser.id)
  })

  it('clears it when the credit is re-opened — nobody settled an open credit', async () => {
    const c = await makeCredit()
    const asAdmin = await userClient(adminUser.email, adminUser.password)
    await asAdmin.from('credits')
      .update({ status: 'settled', settled_at: new Date().toISOString() }).eq('id', c)
    await asAdmin.from('credits')
      .update({ status: 'open', settled_at: null, settled_note: null }).eq('id', c)
    expect(await read(c)).toMatchObject({ status: 'open', settled_by: null })
  })

  it('cannot be reassigned to someone else after the fact', async () => {
    const c = await makeCredit()
    const asAdmin = await userClient(adminUser.email, adminUser.password)
    await asAdmin.from('credits')
      .update({ status: 'settled', settled_at: new Date().toISOString() }).eq('id', c)
    await admin.from('credits').update({ settled_by: diver.id } as never).eq('id', c)
    expect((await read(c)).settled_by).toBe(adminUser.id)
  })
})
