import { supabase } from './supabase'
import type { DiveSite, DiveSiteInsert } from '../types/database'

// The shop's places — dive sites and adventure locations. One row per place, so
// "Bat Cave" is the same Bat Cave everywhere: the almanac files observations
// against it, and an event says which one it goes to.
//
// Admin-curated (see the dive_sites RLS); any signed-in diver reads it, because
// the almanac's submission form is a diver surface.

export type { DiveSiteInsert }

/** Every site, active first, then alphabetical — the admin list. */
export async function fetchDiveSites(): Promise<DiveSite[]> {
  const { data, error } = await supabase
    .from('dive_sites').select('*').order('active', { ascending: false }).order('name')
  if (error) throw error
  return (data ?? []) as DiveSite[]
}

/** Insert (no id) or update (id given). */
export async function saveDiveSite(values: DiveSiteInsert, id?: string): Promise<void> {
  const { error } = id
    ? await supabase.from('dive_sites').update(values).eq('id', id)
    : await supabase.from('dive_sites').insert(values)
  if (error) throw error
}

export async function deleteDiveSite(id: string): Promise<void> {
  const { error } = await supabase.from('dive_sites').delete().eq('id', id)
  if (error) throw error
}
