import { supabase } from './supabase'
import { personName } from './names'
import type { Booking, BookingDiscount, Discount, DiscountInsert } from '../types/database'

/**
 * Discounts, and the three moments one passes through.
 *
 * The shop writes a `discounts` row once, attaches it to the events that offer
 * it (`event_discounts`), and from there a diver asks for it on their own
 * booking (`booking_discounts`). Asking costs nothing and changes no figure:
 * until an admin approves, a request is a claim about who the diver is, not a
 * price.
 *
 * Approval is the only thing that moves money, and it moves it as a negative
 * `booking_amendments` row — the ledger `owed = details.total + amendments` is
 * already summed by every balance in the app, so the event balance, the diver's
 * statement, the deposit clamp and the accounting export need to know nothing
 * about discounts at all. That write happens inside `decide_booking_discount`,
 * never here: the browser may ask and may display, but the amount a discount is
 * worth is computed server-side from the catalog row, so a crafted request
 * cannot nominate its own figure.
 */

/**
 * What a discount takes off a booking whose frozen total is `base`.
 *
 * Mirrors the arithmetic in `decide_booking_discount` so the preview a diver is
 * shown on the register form is the figure the approval will actually write.
 * Keep the two in step: a percent of the frozen total (never of the
 * amendment-adjusted balance — "10% off" means 10% of the trip), rounded to
 * whole units because `booking_amendments.amount` is an integer.
 *
 * The RPC additionally clamps to what the booking still owes, which this cannot
 * do: the client does not know the amendment ledger at registration time, and
 * there is nothing to clamp against yet.
 */
export function discountAmount(
  discount: Pick<Discount, 'kind' | 'value'>, base: number,
): number {
  if (discount.kind === 'percent') return Math.round((base * discount.value) / 100)
  return discount.value
}

/** "10%" or "NTD 500" — how the discount is worth stating on its own. */
export function discountValueLabel(
  discount: Pick<Discount, 'kind' | 'value'>, currency: string,
): string {
  return discount.kind === 'percent'
    ? `${discount.value}%`
    : `${currency} ${discount.value.toLocaleString()}`
}

/** Catalog order: the shop's own sort, then label, so the list is stable. */
export function sortDiscounts<T extends Pick<Discount, 'sort_order' | 'label'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
}

/** A request still waiting on an admin — the only status that needs action. */
export function isOpenRequest(row: Pick<BookingDiscount, 'status'>): boolean {
  return row.status === 'requested'
}

/**
 * The discounts a booking may still ask for: everything the event offers, less
 * the ones already requested or granted. A rejected one is offerable again —
 * the usual reason for a rejection is a diver who could not produce the card,
 * and they should be able to come back with it.
 */
export function offerableDiscounts(
  offered: Discount[],
  existing: Array<Pick<BookingDiscount, 'discount_id' | 'status'>>,
): Discount[] {
  const taken = new Set(
    existing.filter(r => r.status !== 'rejected').map(r => r.discount_id),
  )
  return sortDiscounts(offered.filter(d => !taken.has(d.id)))
}

/** Total already granted on a booking — what the amendments ledger holds. */
export function approvedDiscountTotal(
  rows: Array<Pick<BookingDiscount, 'status' | 'amount'>>,
): number {
  return rows
    .filter(r => r.status === 'approved')
    .reduce((s, r) => s + (r.amount ?? 0), 0)
}

// ── Catalog ─────────────────────────────────────────────────────────────────

/** Every discount, retired ones included — the admin list. */
export async function fetchDiscounts(): Promise<Discount[]> {
  const { data, error } = await supabase
    .from('discounts').select('*').order('sort_order').order('label')
  if (error) throw error
  return (Array.isArray(data) ? data : []) as Discount[]
}

/** Only what an event may still offer — the event form's picker. */
export async function fetchActiveDiscounts(): Promise<Discount[]> {
  const { data, error } = await supabase
    .from('discounts').select('*').eq('active', true).order('sort_order').order('label')
  if (error) throw error
  return (Array.isArray(data) ? data : []) as Discount[]
}

/** Insert (no id) or update (id given). */
export async function saveDiscount(values: DiscountInsert, id?: string): Promise<void> {
  const { error } = id
    ? await supabase.from('discounts').update(values).eq('id', id)
    : await supabase.from('discounts').insert(values)
  if (error) throw error
}

export async function deleteDiscount(id: string): Promise<void> {
  const { error } = await supabase.from('discounts').delete().eq('id', id)
  if (error) throw error
}

// ── What one event offers ───────────────────────────────────────────────────

/** The discount ids attached to an event (the edit form's initial state). */
export async function fetchEventDiscountIds(eventId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('event_discounts').select('discount_id').eq('event_id', eventId)
  if (error) throw error
  return (data ?? []).map(r => r.discount_id)
}

/**
 * The active discounts an event offers, resolved to catalog rows — what the
 * register form puts in front of a diver. A discount the shop has since retired
 * is dropped rather than offered: the attachment stays so un-retiring it
 * restores the offer.
 */
export async function fetchDiscountsForEvent(eventId: string): Promise<Discount[]> {
  const ids = await fetchEventDiscountIds(eventId)
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('discounts').select('*').in('id', ids).eq('active', true)
  if (error) throw error
  return sortDiscounts((Array.isArray(data) ? data : []) as Discount[])
}

