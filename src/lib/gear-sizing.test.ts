import { describe, it, expect } from 'vitest'
import { matchGear, fitSizeLabel, type GearModelWithSizes, type DiverMeasures } from './gear-sizing'
import type { GearModel, GearModelSize, GearType } from '../types/database'

// --- fixture builders ---------------------------------------------------------

let seq = 0
function model(over: Partial<GearModel> & { gear_type: GearType }, rows: Partial<GearModelSize>[]): GearModelWithSizes {
  const id = `m${seq++}`
  const base: GearModel = {
    id, gear_type: over.gear_type, name: over.name ?? id, brand: null,
    gender: over.gender ?? null, size_unit: over.size_unit ?? null, notes: null,
    active: over.active ?? true, sort_order: over.sort_order ?? 0,
    created_at: '2026-01-01', created_by: null,
  }
  const sizes: GearModelSize[] = rows.map((r, i) => ({
    id: `${id}-s${i}`, model_id: id, label: r.label ?? String(i),
    height_min: r.height_min ?? null, height_max: r.height_max ?? null,
    weight_min: r.weight_min ?? null, weight_max: r.weight_max ?? null,
    shoe_min: r.shoe_min ?? null, shoe_max: r.shoe_max ?? null,
    chest: r.chest ?? null, waist: r.waist ?? null, hip: r.hip ?? null,
    sort_order: r.sort_order ?? i,
  }))
  return { ...base, sizes }
}

// Women's Saeko, verbatim from the shop's chart (height cm / weight kg).
const womensSaeko = model({ gear_type: 'wetsuit', name: "Women's Saeko", gender: 'female' }, [
  { label: '1',  height_min: 150, height_max: 157, weight_min: 40, weight_max: 45 },
  { label: '3',  height_min: 157, height_max: 163, weight_min: 45, weight_max: 52 },
  { label: '5',  height_min: 160, height_max: 165, weight_min: 50, weight_max: 57 },
  { label: '7',  height_min: 163, height_max: 168, weight_min: 54, weight_max: 61 },
  { label: '9',  height_min: 165, height_max: 170, weight_min: 59, weight_max: 66 },
  { label: '11', height_min: 168, height_max: 173, weight_min: 64, weight_max: 71 },
  { label: '13', height_min: 170, height_max: 175, weight_min: 68, weight_max: null }, // 68+
])

const mensSaeko = model({ gear_type: 'wetsuit', name: "Men's Saeko", gender: 'male' }, [
  { label: 'M', height_min: 175, height_max: 180, weight_min: 68, weight_max: 79 },
  { label: 'L', height_min: 180, height_max: 185, weight_min: 86, weight_max: 98 },
])

const kidsFD = model({ gear_type: 'wetsuit', name: "Kid's FD", gender: 'kids' }, [
  { label: 'S', height_min: 116, height_max: 124, weight_min: 18, weight_max: 22 },
  { label: 'M', height_min: 127, height_max: 134, weight_min: 20, weight_max: 24 },
])

const finsJp = model({ gear_type: 'fins', name: 'FD Fins', size_unit: 'jp' }, [
  { label: 'Light Pink', shoe_min: 21,   shoe_max: 23 },
  { label: 'Pink',       shoe_min: 23.5, shoe_max: 25 },
  { label: 'White',      shoe_min: 25.5, shoe_max: 27 },
  { label: 'Black',      shoe_min: 28,   shoe_max: 31 },
])

function diver(over: Partial<DiverMeasures>): DiverMeasures {
  return { height_cm: null, weight_kg: null, shoe_size: null, gender: null, ...over }
}

const wetsuits = [womensSaeko, mensSaeko, kidsFD]

// --- tests --------------------------------------------------------------------

describe('matchGear — wetsuits', () => {
  it('returns a clean exact fit when the diver sits inside one size', () => {
    // 169cm / 62kg female → only Women\'s Saeko "9" contains both.
    const fits = matchGear(diver({ height_cm: 169, weight_kg: 62, gender: 'female' }), wetsuits, 'wetsuit')
    const saeko = fits.find(f => f.model.name === "Women's Saeko")!
    expect(saeko.fit).toBe('exact')
    expect(saeko.size.label).toBe('9')
    expect(saeko.score).toBe(0)
    expect(saeko.between).toBeUndefined()
    expect(saeko.notes).toEqual([])
  })

  it('ranks the nearest sizes and flags "between" when the diver falls between them', () => {
    // 158/55 → height wants "3", weight wants "5"; strict AND would return none.
    const fits = matchGear(diver({ height_cm: 158, weight_kg: 55, gender: 'female' }), wetsuits, 'wetsuit')
    const saeko = fits.find(f => f.model.name === "Women's Saeko")!
    expect(saeko.fit).toBe('closest')
    expect(saeko.size.label).toBe('5')          // score 2 (2cm under on height)
    expect(saeko.between?.label).toBe('3')       // score 3 (3kg over on weight)
    expect(fitSizeLabel(saeko)).toBe('3 – 5')
    expect(saeko.notes.join()).toMatch(/height 2cm under/)
  })

  it('filters by gender — a female diver never sees the men\'s model', () => {
    const fits = matchGear(diver({ height_cm: 158, weight_kg: 55, gender: 'female' }), wetsuits, 'wetsuit')
    expect(fits.some(f => f.model.name === "Men's Saeko")).toBe(false)
    expect(fits.some(f => f.model.name === "Women's Saeko")).toBe(true)
  })

  it('shows all models when the diver\'s gender is unknown', () => {
    const fits = matchGear(diver({ height_cm: 178, weight_kg: 74, gender: null }), wetsuits, 'wetsuit')
    expect(fits.some(f => f.model.name === "Men's Saeko")).toBe(true)
    expect(fits.some(f => f.model.name === "Women's Saeko")).toBe(true)
  })

  it('honours an open-ended top range (68+ weight)', () => {
    const fits = matchGear(diver({ height_cm: 172, weight_kg: 80, gender: 'female' }), wetsuits, 'wetsuit')
    const saeko = fits.find(f => f.model.name === "Women's Saeko")!
    expect(saeko.size.label).toBe('13')
    expect(saeko.fit).toBe('exact')             // 80 ≥ 68, no upper bound
  })

  it('lets a kids model self-select by its small size ranges', () => {
    const fits = matchGear(diver({ height_cm: 120, weight_kg: 20, gender: 'female' }), wetsuits, 'wetsuit')
    // Kids "S" is the exact fit and ranks first (exact before closest).
    expect(fits[0].model.name).toBe("Kid's FD")
    expect(fits[0].fit).toBe('exact')
    expect(fits[0].size.label).toBe('S')
  })
})

describe('matchGear — fins', () => {
  it('converts the diver\'s shoe size into the chart unit and matches the band', () => {
    const fits = matchGear(diver({ shoe_size: 'JP 25' }), [finsJp], 'fins')
    expect(fits[0].size.label).toBe('Pink')      // 23.5–25 contains 25
    expect(fits[0].fit).toBe('exact')
  })

  it('finds the nearest band when between sizes', () => {
    const fits = matchGear(diver({ shoe_size: 'JP 25.25' }), [finsJp], 'fins')
    expect(fits[0].fit).toBe('closest')
    expect([fits[0].size.label, fits[0].between?.label].sort()).toEqual(['Pink', 'White'])
  })

  it('returns nothing when the diver has no shoe size on file', () => {
    expect(matchGear(diver({ shoe_size: null }), [finsJp], 'fins')).toEqual([])
  })
})
