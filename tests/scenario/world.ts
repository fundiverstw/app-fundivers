import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser, deleteTestDive,
  type TestUser,
} from '../integration/helpers'
import type { SupabaseClient } from '@supabase/supabase-js'

type DB = SupabaseClient

// The shop, as a sequence of things it actually does.
//
// The integration suite pins one rule per test: this constraint fires, that
// policy refuses, this RPC records the server's version. That is the right shape
// for a rule, and it is blind to the seam BETWEEN rules — which is where the
// bugs have been. A cancellation that commits but whose credits fail. A series
// whose later occurrences keep the template's cancellation deadline. A diver
// whose account exists but whose terms consent never got recorded.
//
// So a scenario walks a whole journey with the real database doing real work at
// every step — triggers, RPCs, RLS, the lot — and asserts what the shop would
// see afterwards. tests/integration/scenario.ts already does this for a
// booking's money; this is the same idea widened to the features around it.
//
// Every id created goes in the ledger so one afterAll tears the whole world
// down, whatever order the steps ran in.

export interface Ledger {
  users: string[]
  events: string[]
  series: string[]
  waivers: string[]
  vehicles: string[]
}

export function ledger(): Ledger {
  return { users: [], events: [], series: [], waivers: [], vehicles: [] }
}

export async function teardownWorld(l: Ledger, admin: DB = adminClient()) {
  // Children first, then the rows they point at, then the accounts. Bookings and
  // payments cascade from events; availability and duties cascade from profiles.
  for (const id of l.series) {
    await admin.from('events').update({ series_id: null } as never).eq('series_id', id)
    await admin.from('event_series').delete().eq('id', id)
  }
  // Events before vehicles: deleting an event cascades its event_vehicles rows,
  // and a lingering allocation would block the vehicle delete.
  for (const id of l.events) await deleteTestDive(admin, id)
  for (const id of l.vehicles) await admin.from('vehicles').delete().eq('id', id)
  for (const code of l.waivers) await admin.from('waivers').delete().eq('code', code)
  for (const id of l.users) await deleteTestUser(admin, id)
}

/** A shop with an admin, used as the actor for anything admin-gated. */
export class World {
  readonly admin: DB
  readonly ledger: Ledger
  adminUser!: TestUser

  constructor(admin: DB, l: Ledger) {
    this.admin = admin
    this.ledger = l
  }

  async open(): Promise<this> {
    this.adminUser = await this.person('admin')
    return this
  }

  /** An account of any role, tracked for teardown. */
  async person(role: 'diver' | 'staff' | 'admin'): Promise<TestUser> {
    const user = await createTestUser(this.admin, { role })
    this.ledger.users.push(user.id)
    return user
  }

  /** That person's own client, so RLS applies as it would in the browser. */
  as(user: TestUser): Promise<DB> {
    return userClient(user.email, user.password)
  }

  anon(): DB { return anonClient() }

  // ── events ────────────────────────────────────────────────────────────────

  /** A dive `inDays` from today. Defaults mirror createTestDive. */
  async dive(over: Record<string, unknown> = {}, inDays = 7): Promise<string> {
    const day = this.dayFromNow(inDays)
    const { data, error } = await this.admin.from('events').insert({
      kind: 'dive', admin_title: 'Scenario dive', notes: '',
      start_date: day, end_date: day, start_time: '09:00:00',
      ...over,
    } as never).select('id').single()
    if (error) throw new Error(`world.dive: ${error.message}`)
    const id = (data as { id: string }).id
    this.ledger.events.push(id)
    return id
  }

