// The day board is what staff read on a boat, and everything it shows — gear
// totals, who is booked, who is on duty, what is still owed — comes from one
// fetch. That fetch is also replayed ten times over to fill the on-device
// snapshot, so a query shape that quietly returns nothing would put an empty
// board on a phone with no way to notice.
//
// Runs the REAL fetch (src/lib/day-board.ts) through the app's own client
// against the live local stack, signed in as an admin, so RLS, the column
// lists and the PostgREST filter strings are exercised as they are in the
// browser. The duty filter is the one worth pinning: `.or('end_date.gte.…,
// end_date.is.null')` is a string PostgREST parses, not something TypeScript
// can check.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, userClient, createTestUser, deleteTestUser, type TestUser } from './helpers'
import { supabase } from '../../src/lib/supabase'
import { fetchDayBoard, amendmentsByBooking } from '../../src/lib/day-board'
import { redactProfileForOffline } from '../../src/lib/offline-snapshot'
import { gearTotals } from '../../src/lib/logistics'

const admin = adminClient()

const DAY = '2031-10-04'
const QUIET_DAY = '2031-10-05'

let adminUser: TestUser
let diver: TestUser
let guide: TestUser
let eventId: string
let bookingId: string

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver     = await createTestUser(admin)
  guide     = await createTestUser(admin, { role: 'staff' })

  const asAdmin = await userClient(adminUser.email, adminUser.password)
  // block_self_gear_size_change() rejects the service role (no auth.uid, so
  // is_staff_or_admin() is false), so sizes go in as the signed-in admin.
  const { error: sizeError } = await asAdmin.from('profiles')
    .update({ shoe_size: 'JP 26', bcd_size: 'M', medical_notes: 'Asthma' } as never)
    .eq('id', diver.id)
  if (sizeError) throw new Error(`size update failed: ${sizeError.message}`)

  eventId = crypto.randomUUID()
  const { error: eventError } = await admin.from('events' as never).insert({
    id: eventId,
    kind: 'dive',
    admin_title: 'Day board dive',
    notes: '',
    start_date: DAY,
    start_time: '08:00:00',
    end_date: DAY,
  } as never)
  if (eventError) throw new Error(`event insert failed: ${eventError.message}`)

  bookingId = crypto.randomUUID()
  const { error: bookingError } = await admin.from('bookings').insert({
    id: bookingId,
    user_id: diver.id,
    event_id: eventId,
    status: 'confirmed',
    details: { total: 3000, gear: { rent: true, items: ['BCD', 'Boots (rubber sole)'] } },
  } as never)
  if (bookingError) throw new Error(`booking insert failed: ${bookingError.message}`)

  // A cancelled booking on the same day — must not reach the board at all.
  const { error: cancelledError } = await admin.from('bookings').insert({
    user_id: guide.id,
    event_id: eventId,
    status: 'cancelled',
    details: { total: 2800, gear: { rent: true, items: ['Wetsuit'] } },
  } as never)
  if (cancelledError) throw new Error(`cancelled booking insert failed: ${cancelledError.message}`)

  // An open-ended duty (null end_date) covering the day — the branch of the
  // `.or()` filter a single-day duty would never exercise.
  const { error: dutyError } = await admin.from('duties' as never).insert({
    event_id: eventId,
    assignee_id: guide.id,
    role: 'guide',
    start_date: DAY,
    end_date: null,
  } as never)
  if (dutyError) throw new Error(`duty insert failed: ${dutyError.message}`)

  const { error: paymentError } = await admin.from('payments' as never).insert({
    booking_id: bookingId,
    user_id: diver.id,
    amount: 1000,
    method: 'cash',
    status: 'paid',
  } as never)
  if (paymentError) throw new Error(`payment insert failed: ${paymentError.message}`)

  // The page reads through the app's module-level client, and so does
  // fetchDayBoard — sign it in rather than passing a client it would ignore.
  const { error } = await supabase.auth.signInWithPassword({
    email: adminUser.email, password: adminUser.password,
  })
  if (error) throw new Error(`admin sign-in failed: ${error.message}`)
})

