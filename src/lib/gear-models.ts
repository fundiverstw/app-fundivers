// Data access for the gear sizing charts (gear_models + gear_model_sizes).
// The pure matching logic lives in gear-sizing.ts; this module is the Supabase
// read/write seam used by the admin editor and the logistics lookup.

import { supabase } from './supabase'
import type { GearModel, GearModelInsert, GearModelSize, GearModelSizeInsert } from '../types/database'
import type { GearModelWithSizes } from './gear-sizing'

// All models with their size rows, grouped. Admin sees every model; the
// logistics lookup filters to active ones via matchGear.
export async function fetchGearModelsWithSizes(): Promise<GearModelWithSizes[]> {
  const [modelsRes, sizesRes] = await Promise.all([
    supabase.from('gear_models').select('*').order('gear_type').order('sort_order').order('name'),
    supabase.from('gear_model_sizes').select('*').order('sort_order'),
  ])
  if (modelsRes.error) throw modelsRes.error
  if (sizesRes.error) throw sizesRes.error

  const byModel = new Map<string, GearModelSize[]>()
  for (const s of (sizesRes.data ?? []) as GearModelSize[]) {
    const list = byModel.get(s.model_id) ?? []
    list.push(s)
    byModel.set(s.model_id, list)
  }
  return ((modelsRes.data ?? []) as GearModel[]).map(m => ({ ...m, sizes: byModel.get(m.id) ?? [] }))
}

export async function saveGearModel(model: GearModelInsert): Promise<GearModel> {
  const { data, error } = await supabase.from('gear_models').upsert(model as never).select('*').single()
  if (error) throw error
  return data as GearModel
}

export async function deleteGearModel(id: string): Promise<void> {
  // gear_model_sizes cascade on the FK.
  const { error } = await supabase.from('gear_models').delete().eq('id', id)
  if (error) throw error
}

// Replace a model's size rows wholesale — simplest fit for the grid editor.
export async function replaceModelSizes(modelId: string, sizes: GearModelSizeInsert[]): Promise<void> {
  const { error: delErr } = await supabase.from('gear_model_sizes').delete().eq('model_id', modelId)
  if (delErr) throw delErr
  if (sizes.length === 0) return
  const rows = sizes.map((s, i) => ({ ...s, model_id: modelId, sort_order: s.sort_order ?? i }))
  const { error: insErr } = await supabase.from('gear_model_sizes').insert(rows as never)
  if (insErr) throw insErr
}
