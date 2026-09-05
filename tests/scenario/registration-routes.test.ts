import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { world, ledger, teardownWorld, type World, type Ledger } from './world'
import type { TestUser } from '../integration/helpers'
import {
  handleRegistration,
  type Deps as RegistrationDeps,
} from '../../supabase/functions/create-registration/handler'
import {
  handleGroupSummary,
  type Deps as GroupSummaryDeps,
} from '../../supabase/functions/send-group-summary/handler'
import { bookingBalance } from '../../src/lib/booking-balance'
import { netPaid } from '../../src/lib/payments'

// The two ways a diver registers, each walked from the request the browser
// posts to the rows the shop reads back.
//
// Both routes were covered in three separately-mocked pieces before this: the
// form tests assert the body they hand to supabase.functions.invoke, the
// handler suite runs that body against in-memory vi.fn() deps, and the
// integration suite inserts bookings straight through the admin client. Nothing
// ran the real handler against the real schema, so a body the form sends, a
// column the handler writes and a constraint the database enforces could drift
// apart and every suite would still pass.
//
// So here the actual handler answers actual Requests — real Bearer tokens, real
// service-role writes, real triggers and constraints. Two things are stubbed,
// both outside the route: the SMTP transporter (null, which the handler treats
// as "this deploy has no mail wired" and skips) and the PDF builder. What the
// Deno entry adds on top is env reading and Deno.serve; the logic below it is
// what runs here.

let w: World
const l: Ledger = ledger()

beforeAll(async () => { w = await world(l) })
afterAll(async () => { await teardownWorld(l) })

function edgeEnv() {
  return {
    companyEmail:    'shop@example.test',
    mailFromName:    'Scenario Shop',
    mailFromAddress: 'shop@example.test',
  }
}

/** Service-role and anon clients wired exactly as the Deno entry wires them. */
function edgeDeps(): RegistrationDeps {
  const url = process.env.API_URL!
  const anonKey = process.env.ANON_KEY!
  const admin = createClient(url, process.env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const anon = createClient(url, anonKey, { auth: { persistSession: false } })
  return {
    admin: admin as unknown as RegistrationDeps['admin'],
    anon:  anon  as unknown as RegistrationDeps['anon'],
    makeAuthedClient: (token: string) => createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth:   { persistSession: false },
    }) as unknown as ReturnType<RegistrationDeps['makeAuthedClient']>,
    transporter: null,
    buildPdfBase64: async () => '',
    env: edgeEnv(),
    // Never reached: every request below carries a Bearer token, and Turnstile
    // gates the guest path only.
    verifyTurnstile: async () => ({ success: true }),
  }
}

function groupSummaryDeps(): GroupSummaryDeps {
  const base = edgeDeps()
  return {
    admin: base.admin as unknown as GroupSummaryDeps['admin'],
    makeAuthedClient: base.makeAuthedClient as unknown as GroupSummaryDeps['makeAuthedClient'],
    transporter: null,
    buildGroupPdfBase64: async () => '',
    env: edgeEnv(),
  }
}

