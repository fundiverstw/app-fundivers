import { supabase } from './supabase'
import type { Vehicle, VehicleInsert } from '../types/database'

// Data layer for the shop's transport fleet (catalog table `vehicles`, gated by
// the policies in 20260624000000_vehicles.sql: staff + admin read, admin write).
// Reads are used by the logistics ride planner; writes by the admin Vehicles
// page.

export async function fetchVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .order('passenger_seats', { ascending: false })
  if (error) throw error
  return (data ?? []) as Vehicle[]
}

// Active vehicles only — the live fleet the logistics day view plans rides
// against (retired vehicles stay in the catalog but drop out of planning).
export async function fetchActiveVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('active', true)
    .order('passenger_seats', { ascending: false })
  if (error) throw error
  return (data ?? []) as Vehicle[]
}

export async function saveVehicle(values: VehicleInsert, id?: string): Promise<void> {
  if (id) {
    const { error } = await supabase.from('vehicles').update(values).eq('id', id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('vehicles').insert(values)
    if (error) throw error
  }
}

/** Insert one and hand the row back, so a caller adding a car mid-form can tick
 *  it without re-reading the fleet or guessing at the id it was given. */
export async function createVehicle(values: VehicleInsert): Promise<Vehicle> {
  const { data, error } = await supabase.from('vehicles').insert(values).select().single()
  if (error) throw error
  return data as Vehicle
}

export async function deleteVehicle(id: string): Promise<void> {
  const { error } = await supabase.from('vehicles').delete().eq('id', id)
  if (error) throw error
}
