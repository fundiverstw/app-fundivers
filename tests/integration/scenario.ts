import { adminClient, createTestUser, createTestDive, deleteTestUser, deleteTestDive, type TestUser } from './helpers'
import type { SupabaseClient } from '@supabase/supabase-js'

type DB = SupabaseClient

// A booking driven through its real transitions, not assembled at its end state.
//
// Most of this suite inserts a row already in its final shape — 40 bookings go
// in at status 'pending', 19 at 'cancelled' — and then asserts one derived
// value. That catches a function that is wrong on its own, and misses every bug
// that lives in the seam BETWEEN steps. Which is where they have all actually
// been: discount-then-pay, refund-then-apply-credit,
// cancel-event-then-cancel-booking-then-accept-offer. Each function was correct
// in isolation; the order of operations was not.
//
// So: express a scenario as the sequence a shop actually performs, and let the
// database do what it really does at each step — triggers, RPCs and all.
//
//   const s = await scenario().booking({ total: 3000, deposit: 3000 })
//   await s.discount(-400)
//   await s.pay(2600)
//   expect(await s.balance()).toBe(0)
//
// Register cleanup with `track()` so the caller's afterAll can tear it down.

export interface ScenarioCleanup {
  users: string[]
  dives: string[]
}

export class BookingScenario {
  readonly admin: DB
  readonly cleanup: ScenarioCleanup
  diver!: TestUser
  adminUser!: TestUser
  eventId!: string
  bookingId!: string

  constructor(admin: DB, cleanup: ScenarioCleanup) {
    this.admin = admin
    this.cleanup = cleanup
  }

  /** Create the diver, the event and the booking. Everything else builds on this. */
  async booking(
    details: { total?: number; deposit?: number } = {},
    status: 'pending' | 'confirmed' | 'waitlisted' = 'confirmed',
  ): Promise<this> {
    this.diver = await createTestUser(this.admin, { role: 'diver' })
    this.adminUser = await createTestUser(this.admin, { role: 'admin' })
    this.cleanup.users.push(this.diver.id, this.adminUser.id)
    this.eventId = await createTestDive(this.admin)
    this.cleanup.dives.push(this.eventId)

    const { data, error } = await this.admin.from('bookings').insert({
      user_id: this.diver.id, event_id: this.eventId, status, details,
    } as never).select('id').single<{ id: string }>()
    if (error) throw new Error(`scenario.booking: ${error.message}`)
    this.bookingId = data!.id
    return this
  }

  /** An admin adjustment. Negative discounts, positive surcharges. */
  async amend(amount: number, note = 'adjustment'): Promise<this> {
    const { error } = await this.admin.from('booking_amendments').insert({
      booking_id: this.bookingId, amount, note, created_by: this.adminUser.id,
    } as never)
    if (error) throw new Error(`scenario.amend: ${error.message}`)
    return this
  }

  discount(amount: number, note = 'discount') { return this.amend(-Math.abs(amount), note) }
  surcharge(amount: number, note = 'surcharge') { return this.amend(Math.abs(amount), note) }

  async pay(amount: number, method = 'cash'): Promise<this> {
    const { error } = await this.admin.from('payments').insert({
      booking_id: this.bookingId, user_id: this.diver.id,
      amount, status: 'paid', method,
    } as never)
    if (error) throw new Error(`scenario.pay: ${error.message}`)
    return this
  }

  /** A refund is its own row, exactly as the app records one. */
  async refund(amount: number, method = 'cash'): Promise<this> {
    const { error } = await this.admin.from('payments').insert({
      booking_id: this.bookingId, user_id: this.diver.id,
      amount, status: 'refunded', method,
    } as never)
    if (error) throw new Error(`scenario.refund: ${error.message}`)
    return this
  }

  /** Award credit. Tied to this booking by default; pass null for a general pool. */
  async awardCredit(amount: number, tied: 'this' | 'general' = 'this'): Promise<this> {
    const { error } = await this.admin.from('credits').insert({
      user_id: this.diver.id,
      booking_id: tied === 'this' ? this.bookingId : null,
      amount, status: 'open', reason: 'scenario credit', created_by: this.adminUser.id,
    } as never)
    if (error) throw new Error(`scenario.awardCredit: ${error.message}`)
    return this
  }

  async setStatus(status: 'pending' | 'confirmed' | 'waitlisted' | 'cancelled'): Promise<this> {
    const { error } = await this.admin.from('bookings').update({ status } as never).eq('id', this.bookingId)
    if (error) throw new Error(`scenario.setStatus: ${error.message}`)
    return this
  }

  async cancelEvent(): Promise<this> {
    const { error } = await this.admin.from('events' as never)
      .update({ cancelled_at: new Date().toISOString() } as never).eq('id', this.eventId)
    if (error) throw new Error(`scenario.cancelEvent: ${error.message}`)
    return this
  }

  // ---- readbacks, as the app computes them -------------------------------

  async rows() {
    const [booking, amendments, payments, credits] = await Promise.all([
      this.admin.from('bookings').select('status, details').eq('id', this.bookingId).single(),
      this.admin.from('booking_amendments').select('amount').eq('booking_id', this.bookingId),
      this.admin.from('payments').select('amount, status').eq('booking_id', this.bookingId),
      this.admin.from('credits').select('amount, status, booking_id').eq('user_id', this.diver.id),
    ])
    return {
      status: (booking.data as { status: string }).status,
      details: (booking.data as { details: { total?: number; deposit?: number } }).details ?? {},
      amendments: amendments.data ?? [],
      payments: payments.data ?? [],
      credits: credits.data ?? [],
    }
  }

  /** owed / paid / credit / net, by the same rules as src/lib. */
  async figures() {
    const r = await this.rows()
    const owed = Number(r.details.total ?? 0) + r.amendments.reduce((s, a) => s + Number(a.amount), 0)
    const paid = r.payments.reduce(
      (s, p) => s + (p.status === 'paid' ? Number(p.amount) : p.status === 'refunded' ? -Number(p.amount) : 0), 0)
    const credit = r.credits
      .filter(c => c.status === 'open' && c.booking_id === this.bookingId)
      .reduce((s, c) => s + Number(c.amount), 0)
    const deposit = Number(r.details.deposit ?? 0)
    return {
      status: r.status, owed, paid, credit, deposit,
      net: r.status === 'cancelled' ? 0 : owed - paid - credit,
      depositDue: r.status === 'cancelled' ? 0 : Math.max(0, Math.min(deposit, owed) - paid),
    }
  }

  async balance(): Promise<number> { return (await this.figures()).net }

  /** Spend the diver's general credit pool against this booking, via the RPC. */
  async applyCredit(amount: number, as: 'diver' | 'admin' = 'diver'): Promise<number> {
    const { userClient } = await import('./helpers')
    const who = as === 'diver' ? this.diver : this.adminUser
    const db = await userClient(who.email, who.password)
    const { data, error } = await db.rpc('apply_credit_to_booking', {
      p_booking_id: this.bookingId, p_amount: amount,
    })
    if (error) throw new Error(`scenario.applyCredit: ${error.message}`)
    return Number(data)
  }
}

export function scenario(cleanup: ScenarioCleanup, admin: DB = adminClient()) {
  return new BookingScenario(admin, cleanup)
}

/** Fresh cleanup ledger; hand it to afterAll. */
export function tracker(): ScenarioCleanup {
  return { users: [], dives: [] }
}

export async function teardown(cleanup: ScenarioCleanup, admin: DB = adminClient()) {
  for (const id of cleanup.dives) await deleteTestDive(admin, id)
  for (const id of cleanup.users) await deleteTestUser(admin, id)
}
