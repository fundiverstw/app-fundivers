import { supabase } from './supabase'
import type { BookingDetails, NondiverOption, NondiverOptionInsert } from '../types/database'

/**
 * Non-diver options: registering for an event without diving.
 *
 * The shop writes a `nondiver_options` row once ("Snorkeler", "Boat passenger"),
 * ticks it on the events that offer it (`event_nondiver_options`), and a person
 * registering for one of those events can pick it instead of the diver price.
 * The option's own `price` and `deposit_amount` replace the event's; everything
 * else on the booking (gear, room, add-ons, ride) is priced exactly as for a
 * diver.
 *
 * The browser only previews the figure. create-registration re-reads the option
 * server-side, refuses one the event does not offer, and prices it from the row,
 * so a crafted request can name an option but never its fee.
 */

/** The value the register form's choice holds for "registering as a diver". */
export const DIVER = 'diver'

/** Catalog order: the shop's own sort, then label, so the list is stable. */
export function sortNondiverOptions<T extends Pick<NondiverOption, 'sort_order' | 'label'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
}

/**
 * The fee and deposit one person owes before extras: the event's diver figures,
 * or the chosen option's. An unknown id (an option retired after the form
 * loaded) prices as a diver, which is what the server will refuse rather than
 * quietly accept.
 */
export function participantPricing(
  choice: string,
  options: Array<Pick<NondiverOption, 'id' | 'price' | 'deposit_amount'>>,
  event: { price?: number | null; deposit_amount?: number | null },
): { base: number; depositAmount: number; option: string | null } {
  const option = choice === DIVER ? null : options.find(o => o.id === choice) ?? null
  if (option) {
    return { base: option.price, depositAmount: option.deposit_amount ?? 0, option: option.id }
  }
  return { base: event.price ?? 0, depositAmount: event.deposit_amount ?? 0, option: null }
}

// ── Catalog ─────────────────────────────────────────────────────────────────

/** Every option, retired ones included — the admin list. */
export async function fetchNondiverOptions(): Promise<NondiverOption[]> {
  const { data, error } = await supabase
    .from('nondiver_options').select('*').order('sort_order').order('label')
  if (error) throw error
  return (Array.isArray(data) ? data : []) as NondiverOption[]
}

/** Insert (no id) or update (id given). */
export async function saveNondiverOption(values: NondiverOptionInsert, id?: string): Promise<void> {
  const { error } = id
    ? await supabase.from('nondiver_options').update(values).eq('id', id)
    : await supabase.from('nondiver_options').insert(values)
  if (error) throw error
}

export async function deleteNondiverOption(id: string): Promise<void> {
  const { error } = await supabase.from('nondiver_options').delete().eq('id', id)
  if (error) throw error
}

// ── What one event offers ───────────────────────────────────────────────────

/**
 * The active options an event offers, resolved to catalog rows — what the
 * register form puts in front of a person. A retired option is dropped rather
 * than offered; the attachment stays so un-retiring it restores the offer.
 */
export async function fetchNondiverOptionsForEvent(eventId: string): Promise<NondiverOption[]> {
  const { data: links, error: linkErr } = await supabase
    .from('event_nondiver_options').select('option_id').eq('event_id', eventId)
  if (linkErr) throw linkErr
  const ids = (links ?? []).map(r => r.option_id)
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('nondiver_options').select('*').in('id', ids).eq('active', true)
  if (error) throw error
  return sortNondiverOptions((Array.isArray(data) ? data : []) as NondiverOption[])
}

/**
 * The options to show when an admin edits an existing booking: what the event
 * offers now, plus the option this booking was made under if it has since been
 * retired or taken off the event. Without it the form would find no match,
 * fall back to the diver price, and saving would silently turn a snorkeler
 * into a diver.
 *
 * The booked option is re-read from the catalog when it still exists. If it
 * was deleted outright, it is rebuilt from the booking's own snapshot: its
 * label, and the fee its base charge line froze. Its deposit cannot be
 * recovered, so it edits as no deposit.
 */
export async function fetchNondiverOptionsForBooking(
  eventId: string,
  booked: Pick<BookingDetails, 'nondiver_option' | 'charges'> | undefined,
): Promise<NondiverOption[]> {
  const offered = await fetchNondiverOptionsForEvent(eventId)
  const ref = booked?.nondiver_option
  if (!ref || offered.some(o => o.id === ref.id)) return offered
  const { data } = await supabase.from('nondiver_options').select('*').eq('id', ref.id).maybeSingle()
  const kept: NondiverOption = (data as NondiverOption | null) ?? {
    id: ref.id,
    created_at: '',
    created_by: null,
    label: ref.label,
    description: null,
    price: booked?.charges?.find(c => c.kind === 'base')?.amount ?? 0,
    deposit_amount: null,
    active: false,
    sort_order: 0,
  }
  return [...offered, kept]
}