  /**
   * A recurrence batch through the real RPC, so the scenario exercises the same
   * single-transaction path the admin UI uses.
   */
  async series(args: {
    count: number
    inDays?: number
    everyDays?: number
    event?: Record<string, unknown>
  }): Promise<{ seriesId: string; eventIds: string[]; dates: string[] }> {
    const { count, inDays = 7, everyDays = 7, event = {} } = args
    const dates = Array.from({ length: count }, (_, i) => this.dayFromNow(inDays + i * everyDays))
    const { data, error } = await this.admin.rpc('create_events_with_relations', {
      p_events: dates.map(day => ({
        kind: 'dive', admin_title: 'Scenario series dive', notes: '',
        start_date: day, end_date: day, start_time: '09:00:00',
        fully_booked: false, featured: false, is_private: false, has_transport: true,
        is_boat_dive: false, is_trip: false, nitrox_required: false,
        ...event,
      })),
      p_series: { kind: 'dive', freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5, 6, 7], label: 'Scenario series' },
      p_created_by: this.adminUser.id,
    })
    if (error) throw new Error(`world.series: ${error.message}`)
    const eventIds = (data ?? []) as string[]
    this.ledger.events.push(...eventIds)
    const { data: row } = await this.admin.from('events')
      .select('series_id').eq('id', eventIds[0]).single()
    const seriesId = (row as { series_id: string }).series_id
    this.ledger.series.push(seriesId)
    return { seriesId, eventIds, dates }
  }

  async cancelEvent(eventId: string): Promise<this> {
    const { error } = await this.admin.from('events')
      .update({ cancelled_at: new Date().toISOString() } as never).eq('id', eventId)
    if (error) throw new Error(`world.cancelEvent: ${error.message}`)
    return this
  }

  // ── bookings and money ────────────────────────────────────────────────────

  async book(args: {
    diver: TestUser
    eventId: string
    total?: number
    deposit?: number
    status?: 'pending' | 'confirmed' | 'waitlisted' | 'cancelled'
  }): Promise<string> {
    const { diver, eventId, total = 3000, deposit = 1000, status = 'confirmed' } = args
    const { data, error } = await this.admin.from('bookings').insert({
      user_id: diver.id, event_id: eventId, status, details: { total, deposit },
    } as never).select('id').single()
    if (error) throw new Error(`world.book: ${error.message}`)
    return (data as { id: string }).id
  }

  async pay(args: { bookingId: string; diver: TestUser; amount: number }): Promise<this> {
    const { error } = await this.admin.from('payments').insert({
      booking_id: args.bookingId, user_id: args.diver.id,
      amount: args.amount, status: 'paid', method: 'cash', reference: `R-${args.amount}`,
    } as never)
    if (error) throw new Error(`world.pay: ${error.message}`)
    return this
  }

  /** Open credit rows for a diver, as the cancellation path leaves them. */
  async creditsOf(diver: TestUser) {
    const { data } = await this.admin.from('credits')
      .select('amount, status, booking_id, reason').eq('user_id', diver.id)
    return (data ?? []) as Array<{ amount: number; status: string; booking_id: string | null; reason: string }>
  }

  async bookingStatus(bookingId: string): Promise<string> {
    const { data } = await this.admin.from('bookings').select('status').eq('id', bookingId).single()
    return (data as { status: string }).status
  }

  // ── transport ─────────────────────────────────────────────────────────────

  /** A car in the fleet, tracked for teardown. */
  async vehicle(seats: number, name = `Scenario van ${seats}`): Promise<string> {
    const { data, error } = await this.admin.from('vehicles')
      .insert({ name: `${name} ${crypto.randomUUID().slice(0, 6)}`, passenger_seats: seats } as never)
      .select('id').single()
    if (error) throw new Error(`world.vehicle: ${error.message}`)
    const id = (data as { id: string }).id
    this.ledger.vehicles.push(id)
    return id
  }

  /** Put a car on an event. Cars are allocated per event, not per booking. */
  async allocateCar(vehicleId: string, eventId: string): Promise<this> {
    const { error } = await this.admin.from('event_vehicles')
      .insert({ vehicle_id: vehicleId, event_id: eventId } as never)
    if (error) throw new Error(`world.allocateCar: ${error.message}`)
    return this
  }

  /**
   * Group events into ONE run that shares its transport, which is the unit the
   * seat maths works in — a van on two dives the same day is one van, not two.
   */
  async shareTransport(eventIds: string[], inDays: number): Promise<string> {
    const groupId = crypto.randomUUID()
    const { error } = await this.admin.from('event_ride_groups').insert(
      eventIds.map(event_id => ({ ride_day: this.dayFromNow(inDays), event_id, group_id: groupId })) as never,
    )
    if (error) throw new Error(`world.shareTransport: ${error.message}`)
    return groupId
  }

  /**
   * A booking that asks for a ride. `ride_waitlisted` comes back as the DATABASE
   * stamped it — the client's value is ignored, so this is the only honest way to
   * ask whether the diver got a seat.
   */
  async bookWithRide(args: {
    diver: TestUser; eventId: string; total?: number; deposit?: number
    status?: 'pending' | 'confirmed'
  }): Promise<{ bookingId: string; waitlisted: boolean }> {
    const { diver, eventId, total = 3000, deposit = 1000, status = 'pending' } = args
    const { data, error } = await this.admin.from('bookings').insert({
      user_id: diver.id, event_id: eventId, status,
      details: { total, deposit, transportation: true },
    } as never).select('id, details').single()
    if (error) throw new Error(`world.bookWithRide: ${error.message}`)
    const row = data as { id: string; details: { ride_waitlisted?: boolean } }
    return { bookingId: row.id, waitlisted: row.details.ride_waitlisted === true }
  }

  /** Ask for a ride on an existing booking, and read back what the DB decided. */
  async requestRide(bookingId: string): Promise<boolean> {
    const { data: current } = await this.admin.from('bookings')
      .select('details').eq('id', bookingId).single()
    const details = (current as { details: Record<string, unknown> }).details ?? {}
    const { data, error } = await this.admin.from('bookings')
      .update({ details: { ...details, transportation: true } } as never)
      .eq('id', bookingId).select('details').single()
    if (error) throw new Error(`world.requestRide: ${error.message}`)
    return (data as { details: { ride_waitlisted?: boolean } }).details.ride_waitlisted === true
  }

  /** seats / staff / capacity / claimed for the run an event belongs to. */
  async rideSeats(eventId: string): Promise<{
    seats: number; staff: number; capacity: number; claimed: number
  }> {
    const { data, error } = await this.admin.rpc('event_ride_seats', { p_event_id: eventId })
    if (error) throw new Error(`world.rideSeats: ${error.message}`)
    const row = (data as Array<Record<string, number>>)[0]
    return {
      seats: Number(row.seats), staff: Number(row.staff),
      capacity: Number(row.capacity), claimed: Number(row.claimed),
    }
  }

  // ── families ──────────────────────────────────────────────────────────────

  /** Link children to a parent account, as the family panel does. */
  async family(parent: TestUser, children: TestUser[]): Promise<this> {
    const { error } = await this.admin.from('profiles')
      .update({ parent_account: parent.id } as never)
      .in('id', children.map(c => c.id))
    if (error) throw new Error(`world.family: ${error.message}`)
    return this
  }

  /**
   * One booking per person on the same event, all paid for by the lead, in one
   * group. created_at is staggered so "oldest first" is deterministic.
   */
  async groupBooking(args: {
    lead: TestUser; members: TestUser[]; eventId: string
    total?: number; deposit?: number
    status?: 'pending' | 'confirmed'
  }): Promise<{ groupId: string; bookingIds: string[] }> {
    const { lead, members, eventId, total = 6000, deposit = 2000, status = 'pending' } = args
    const groupId = crypto.randomUUID()
    const bookingIds: string[] = []
    let tick = 0
    for (const person of [lead, ...members]) {
      const { data, error } = await this.admin.from('bookings').insert({
        user_id: person.id, event_id: eventId, status,
        details: { total, deposit, payment_method: 'bank_transfer' },
        payer_id: lead.id, group_id: groupId,
        created_at: `2026-01-01T00:00:0${tick}Z`,
      } as never).select('id').single()
      if (error) throw new Error(`world.groupBooking: ${error.message}`)
      bookingIds.push((data as { id: string }).id)
      tick += 1
    }
    return { groupId, bookingIds }
  }

  /** The lead hands over one lump sum; the RPC spreads it across the group. */
  async payForGroup(args: { lead: TestUser; amount: number; groupId: string }): Promise<number> {
    const db = await this.as(this.adminUser)
    const { data, error } = await db.rpc('record_group_payment', {
      p_lead: args.lead.id, p_amount: args.amount, p_reference: 'GRP-1', p_group_id: args.groupId,
    })
    if (error) throw new Error(`world.payForGroup: ${error.message}`)
    return Number(data)
  }

  async paidOn(bookingId: string): Promise<number> {
    const { data } = await this.admin.from('payments')
      .select('amount, status').eq('booking_id', bookingId)
    return (data ?? []).reduce((sum, p) => {
      const row = p as { amount: number; status: string }
      return sum + (row.status === 'paid' ? Number(row.amount) : row.status === 'refunded' ? -Number(row.amount) : 0)
    }, 0)
  }

  // ── availability and duties ───────────────────────────────────────────────

  async markBusy(args: {
    who: TestUser; fromDays: number; toDays: number; title?: string
  }): Promise<string> {
    const { data, error } = await this.admin.from('staff_availability').insert({
      user_id: args.who.id,
      start_date: this.dayFromNow(args.fromDays),
      start_time: '09:00:00',
      end_date: this.dayFromNow(args.toDays),
      title: args.title ?? 'Away',
    } as never).select('id').single()
    if (error) throw new Error(`world.markBusy: ${error.message}`)
    return (data as { id: string }).id
  }

  /** Returns the error message when the duty is refused, or null when it lands. */
  async assignDuty(args: {
    who: TestUser; eventId?: string; inDays: number; role?: string
  }): Promise<string | null> {
    const { error } = await this.admin.from('duties').insert({
      assignee_id: args.who.id,
      event_id: args.eventId ?? null,
      role: args.role ?? 'guide',
      start_date: this.dayFromNow(args.inDays),
    } as never)
    return error ? error.message : null
  }

  // ── waivers and terms ─────────────────────────────────────────────────────

  /** An annual waiver in the catalog, tracked for teardown. */
  async waiver(over: Record<string, unknown> = {}): Promise<{ code: string; version: number }> {
    const code = `scenario_${crypto.randomUUID().slice(0, 8)}`
    const { error } = await this.admin.from('waivers').insert({
      code, title: 'Scenario liability release', cadence: 'annual',
      version: 1, applies_to: 'none', body: 'I agree to dive safely.', active: true,
      ...over,
    } as never)
    if (error) throw new Error(`world.waiver: ${error.message}`)
    this.ledger.waivers.push(code)
    return { code, version: 1 }
  }

  async signaturesOf(diver: TestUser) {
    const { data } = await this.admin.from('waiver_signatures')
      .select('waiver_code, method, recorded_by, signed_name').eq('diver_id', diver.id)
    return (data ?? []) as Array<{
      waiver_code: string; method: string; recorded_by: string | null; signed_name: string
    }>
  }

  async termsConsentOf(user: TestUser) {
    const { data } = await this.admin.from('profiles')
      .select('agreed_to_terms_at, agreed_to_terms_version').eq('id', user.id).single()
    return data as { agreed_to_terms_at: string | null; agreed_to_terms_version: number | null }
  }

  async termsVersion(): Promise<number> {
    const { data } = await this.admin.from('terms').select('version').single()
    return (data as { version: number }).version
  }

  /** A consent link, as the walk-in courtesy email carries one. */
  async termsLink(user: TestUser, expiresInDays = 90): Promise<string> {
    const { data, error } = await this.admin.from('terms_consent_tokens').insert({
      user_id: user.id,
      expires_at: new Date(Date.now() + expiresInDays * 86_400_000).toISOString(),
      created_by: this.adminUser.id,
    } as never).select('token').single()
    if (error) throw new Error(`world.termsLink: ${error.message}`)
    return (data as { token: string }).token
  }

  // ── time ──────────────────────────────────────────────────────────────────

  /** A calendar day offset from today, in the shop's own terms (no UTC slice). */
  dayFromNow(days: number): string {
    const d = new Date()
    d.setDate(d.getDate() + days)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
}

export async function world(l: Ledger, admin: DB = adminClient()): Promise<World> {
  return new World(admin, l).open()
}