// ── Asking and deciding ─────────────────────────────────────────────────────

/** Requests on a set of bookings, keyed by booking id, oldest first. */
export async function fetchBookingDiscounts(
  bookingIds: string[],
): Promise<Map<string, BookingDiscount[]>> {
  const map = new Map<string, BookingDiscount[]>()
  if (bookingIds.length === 0) return map
  const { data, error } = await supabase
    .from('booking_discounts').select('*')
    .in('booking_id', bookingIds)
    .order('requested_at', { ascending: true })
  if (error) throw error
  for (const row of (data ?? []) as BookingDiscount[]) {
    const arr = map.get(row.booking_id) ?? []
    arr.push(row)
    map.set(row.booking_id, arr)
  }
  return map
}

/**
 * Ask for a discount. Returns the new request id. Applies nothing: the booking
 * owes exactly what it owed before, until an admin decides.
 */
export async function requestBookingDiscount(args: {
  bookingId: string
  discountId: string
  note?: string | null
}): Promise<string> {
  const { data, error } = await supabase.rpc('request_booking_discount', {
    p_booking_id: args.bookingId,
    p_discount_id: args.discountId,
    p_note: args.note ?? null,
  })
  if (error) throw error
  return data as string
}

/**
 * Approve or reject. Admin-only (the RPC refuses anyone else), and the only
 * call in the app that turns a discount into money. Returns the amount actually
 * taken off — clamped to what the booking still owed, so it can be less than
 * the discount's face value and is 0 on a rejection.
 */
export async function decideBookingDiscount(args: {
  requestId: string
  approve: boolean
  note?: string | null
}): Promise<number> {
  const { data, error } = await supabase.rpc('decide_booking_discount', {
    p_request_id: args.requestId,
    p_approve: args.approve,
    p_note: args.note ?? null,
  })
  if (error) throw error
  return Number(data ?? 0)
}

// ── The admin queue ─────────────────────────────────────────────────────────

export interface DiscountRequestRow {
  id: string
  bookingId: string
  diverName: string
  eventTitle: string
  discount: Discount
  bookingTotal: number
  note: string | null
  requestedAt: string
}

/**
 * Every request still waiting on a decision, oldest first, with the diver, the
 * event and the booking's frozen total resolved so the queue can show what
 * approving would cost. Cancelled bookings are dropped: their requests can no
 * longer be approved (the RPC refuses), so leaving them in the queue would be
 * an action nobody can take.
 */
export async function fetchOpenDiscountRequests(labels: {
  diverFallback: string
  eventFallback: string
}): Promise<DiscountRequestRow[]> {
  const { data, error } = await supabase
    .from('booking_discounts').select('*')
    .eq('status', 'requested')
    .order('requested_at', { ascending: true })
  if (error) throw error
  const requests = (data ?? []) as BookingDiscount[]
  if (requests.length === 0) return []

  const bookingIds = [...new Set(requests.map(r => r.booking_id))]
  const discountIds = [...new Set(requests.map(r => r.discount_id))]
  const [bookingsRes, discountsRes] = await Promise.all([
    supabase.from('bookings').select('*').in('id', bookingIds),
    supabase.from('discounts').select('*').in('id', discountIds),
  ])
  if (bookingsRes.error) throw bookingsRes.error
  if (discountsRes.error) throw discountsRes.error

  const bookings = new Map(
    ((bookingsRes.data ?? []) as Booking[])
      .filter(b => b.status !== 'cancelled')
      .map(b => [b.id, b]),
  )
  const discounts = new Map(
    ((discountsRes.data ?? []) as Discount[]).map(d => [d.id, d]),
  )

  const live = requests.filter(r => bookings.has(r.booking_id) && discounts.has(r.discount_id))
  if (live.length === 0) return []

  // Narrowed with a type guard rather than `.filter(Boolean)`, which TypeScript
  // does not read as one. The two repos disagree about whether a booking's
  // event_id is nullable, and this file has to compile under both.
  const present = (x: string | null | undefined): x is string => !!x
  const userIds = [...new Set(live.map(r => bookings.get(r.booking_id)!.user_id).filter(present))]
  const eventIds = [...new Set(live.map(r => bookings.get(r.booking_id)!.event_id).filter(present))]
  const [profilesRes, eventsRes] = await Promise.all([
    supabase.from('profiles').select('id, name, nickname').in('id', userIds),
    supabase.from('events').select('id, display_title, admin_title').in('id', eventIds),
  ])
  const names = new Map(
    (profilesRes.data ?? []).map(p => [p.id, personName(p.name, p.nickname)]),
  )
  const titles = new Map(
    (eventsRes.data ?? []).map(e => [e.id, e.display_title || e.admin_title || '']),
  )

  return live.map(r => {
    const booking = bookings.get(r.booking_id)!
    return {
      id: r.id,
      bookingId: r.booking_id,
      diverName: names.get(booking.user_id ?? '') || labels.diverFallback,
      eventTitle: titles.get(booking.event_id ?? '') || labels.eventFallback,
      discount: discounts.get(r.discount_id)!,
      bookingTotal: Number((booking.details as { total?: number } | null)?.total ?? 0),
      note: r.note,
      requestedAt: r.requested_at,
    }
  })
}
