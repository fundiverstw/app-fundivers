import { supabase } from './supabase'
import type { PartnerShop, PartnerShopInsert, Trip, TripInsert, TripStatus } from '../types/database'

// Admin data layer for the Trip Board (partner shops + trips). The diver-facing
// reads go through the owner-privileged views in trip-board.ts; this module is
// the admin CRUD against the base tables (gated by the "admin manage" RLS
// policies in 20260623000000_trip_board.sql).

export async function fetchPartnerShops(): Promise<PartnerShop[]> {
  const { data, error } = await supabase
    .from('partner_shops')
    .select('*')
    .order('name')
  if (error) throw error
  return (data ?? []) as PartnerShop[]
}

export async function savePartnerShop(values: PartnerShopInsert, id?: string): Promise<void> {
  if (id) {
    const { error } = await supabase.from('partner_shops').update(values).eq('id', id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('partner_shops').insert(values)
    if (error) throw error
  }
}

export async function deletePartnerShop(id: string): Promise<void> {
  const { error } = await supabase.from('partner_shops').delete().eq('id', id)
  if (error) throw error
}

export async function fetchTrips(): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Trip[]
}

/**
 * Stamp published_at the first time a trip goes live so the board can order by
 * "newest published". Re-publishing (draft → published → draft → published)
 * keeps the original stamp; we only set it when it's still null.
 */
function withPublishStamp(values: TripInsert, existing?: Trip): TripInsert {
  if (values.status === 'published' && !values.published_at && !existing?.published_at) {
    return { ...values, published_at: new Date().toISOString() }
  }
  return values
}

export async function saveTrip(values: TripInsert, existing?: Trip): Promise<void> {
  const payload = withPublishStamp(values, existing)
  if (existing) {
    const { error } = await supabase.from('trips').update(payload).eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('trips').insert(payload)
    if (error) throw error
  }
}

export async function setTripStatus(trip: Trip, status: TripStatus): Promise<void> {
  const patch = withPublishStamp({ ...trip, status }, trip)
  const { error } = await supabase
    .from('trips')
    .update({ status, published_at: patch.published_at ?? trip.published_at })
    .eq('id', trip.id)
  if (error) throw error
}

export async function deleteTrip(id: string): Promise<void> {
  const { error } = await supabase.from('trips').delete().eq('id', id)
  if (error) throw error
}
