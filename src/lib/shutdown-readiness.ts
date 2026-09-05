import { netPaidByBooking } from './payments'
import { bookingBalance } from './booking-balance'
import type { Booking, Credit, Payment } from '../types/database'

// What a shop should settle before switching its app off.
//
// Deleting the Supabase project is instant and final: the bookings, the money
// owed in both directions, and the divers' own records go with it. These checks
// are the things that are cheap to see now and impossible to see afterwards —
// each one is a question an admin would regret not having been asked.
//
// Pure so it can be tested without a database; the page fetches the rows.

export type ReadinessLevel = 'ok' | 'warn'

export interface ReadinessCheck {
  id:     ReadinessCheckId
  level:  ReadinessLevel
  /** The number the copy is about — event count, amount owed, and so on. */
  count:  number
  /** Extra detail some checks carry (the soonest event's date, a timestamp). */
  detail?: string
}

export type ReadinessCheckId =
  | 'backup'
  | 'upcomingEvents'
  | 'moneyOwedToShop'
  | 'creditsOwedToDivers'
  | 'divers'

export interface ReadinessInput {
  /** When the last successful database backup was taken, if ever. */
  lastBackupAt: string | null
  /** "Now", so the caller decides the clock (and a test can pin it). */
  now: Date
  /** Events not yet run and not cancelled, as { id, startDate }. */
  upcomingEvents: Array<{ id: string; startDate: string }>
  /** Every booking that still counts — cancelled ones owe nothing. */
  bookings: Array<Pick<Booking, 'id' | 'status' | 'details'>>
  payments: Array<Pick<Payment, 'booking_id' | 'amount' | 'status'>>
  /** Credit rows; open ones are money the shop still holds for a diver. */
  credits: Array<Pick<Credit, 'amount' | 'status'>>
  /** Diver accounts that would be deleted with the project. */
  diverCount: number
}

// A backup older than this is stale for the purpose of switching off: the shop
// has almost certainly taken bookings or payments since.
export const BACKUP_FRESH_HOURS = 24

export function computeShutdownReadiness(input: ReadinessInput): ReadinessCheck[] {
  const paid = netPaidByBooking(input.payments)

  const owed = input.bookings.reduce((sum, b) => {
    if (b.status === 'cancelled') return sum
    const total = Number((b.details as { total?: number } | null)?.total ?? 0)
    const balance = bookingBalance(total, paid.get(b.id) ?? 0)
    return sum + (balance.state === 'due' ? balance.amount : 0)
  }, 0)

  const creditsOpen = input.credits.reduce(
    (sum, c) => sum + (c.status === 'open' ? Number(c.amount ?? 0) : 0), 0)

  const backupAgeHours = input.lastBackupAt
    ? (input.now.getTime() - new Date(input.lastBackupAt).getTime()) / 3_600_000
    : null

  return [
    {
      id:     'backup',
      // Never backed up, or backed up before the last day of trading: either
      // way the copy the shop keeps is not the copy it is about to delete.
      level:  backupAgeHours !== null && backupAgeHours <= BACKUP_FRESH_HOURS ? 'ok' : 'warn',
      count:  0,
      detail: input.lastBackupAt ?? undefined,
    },
    {
      id:     'upcomingEvents',
      level:  input.upcomingEvents.length > 0 ? 'warn' : 'ok',
      count:  input.upcomingEvents.length,
      detail: soonest(input.upcomingEvents),
    },
    {
      id:    'moneyOwedToShop',
      level: owed > 0 ? 'warn' : 'ok',
      count: owed,
    },
    {
      // The one that cannot be fixed after the fact: a diver's unspent credit
      // is the shop holding their money. Deleting the project does not settle
      // it, it only erases the record of it.
      id:    'creditsOwedToDivers',
      level: creditsOpen > 0 ? 'warn' : 'ok',
      count: creditsOpen,
    },
    {
      id:    'divers',
      level: input.diverCount > 0 ? 'warn' : 'ok',
      count: input.diverCount,
    },
  ]
}

/** True when nothing is outstanding — the shop can switch off cleanly. */
export function readyToShutDown(checks: ReadinessCheck[]): boolean {
  return checks.every(c => c.level === 'ok')
}

function soonest(events: Array<{ startDate: string }>): string | undefined {
  if (events.length === 0) return undefined
  return events.reduce((first, e) => (e.startDate < first ? e.startDate : first), events[0].startDate)
}