afterAll(async () => {
  await supabase.auth.signOut()
  if (eventId) await admin.from('events' as never).delete().eq('id', eventId)
  for (const u of [adminUser, diver, guide]) {
    if (u) await deleteTestUser(admin, u.id)
  }
})

describe('fetchDayBoard', () => {
  it('returns the day\'s event with the roster behind it', async () => {
    const board = await fetchDayBoard(DAY)
    expect(board.events.map(e => e.id)).toContain(eventId)
    expect(board.bookings.map(b => b.id)).toContain(bookingId)
  })

  // A board that renders every diver as "no size on file" is a confident wrong
  // answer; the profile join is the thing that prevents it.
  it('carries the profile that holds each diver\'s sizes', async () => {
    const board = await fetchDayBoard(DAY)
    const row = board.profiles.find(p => p.id === diver.id)
    expect(row, 'the booked diver should come back with a profile').toBeTruthy()
    expect(row!.shoe_size).toBe('JP 26')
    expect(row!.bcd_size).toBe('M')
  })

  it('leaves cancelled bookings off the board entirely', async () => {
    const board = await fetchDayBoard(DAY)
    expect(board.bookings.every(b => b.status !== 'cancelled')).toBe(true)
    expect(gearTotals(board.bookings.map(booking => ({ booking }))).map(g => g.item))
      .not.toContain('Wetsuit')
  })

  // The `.or()` filter is a string PostgREST parses — nothing in TypeScript
  // catches a typo in it, and an open-ended duty is the branch that would be
  // silently dropped.
  it('finds an open-ended duty covering the day', async () => {
    const board = await fetchDayBoard(DAY)
    const duty = board.duties.find(d => d.assignee_id === guide.id)
    expect(duty, 'the open-ended guide duty should cover this day').toBeTruthy()
    expect(duty!.role).toBe('guide')
  })

  it('brings the on-duty staff member\'s profile back too, not just the divers\'', async () => {
    const board = await fetchDayBoard(DAY)
    expect(board.profiles.map(p => p.id)).toContain(guide.id)
  })

  it('reads the payments the balance column is computed from', async () => {
    const board = await fetchDayBoard(DAY)
    const paid = board.payments.filter(p => p.booking_id === bookingId)
    expect(paid).toHaveLength(1)
    expect(Number(paid[0].amount)).toBe(1000)
  })

  it('returns a flat amendment ledger that regroups per booking', async () => {
    const board = await fetchDayBoard(DAY)
    expect(Array.isArray(board.amendments)).toBe(true)
    expect(amendmentsByBooking(board.amendments).get(bookingId) ?? []).toEqual([])
  })

  // Distinct from a failed read, which throws. The board renders this as "no
  // events scheduled", and the snapshot stores it as a genuinely quiet day.
  it('returns an empty board for a day with no events', async () => {
    const board = await fetchDayBoard(QUIET_DAY)
    expect(board.events).toEqual([])
    expect(board.bookings).toEqual([])
    expect(board.profiles).toEqual([])
  })
})

describe('what a capture would put on a phone', () => {
  // The projection is only worth anything if the rows it runs over really do
  // carry the sensitive columns in the first place — a redaction test against
  // a hand-built fixture would pass even if `select('*')` had stopped
  // returning them.
  it('strips the medical note that the live read really does return', async () => {
    const board = await fetchDayBoard(DAY)
    const live = board.profiles.find(p => p.id === diver.id)!
    expect(live.medical_notes).toBe('Asthma')

    const stored = redactProfileForOffline(live)
    expect(stored.medical_notes).toBeNull()
    expect(stored.id_number).toBeNull()
    expect(stored.date_of_birth).toBeNull()
    expect(stored.emergency_contact_phone).toBeNull()
    // …while keeping what the board is for.
    expect(stored.shoe_size).toBe('JP 26')
    expect(stored.bcd_size).toBe('M')
  })
})