function post(fn: string, body: unknown, token: string): Request {
  return new Request(`http://localhost/functions/v1/${fn}`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

async function register(body: Record<string, unknown>, token: string) {
  const res = await handleRegistration(post('create-registration', body, token), edgeDeps())
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

async function tokenFor(user: TestUser): Promise<string> {
  const client = await w.as(user)
  const { data } = await client.auth.getSession()
  if (!data.session) throw new Error(`no session for ${user.email}`)
  return data.session.access_token
}

/**
 * The details block both forms build, with the browser's own money on it.
 * RegisterForm and MultiRegisterForm each compute total/deposit for the live
 * price preview and post them; the figures below are deliberately wrong, so
 * every assertion about money is an assertion that the server ignored them.
 */
function details(over: Record<string, unknown> = {}) {
  return {
    gear:                { rent: false },
    add_ons:             [],
    transportation:      false,
    ride_waitlisted:     false,
    payment_method:      null,
    pay_deposit_only:    false,
    nitrox_course_addon: false,
    total:               1,
    deposit:             1,
    ...over,
  }
}

async function bookingRow(id: string) {
  const { data } = await w.admin.from('bookings')
    .select('id, user_id, event_id, status, group_id, created_by, payer_id, details')
    .eq('id', id).single()
  return data as unknown as {
    id: string; user_id: string; event_id: string; status: string
    group_id: string | null; created_by: string | null; payer_id: string | null
    details: { total?: number; deposit?: number; transportation?: boolean }
  }
}

/** What the diver's own Records page would show for a booking. */
async function balanceOf(bookingId: string, owed: number) {
  const { data } = await w.admin.from('payments')
    .select('amount, status').eq('booking_id', bookingId)
  return bookingBalance(owed, netPaid((data ?? []) as never))
}

describe('scenario: a diver registers for one event', () => {
  it('books through the registration route, on the shop\'s prices rather than its own', async () => {
    const diver = await w.person('diver')
    const priceId = await w.price({ startingAt: 3000, deposit: 1000, transport: 200 })
    const eventId = await w.dive({ price: priceId, has_transport: true })
    const token = await tokenFor(diver)

    // The body RegisterForm posts for a signed-in diver booking themselves.
    const res = await register({
      event_type:    'dive',
      event_id:      eventId,
      profile_patch: { name: 'Scenario Diver', nickname: 'Scen' },
      details:       details(),
      notes:         null,
    }, token)

    expect(res.status).toBe(200)
    const bookingId = res.body.booking_id as string
    expect(bookingId).toBeTruthy()
    expect(res.body.status).toBe('pending')

    const booking = await bookingRow(bookingId)
    expect(booking.user_id).toBe(diver.id)
    expect(booking.event_id).toBe(eventId)
    expect(booking.status).toBe('pending')
    // Resolved from the verified token, not from anything the body could say.
    expect(booking.created_by).toBe(diver.id)
    expect(booking.group_id).toBeNull()

    // The shop's figures, off the linked prices row — not the 1/1 posted.
    expect(booking.details.total).toBe(3000)
    expect(booking.details.deposit).toBe(1000)

    // Step 2 of the form writes through to the diver's profile.
    const { data: profile } = await w.admin.from('profiles')
      .select('name, nickname').eq('id', diver.id).single()
    expect(profile).toMatchObject({ name: 'Scenario Diver', nickname: 'Scen' })

    expect(await balanceOf(bookingId, booking.details.total!))
      .toEqual({ net: 3000, amount: 3000, state: 'due' })
  })

  it('charges the ride when the diver asks for one, and refuses the question when the shop drives nobody', async () => {
    const diver = await w.person('diver')
    const priceId = await w.price({ startingAt: 3000, deposit: 1000, transport: 200 })
    const token = await tokenFor(diver)

    const driven = await w.dive({ price: priceId, has_transport: true })
    const ride = await register({
      event_type: 'dive', event_id: driven,
      profile_patch: {}, details: details({ transportation: true }), notes: null,
    }, token)
    expect(ride.status).toBe(200)
    expect((await bookingRow(ride.body.booking_id as string)).details.total).toBe(3200)

    // An event nobody is driven to puts no ride question, so a body that
    // answers one is answering a question that was never asked.
    const undriven = await w.dive({ price: priceId, has_transport: false }, 8)
    const noRide = await register({
      event_type: 'dive', event_id: undriven,
      profile_patch: {}, details: details({ transportation: true }), notes: null,
    }, token)
    expect(noRide.status).toBe(200)
    const row = await bookingRow(noRide.body.booking_id as string)
    expect(row.details.transportation).toBe(false)
    expect(row.details.total).toBe(3000)
  })
})

describe('scenario: a diver registers for a cart of events', () => {
  it('lands one booking per event under a shared group, and summarizes the group', async () => {
    const diver = await w.person('diver')
    const token = await tokenFor(diver)

    const cart = await Promise.all([
      w.price({ startingAt: 3000, deposit: 1000 }).then(p => w.dive({ price: p }, 7)),
      w.price({ startingAt: 4500, deposit: 1500 }).then(p => w.dive({ price: p }, 14)),
      w.price({ startingAt: 2000 }).then(p => w.dive({ price: p }, 21)),
    ])

    // MultiRegisterForm mints one group_id for the cart, fires the calls in
    // parallel, and suppresses the per-booking email so the group gets one
    // summary instead of three.
    const groupId = crypto.randomUUID()
    const settled = await Promise.allSettled(cart.map(eventId => register({
      event_type:     'dive',
      event_id:       eventId,
      profile_patch:  {},
      details:        details(),
      notes:          null,
      group_id:       groupId,
      suppress_email: true,
    }, token)))

    const ok = settled.filter(r => r.status === 'fulfilled')
    expect(ok).toHaveLength(3)
    for (const r of ok) expect((r as PromiseFulfilledResult<{ status: number }>).value.status).toBe(200)

    const { data } = await w.admin.from('bookings')
      .select('id, user_id, event_id, status, group_id, details')
      .eq('group_id', groupId)
    const bookings = (data ?? []) as unknown as Array<{
      id: string; user_id: string; event_id: string; status: string
      group_id: string; details: { total?: number }
    }>

    expect(bookings).toHaveLength(3)
    expect(new Set(bookings.map(b => b.event_id))).toEqual(new Set(cart))
    expect(bookings.every(b => b.user_id === diver.id)).toBe(true)
    expect(bookings.every(b => b.status === 'pending')).toBe(true)

    const totalByEvent = new Map(bookings.map(b => [b.event_id, b.details.total]))
    expect(totalByEvent.get(cart[0])).toBe(3000)
    expect(totalByEvent.get(cart[1])).toBe(4500)
    expect(totalByEvent.get(cart[2])).toBe(2000)

    // Each booking still owes on its own — a group shares an id, not a balance.
    for (const b of bookings) {
      expect((await balanceOf(b.id, b.details.total!)).state).toBe('due')
    }

    // The one email the cart does send: a single summary over the group.
    const res = await handleGroupSummary(
      post('send-group-summary', { group_id: groupId }, token),
      groupSummaryDeps(),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, divers: 3, group_total: 9500 })
  })

  it('refuses to attach a booking to a stranger\'s group', async () => {
    const mine = await w.person('diver')
    const stranger = await w.person('diver')
    const priceId = await w.price({ startingAt: 3000 })
    const groupId = crypto.randomUUID()

    const first = await register({
      event_type: 'dive', event_id: await w.dive({ price: priceId }, 9),
      profile_patch: {}, details: details(), notes: null, group_id: groupId,
    }, await tokenFor(mine))
    expect(first.status).toBe(200)

    const intruder = await register({
      event_type: 'dive', event_id: await w.dive({ price: priceId }, 10),
      profile_patch: {}, details: details(), notes: null, group_id: groupId,
    }, await tokenFor(stranger))
    expect(intruder.status).toBe(403)

    const { data } = await w.admin.from('bookings').select('id').eq('group_id', groupId)
    expect(data ?? []).toHaveLength(1)
  })
})
