import { supabase } from './supabase'
import type { TripBoardItem, MyTripReferral } from '../types/database'

/**
 * Record that the signed-in diver is interested in a published trip and return
 * their referral code (FD-XXXXXX). Runs inside the express_trip_interest
 * SECURITY DEFINER RPC (20260623000000): it mints a referral on first interest
 * and is idempotent — tapping again returns the same code rather than erroring
 * on the one-live-referral-per-trip index. The RPC returns only the code, so
 * the diver never reads their referral's kickback columns.
 */
export async function expressTripInterest(tripId: string): Promise<string> {
  const { data, error } = await supabase.rpc('express_trip_interest', { p_trip_id: tripId })
  if (error) throw error
  if (!data) throw new Error('express_trip_interest returned no code')
  return data as string
}

/**
 * The published Trip Board, newest-published first. Reads the owner-privileged
 * `trip_board` view, which exposes only diver-safe columns (no kickback rate)
 * and joins in the partner shop we vouch for.
 */
export async function fetchTripBoard(): Promise<TripBoardItem[]> {
  const { data, error } = await supabase
    .from('trip_board')
    .select('*')
    .order('published_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as TripBoardItem[]
}

/** One published trip by id (for the detail page / deep links), or null if it
 *  isn't on the board. Same diver-safe projection as fetchTripBoard. */
export async function fetchTripBoardItem(id: string): Promise<TripBoardItem | null> {
  const { data, error } = await supabase
    .from('trip_board')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as TripBoardItem | null
}

/**
 * The signed-in diver's own trip referrals (code + status + trip/partner
 * labels), newest first. Reads `my_trip_referrals`, which is scoped to
 * auth.uid() and carries none of the kickback ledger.
 */
export async function fetchMyTripReferrals(): Promise<MyTripReferral[]> {
  const { data, error } = await supabase
    .from('my_trip_referrals')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as MyTripReferral[]
}
