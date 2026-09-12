import { supabase } from './supabase'

/**
 * How much work is waiting on an admin, per admin page.
 *
 * The Manage hub is a wall of thirty-odd cards, and four of them can be hiding
 * somebody waiting on a decision: a diver who asked for a refund, a diver who
 * asked for a discount, an account an admin put on hold, a wildlife name a
 * diver proposed. Nothing on the hub said so, so the only way to find out was
 * to open each page and look.
 *
 * One definition per queue, exported by name, because the header badges in
 * AdminShell count the same things. Two copies of "what counts as waiting"
 * drift, and a badge that disagrees with the page it links to is worse than no
 * badge — it sends an admin to a queue that turns out to be empty, or leaves
 * one silently full. Each function below is the single definition; both
 * surfaces call it.
 *
 * Every count is a `head: true` request, so PostgREST returns the number in a
 * Content-Range header and no rows cross the wire. All four are admin-readable
 * by RLS; the hub and the header are both admin-only surfaces, and a staff
 * session would simply read zero.
 */

/** Diver accounts an admin suspended and has not yet reinstated or closed. */
export async function countOnHoldAccounts(): Promise<number> {
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  return count ?? 0
}

/**
 * Refund requests nobody has answered. Matches AdminRefundsPage's first queue
 * exactly: stamped, and not already cancelled — approving a refund cancels the
 * booking, which is what drops it off the list.
 *
 * Deliberately NOT the same page's second list, the cancelled bookings still
 * holding money: that is money to reconcile rather than a person waiting, and
 * counting it costs five queries and a full event resolution
 * (`fetchUnreconciledCancellations`), which is not a price a badge should make
 * every visit to the hub pay.
 */
export async function countOpenRefundRequests(): Promise<number> {
  const { count } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .not('refund_requested_at', 'is', null)
    .neq('status', 'cancelled')
  return count ?? 0
}

/**
 * Discount requests nobody has decided. The cancelled-booking exclusion
 * matches AdminDiscountsPage's queue, and has to: decide_booking_discount
 * refuses a cancelled booking, so counting one would point at a decision
 * nobody can make.
 */
export async function countOpenDiscountRequests(): Promise<number> {
  const { count } = await supabase
    .from('booking_discounts')
    .select('id, bookings!inner(status)', { count: 'exact', head: true })
    .eq('status', 'requested')
    .neq('bookings.status', 'cancelled')
  return count ?? 0
}

/** Wildlife names divers proposed and no staff member has ruled on. */
export async function countTaxonProposals(): Promise<number> {
  const { count } = await supabase
    .from('taxa')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  return count ?? 0
}

/**
 * Route → the count of what is waiting there. Keyed by the `to` of the Manage
 * hub card, so adding a badge to a new page is one entry here and nothing in
 * the component.
 */
const COUNTERS: Record<string, () => Promise<number>> = {
  '/admin/applications': countOnHoldAccounts,
  '/admin/refunds':      countOpenRefundRequests,
  '/admin/discounts':    countOpenDiscountRequests,
  '/admin/wildlife':     countTaxonProposals,
}

/** The routes that can carry a badge at all. */
export const PENDING_ROUTES = Object.keys(COUNTERS)

/**
 * Every count at once, keyed by route. Best-effort per queue: one failing read
 * must not blank the other three badges, so a rejection counts as zero — the
 * hub still works, it just says nothing about that one page, which is what it
 * said before any of this existed.
 */
export async function fetchPendingCounts(): Promise<Record<string, number>> {
  const entries = Object.entries(COUNTERS)
  const results = await Promise.all(
    entries.map(([, count]) => count().catch(() => 0)),
  )
  return Object.fromEntries(entries.map(([route], i) => [route, results[i]]))
}
