import { supabase } from './supabase'
import type { BookingAmendment } from '../types/database'

// Append-only ledger of admin-issued balance adjustments per booking. The
// table's RLS makes a row visible to the booking's diver and to all
// staff/admin profiles; INSERTs are admin-only with created_by =
// auth.uid(). UPDATE / DELETE are blocked by the absence of any policy —
// to "reverse" an amendment, admin adds a new opposite-sign one.

/**
 * Fetch amendments for a set of bookings, oldest first so the ledger
 * reads top-to-bottom in the order it was written. Returns a map keyed
 * by booking id; bookings with no amendments are simply absent.
 */
export async function fetchAmendmentsForBookings(
  bookingIds: string[],
): Promise<Map<string, BookingAmendment[]>> {
  if (bookingIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('booking_amendments')
    .select('*')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: true })
  if (error) throw error
  const map = new Map<string, BookingAmendment[]>()
  for (const row of data ?? []) {
    const arr = map.get(row.booking_id) ?? []
    arr.push(row)
    map.set(row.booking_id, arr)
  }
  return map
}

/**
 * Insert an amendment. `signedAmount` is the net delta on the diver's
 * balance — positive = they owe more, negative = they owe less. Caller
 * is responsible for composing it from the admin's sign + amount UI
 * inputs (see formAmount below).
 */
export async function addAmendment(args: {
  bookingId: string
  signedAmount: number
  note: string
  createdBy: string
}): Promise<BookingAmendment> {
  const { bookingId, signedAmount, note, createdBy } = args
  const { data, error } = await supabase
    .from('booking_amendments')
    .insert({
      booking_id: bookingId,
      amount:     signedAmount,
      note:       note.trim(),
      created_by: createdBy,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

/** Helper: compose a signed amount from the form's sign radio + amount input. */
export function formAmount(sign: '+' | '-', amount: number): number {
  return sign === '+' ? amount : -amount
}

/** Sum of all amendments — net delta to apply to a booking's original total. */
export function amendmentsDelta(rows: BookingAmendment[]): number {
  return rows.reduce((s, r) => s + r.amount, 0)
}
