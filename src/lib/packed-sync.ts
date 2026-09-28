import { supabase } from './supabase'
import { gearPieceKey, splitPieceKey } from './gear-packed'

// The shared pack list: reads, writes and live updates for `packed_pieces`
// (20260928100000). A piece is packed exactly when its row exists, so a tick
// is an insert, an untick a delete, and two phones ticking the same piece at
// once land on the same single row.

const TABLE = 'packed_pieces'

/** Every piece on the van for `day`, as piece keys. Throws on a failed read —
 *  an empty list is an answer ("nothing packed yet"), not a fallback. */
export async function fetchPackedKeys(day: string): Promise<Set<string>> {
  const { data, error } = await supabase.from(TABLE).select('booking_id, item').eq('pack_day', day)
  if (error) throw new Error(error.message)
  return new Set((data ?? []).map(r => gearPieceKey(r.booking_id, r.item)))
}

/** Tick or untick pieces for `day`. Throws when the server refused or could not
 *  be reached, so the caller keeps them queued. */
export async function writePacked(day: string, keys: string[], packed: boolean): Promise<void> {
  if (keys.length === 0) return
  if (packed) {
    const rows = keys.map(k => {
      const { bookingId, item } = splitPieceKey(k)
      return { pack_day: day, booking_id: bookingId, item }
    })
    // A piece a colleague already ticked is already on the van: skip it rather
    // than fail the batch it arrived in.
    const { error } = await supabase.from(TABLE)
      .upsert(rows, { onConflict: 'pack_day,booking_id,item', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
    return
  }
  // PostgREST has no tuple IN, so one delete per guest — a guest's whole kit
  // unticked at once is still a single request.
  const byBooking = new Map<string, string[]>()
  for (const k of keys) {
    const { bookingId, item } = splitPieceKey(k)
    byBooking.set(bookingId, [...(byBooking.get(bookingId) ?? []), item])
  }
  const results = await Promise.all([...byBooking].map(([bookingId, items]) =>
    supabase.from(TABLE).delete().eq('pack_day', day).eq('booking_id', bookingId).in('item', items)))
  const failed = results.find(r => r.error)
  if (failed?.error) throw new Error(failed.error.message)
}

interface PieceRow { pack_day?: string; booking_id?: string; item?: string }

/**
 * Hear every tick and untick on `day` as it happens, from any phone. Returns
 * the unsubscribe.
 *
 * Deletes cannot be filtered server-side, so they arrive for every day and are
 * matched here; the deleted row carries its primary key, which is all a piece
 * key needs.
 */
export function subscribePacked(day: string, onChange: (key: string, packed: boolean) => void): () => void {
  const toKey = (row: PieceRow) =>
    row.booking_id && row.item ? gearPieceKey(row.booking_id, row.item) : null
  const channel = supabase
    .channel(`packed-pieces:${day}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLE, filter: `pack_day=eq.${day}` },
      payload => {
        const key = toKey(payload.new as PieceRow)
        if (key) onChange(key, true)
      })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: TABLE },
      payload => {
        const old = payload.old as PieceRow
        const key = toKey(old)
        if (key && old.pack_day === day) onChange(key, false)
      })
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}
